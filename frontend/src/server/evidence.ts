import { z } from "zod";
import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, existsSync, readFileSync } from "node:fs";

// This module is server-only. No model output or document text can execute actions.
export type Market = "FR" | "HU";
type Mode = "initial" | "replace_supplier_subset" | "add_supplier";
type Snapshot = { name: string; hash: string; text: string };
export type Event = {
  id: string;
  key: string;
  market: Market;
  version: string;
  previous?: string;
  mode: Mode;
  supplier?: string;
  received: string;
  effective: string;
  status: "QUEUED" | "PROCESSED" | "ERROR";
  sources: Snapshot[];
  error?: string;
  changes?: {
    added: number;
    superseded: number;
    unchanged: number;
    review: number;
    findings: number;
  };
};
export type RecordVersion = {
  id: string;
  logicalId: string;
  version: number;
  eventId: string;
  market: Market;
  product: string;
  supplier: string;
  description: string;
  qty: number;
  unit: string;
  pack: number | null;
  currency: string;
  originalAmount: string;
  amountCents: number | null;
  normalizedQty: number | null;
  normalizedUnit: string | null;
  unitPriceEUR: string | null;
  issues: string[];
  status: "CURRENT" | "SUPERSEDED";
  validFrom: string;
  validTo?: string;
  source: string;
  sheet: string;
  row: number;
  raw: unknown;
  transform: string;
  invoice?: string;
  credit: boolean;
  correction?: { reviewer: string; reason: string; previous: string };
};
export type Finding = {
  id: string;
  key: string;
  version: number;
  market: Market;
  product: string;
  created: string;
  dependencies: string[];
  totalCents: number | null;
  quantity: number | null;
  unit: string | null;
  status: "READY" | "NEEDS_REVIEW";
  current: boolean;
  previous?: string;
  deltaCents: number | null;
  reason: string;
  recommendation: string;
};
export type Approval = {
  id: string;
  findingId: string;
  reviewer: string;
  at: string;
  status: "APPROVED" | "STALE";
  staleReason?: string;
};
export type State = {
  events: Event[];
  records: RecordVersion[];
  findings: Finding[];
  approvals: Approval[];
  history: { at: string; kind: string; message: string }[];
};
const empty = (): State => ({
  events: [],
  records: [],
  findings: [],
  approvals: [],
  history: [],
});
const hash = (x: string) => createHash("sha256").update(x).digest("hex");
const now = () => new Date().toISOString();
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
const amountSchema = z.union([
  z.number().finite(),
  z.string().regex(/^-?\d+(\.\d{1,6})?$/),
]);

// Fixed decimal arithmetic; half-away-from-zero rounding. No floating point sums.
function scaled(value: unknown, decimals: number): bigint {
  const text = String(amountSchema.parse(value));
  assert(
    /^-?\d+(\.\d{1,6})?$/.test(text),
    "Invalid decimal; expected an unambiguous decimal point",
  );
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  assert(
    fraction.length <= decimals || /^0*$/.test(fraction.slice(decimals)),
    "Too many decimal places",
  );
  const n = BigInt(whole + fraction.slice(0, decimals).padEnd(decimals, "0"));
  return negative ? -n : n;
}
function divide(n: bigint, d: bigint): bigint {
  assert(d !== BigInt(0), "Division by zero");
  const sign = n < BigInt(0) !== d < BigInt(0) ? -BigInt(1) : BigInt(1);
  const a = n < BigInt(0) ? -n : n;
  const b = d < BigInt(0) ? -d : d;
  return sign * ((a + b / BigInt(2)) / b);
}
function safe(n: bigint): number {
  const value = Number(n);
  assert(Number.isSafeInteger(value), "Numeric range exceeded");
  return value;
}
export function euroCents(
  amount: unknown,
  currency: string,
  rates: Record<string, number>,
): number {
  assert(
    Object.hasOwn(rates, currency) && rates[currency] > 0,
    `Unsupported currency ${currency}`,
  );
  return safe(
    divide(scaled(amount, 6) * BigInt(100), scaled(rates[currency], 6)),
  );
}
export function normalize(qty: number, unit: string, pack: number | null) {
  assert(
    Number.isSafeInteger(qty) && qty !== 0,
    "Quantity must be a nonzero integer",
  );
  const aliases: Record<string, [string, number]> = {
    PC: ["piece", 1000],
    piece: ["piece", 1000],
    kg: ["kg", 1000],
    g: ["kg", 1],
    l: ["l", 1000],
    ml: ["l", 1],
  };
  if (unit === "box") {
    assert(
      pack !== null && Number.isSafeInteger(pack) && pack > 0 && pack <= 100000,
      "Cannot safely compare — box pack quantity requires human verification",
    );
    return { qty: safe(BigInt(qty) * BigInt(pack)), unit: "piece" };
  }
  assert(
    Object.hasOwn(aliases, unit),
    "Cannot safely compare — incomplete or unsupported unit",
  );
  assert(pack === null || pack === 1, "Pack quantity applies only to boxes");
  return { qty: safe(BigInt(qty) * BigInt(aliases[unit][1])) / 1000, unit: aliases[unit][0] };
}
const rowSchema = z.object({
  id: z.string(),
  iso: z.enum(["FR", "HU"]),
  productCode: z.string(),
  supplierId: z.string(),
  description: z.string(),
  qty: z.number().int(),
  unit: z.string(),
  currency: z.string(),
  valueLocal: amountSchema,
  unitPriceEUR: amountSchema,
  valueEUR: amountSchema,
});

export class EvidenceEngine {
  db: DatabaseSync;
  dataset: string;
  constructor(dbPath: string, datasetPath: string) {
    this.dataset = resolve(datasetPath);
    if (dbPath !== ":memory:")
      mkdirSync(dirname(resolve(dbPath)), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(
      "PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS evidence_state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)",
    );
    this.db
      .prepare("INSERT OR IGNORE INTO evidence_state VALUES (1, ?)")
      .run(JSON.stringify(empty()));
  }
  close() {
    this.db.close();
  }
  state(): State {
    return JSON.parse(
      (
        this.db.prepare("SELECT body FROM evidence_state WHERE id=1").get() as {
          body: string;
        }
      ).body,
    );
  }
  transaction<T>(fn: (s: State) => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const s = this.state();
      const result = fn(s);
      this.db
        .prepare("UPDATE evidence_state SET body=? WHERE id=1")
        .run(JSON.stringify(s));
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  snapshot(name: string): Snapshot {
    const text = readFileSync(resolve(this.dataset, name), "utf8");
    return { name, text, hash: hash(text) };
  }
  deliver(market: Market, version: "v1" | "v2", eventId?: string) {
    z.enum(["FR", "HU"]).parse(market);
    z.enum(["v1", "v2"]).parse(version);
    const id = eventId ?? `${market}-${version}`;
    z.string().min(1).max(120).parse(id);
    return this.transaction((s) => {
      try {
        const sources =
          version === "v1"
            ? [this.snapshot("ingestion-versions.json")]
            : [
                this.snapshot(`input-sheets/${market}-v2--Sheet1.csv`),
                this.snapshot("update-lineage.json"),
              ];
        sources.push(
          this.snapshot("fx-rates.json"),
          this.snapshot("products.json"),
        );
        // Hash content AND declared interpretation scope. Same content under a new event ID is also a replay.
        const key = hash(
          JSON.stringify({
            market,
            version,
            hashes: sources.map((x) => [x.name, x.hash]),
          }),
        );
        const priorId = s.events.find((e) => e.id === id);
        assert(
          !priorId || priorId.key === key,
          "Event ID collision: source changed; use a new event ID",
        );
        const prior =
          priorId ??
          s.events.find((e) => e.key === key && e.status !== "ERROR");
        if (prior) {
          s.history.push({
            at: now(),
            kind: "REPLAY",
            message: `${id}: 0 records, 0 findings, 0 approvals added; totals unchanged (original ${prior.status}).`,
          });
          return { duplicate: true, eventId: prior.id };
        }
        let mode: Mode = "initial";
        let previous: string | undefined;
        let supplier: string | undefined;
        if (version === "v2") {
          const lineages = JSON.parse(sources[1].text);
          const u = lineages.find(
            (x: { market: string }) => x.market === market,
          );
          const contract =
            market === "FR"
              ? ["replace_supplier_subset", "sup-aster"]
              : ["add_supplier", "sup-orbit"];
          assert(
            u &&
              u.mode === contract[0] &&
              u.scopeSupplierId === contract[1] &&
              u.previous === `${market}-v1` &&
              u.incoming === `${market}-v2`,
            "Incorrect replacement scope in lineage",
          );
          mode = u.mode;
          previous = u.previous;
          supplier = u.scopeSupplierId;
        }
        assert(
          s.events.filter((e) => e.status === "QUEUED").length < 20,
          "Queue full",
        );
        const event: Event = {
          id,
          key,
          market,
          version: `${market}-${version}`,
          previous,
          supplier,
          mode,
          received: now(),
          effective: version === "v2" ? "2026-09-01" : "2026-08-31",
          status: "QUEUED",
          sources,
        };
        s.events.push(event);
        s.history.push({
          at: now(),
          kind: "RECEIVED",
          message: `${id}: immutable source snapshot queued (${mode}).`,
        });
        return { duplicate: false, eventId: id };
      } catch (error) {
        s.history.push({
          at: now(),
          kind: "ERROR",
          message: `${id}: ${String(error)}`,
        });
        return { error: String(error) };
      }
    });
  }
  tick() {
    return this.transaction((stored) => {
      const s: State = structuredClone(stored);
      const event = s.events.find((e) => e.status === "QUEUED");
      if (!event) return { processed: false };
      try {
        assert(
          !s.events.some(
            (e) => e.version === event.version && e.status === "PROCESSED",
          ),
          "Version already applied with different bytes; explicit new version adapter required",
        );
        if (event.previous)
          assert(
            s.events.some(
              (e) => e.version === event.previous && e.status === "PROCESSED",
            ),
            "Missing base delivery; submit a new event after baseline",
          );
        const records = this.parse(event);
        assert(
          records.length > 0 && records.length <= 1000,
          "Empty or oversized delivery",
        );
        assert(
          new Set(records.map((r) => r.logicalId)).size === records.length,
          "Duplicate source row identifier",
        );
        const active = s.records.filter((r) => r.status === "CURRENT");
        const superseded =
          event.mode === "replace_supplier_subset"
            ? active.filter(
                (r) =>
                  r.market === event.market && r.supplier === event.supplier,
              )
            : [];
        if (event.mode === "add_supplier")
          assert(
            !active.some(
              (r) => r.market === event.market && r.supplier === event.supplier,
            ),
            "Addition overlaps existing supplier",
          );
        assert(
          event.mode !== "initial" ||
            !active.some((r) => r.market === event.market),
          "Initial delivery cannot overwrite current market",
        );
        if (event.mode === "replace_supplier_subset")
          assert(superseded.length > 0, "Replacement scope is empty");
        // Entire parse and scope validation happen before any version is retired.
        for (const r of superseded) {
          r.status = "SUPERSEDED";
          r.validTo = now();
        }
        s.records.push(...records);
        const affected = new Set(
          [...superseded, ...records].map((r) => `${r.market}:${r.product}`),
        );
        const count = this.recompute(
          s,
          affected,
          `Source ${event.id}: ${event.mode}`,
        );
        event.status = "PROCESSED";
        event.changes = {
          added: records.length,
          superseded: superseded.length,
          unchanged: active.length - superseded.length,
          review: records.filter((r) => r.issues.length).length,
          findings: count,
        };
        s.history.push({
          at: now(),
          kind: "DECISION_REQUIRED",
          message: `${event.id}: ${count} affected findings recomputed. Review current evidence before approval.`,
        });
        Object.assign(stored, s);
        return { processed: true, changes: event.changes };
      } catch (error) {
        event.status = "ERROR";
        event.error = String(error);
        const failed = stored.events.find((e) => e.id === event.id)!;
        failed.status = "ERROR";
        failed.error = event.error;
        stored.history.push({
          at: now(),
          kind: "ERROR",
          message: `${event.id}: ${event.error}`,
        });
        return { processed: false, error: event.error };
      }
    });
  }
  parse(event: Event): RecordVersion[] {
    const source = event.sources[0];
    const rates = JSON.parse(
      event.sources.find((x) => x.name === "fx-rates.json")!.text,
    );
    const catalog = JSON.parse(
      event.sources.find((x) => x.name === "products.json")!.text,
    ) as { code: string }[];
    const records: RecordVersion[] = [];
    const add = (
      r: Omit<
        RecordVersion,
        | "id"
        | "version"
        | "eventId"
        | "status"
        | "validFrom"
        | "amountCents"
        | "normalizedQty"
        | "normalizedUnit"
        | "unitPriceEUR"
        | "issues"
      >,
    ) => {
      const record: RecordVersion = {
        ...r,
        id: randomUUID(),
        version: 1,
        eventId: event.id,
        status: "CURRENT",
        validFrom: now(),
        amountCents: null,
        normalizedQty: null,
        normalizedUnit: null,
        unitPriceEUR: null,
        issues: [],
      };
      try {
        record.amountCents = euroCents(r.originalAmount, r.currency, rates);
      } catch (error) {
        record.issues.push(String(error));
      }
      if (!catalog.some((p) => p.code === r.product))
        record.issues.push("Unknown product ID: human mapping required");
      this.normalizeRecord(record);
      records.push(record);
    };
    if (event.mode === "initial") {
      // Only v1 is an input. v2/current and gold answers are never read by this importer.
      const rows = z
        .array(rowSchema.passthrough())
        .parse(JSON.parse(source.text)[event.market].v1);
      rows.forEach((r, i) => {
        assert(r.iso === event.market, "Market scope mismatch");
        const cents = euroCents(r.valueLocal, r.currency, rates);
        assert(
          cents === euroCents(r.valueEUR, "EUR", rates),
          "Baseline FX reconciliation failed",
        );
        assert(
          safe(scaled(r.unitPriceEUR, 2) * BigInt(r.qty)) === cents,
          "Baseline arithmetic failed",
        );
        add({
          logicalId: r.id,
          market: r.iso,
          product: r.productCode,
          supplier: r.supplierId,
          description: r.description,
          qty: r.qty,
          unit: r.unit,
          pack: 1,
          currency: r.currency,
          originalAmount: String(r.valueLocal),
          source: source.name,
          sheet: `/${event.market}/v1`,
          row: i + 1,
          raw: r,
          credit: r.qty < 0,
          transform: `valueLocal / fx-rates[${r.currency}] (${rates[r.currency]} local per EUR), round half away from zero to cents; verified qty × unitPriceEUR. Input is the supplied v1 JSON, not its descriptive source filename.`,
        });
      });
      return records;
    }
    const rows = parseCSV(source.text);
    const header = rows.shift()!;
    const expected =
      event.market === "FR"
        ? {
            width: 34,
            labels: {
              3: "Invoice total",
              6: "Article",
              8: "Invoiced quantity",
              9: "Quantity unit",
              10: "Net value",
              11: "Currency",
              20: "Invoice type code",
            },
          }
        : {
            width: 7,
            labels: {
              2: "Manufacturer Code",
              4: "Unit",
              5: "Quantity",
              6: "Selling Price/Unit (Ft)",
            },
          };
    assert(
      header.length === expected.width &&
        Object.entries(expected.labels).every(
          ([i, v]) => header[Number(i)] === v,
        ),
      "Unsupported header layout; refusing positional guess",
    );
    const invoices = new Map<string, { total: number; sum: number }>();
    rows.forEach((raw, i) => {
      assert(
        raw.length === expected.width,
        `Malformed row ${i + 2}: incorrect column count`,
      );
      if (event.market === "FR") {
        assert(
          raw[4] === raw[11] && raw[5] === raw[13],
          "Conflicting duplicate currency/invoice columns",
        );
        assert(
          ["INVOICE", "CREDIT_NOTE"].includes(raw[20]),
          "Unsupported cancellation type",
        );
        const qty = Number(raw[8]);
        const net = scaled(raw[10], 2);
        assert(
          net < BigInt(0) === (raw[20] === "CREDIT_NOTE") &&
            qty < 0 === net < BigInt(0),
          "Credit sign mismatch",
        );
        const inv = invoices.get(raw[5]) ?? {
          total: safe(scaled(raw[3], 2)),
          sum: 0,
        };
        assert(
          inv.total === safe(scaled(raw[3], 2)),
          "Inconsistent repeated invoice total",
        );
        inv.sum += safe(net);
        invoices.set(raw[5], inv);
        add({
          logicalId: `${raw[5]}:${raw[12]}`,
          market: "FR",
          product: raw[6],
          supplier: event.supplier!,
          description: raw[7],
          qty,
          unit: raw[9],
          pack: raw[9] === "PC" ? 1 : null,
          currency: raw[11],
          originalAmount: raw[10],
          source: source.name,
          sheet: "Sheet1",
          row: i + 2,
          raw,
          invoice: raw[5],
          credit: raw[20] === "CREDIT_NOTE",
          transform: `Column 11 line net / FX ${rates[raw[11]] ?? "UNKNOWN"} → EUR cents. Column 4 repeated invoice total is checked once per invoice, never summed per line. Credit remains signed; no invented link to an original invoice.`,
        });
      } else {
        const qty = Number(raw[5]);
        assert(Number.isSafeInteger(qty) && qty > 0, "Malformed HU quantity");
        const localCents = scaled(raw[6], 2) * BigInt(qty);
        const local = `${localCents / BigInt(100)}.${String(localCents % BigInt(100)).padStart(2, "0")}`;
        add({
          logicalId: raw[1],
          market: "HU",
          product: raw[2],
          supplier: event.supplier!,
          description: raw[3],
          qty,
          unit: raw[4],
          pack: raw[4] === "PC" ? 1 : null,
          currency: "HUF",
          originalAmount: local,
          source: source.name,
          sheet: "Sheet1",
          row: i + 2,
          raw,
          credit: false,
          transform: `Column 6 quantity × column 7 HUF unit price / ${rates.HUF} HUF per EUR; round each line to cents. Synthetic FX assumption from snapshotted fx-rates.json.`,
        });
      }
    });
    assert(
      [...invoices.values()].every((x) => x.total === x.sum),
      "Invoice line totals do not reconcile; entire delivery quarantined",
    );
    return records;
  }
  normalizeRecord(r: RecordVersion) {
    try {
      const n = normalize(r.qty, r.unit, r.pack);
      r.normalizedQty = n.qty;
      r.normalizedUnit = n.unit;
      if (r.amountCents !== null) {
        const millionths = divide(
          BigInt(r.amountCents) * BigInt(10000000),
          scaled(n.qty, 3),
        );
        const absolute = millionths < BigInt(0) ? -millionths : millionths;
        r.unitPriceEUR = `${millionths < BigInt(0) ? "-" : ""}${absolute / BigInt(1000000)}.${String(absolute % BigInt(1000000)).padStart(6, "0")}`;
      }
    } catch (error) {
      r.issues.push(String(error));
    }
  }
  recompute(s: State, keys: Set<string>, reason: string) {
    let changed = 0;
    for (const key of keys) {
      const rows = s.records.filter(
        (r) => r.status === "CURRENT" && `${r.market}:${r.product}` === key,
      );
      const prior = s.findings.find((f) => f.current && f.key === key);
      const dependencies = rows.map((r) => r.id).sort();
      if (
        prior &&
        JSON.stringify(prior.dependencies) === JSON.stringify(dependencies)
      )
        continue;
      const valid =
        rows.length > 0 &&
        rows.every((r) => r.issues.length === 0 && r.amountCents !== null);
      const units = new Set(rows.map((r) => r.normalizedUnit));
      const totalCents = valid
        ? safe(rows.reduce((sum, r) => sum + BigInt(r.amountCents!), BigInt(0)))
        : null;
      const [market, product] = key.split(":");
      const finding: Finding = {
        id: randomUUID(),
        key,
        version: (prior?.version ?? 0) + 1,
        market: market as Market,
        product,
        created: now(),
        dependencies,
        totalCents,
        quantity:
          valid && units.size === 1
            ? safe(rows.reduce((sum, r) => sum + scaled(r.normalizedQty!, 3), BigInt(0))) / 1000
            : null,
        unit: units.size === 1 ? (rows[0]?.normalizedUnit ?? null) : null,
        status: valid && units.size === 1 ? "READY" : "NEEDS_REVIEW",
        current: true,
        previous: prior?.id,
        deltaCents:
          totalCents !== null &&
          prior?.totalCents !== null &&
          prior?.totalCents !== undefined
            ? totalCents - prior.totalCents
            : null,
        reason,
        recommendation: valid
          ? `Use this signed historical net spend as the procurement review baseline for ${market}/${product}. This is not a future budget, saving or supplier award.`
          : "ABSTAIN: incomplete evidence. Correct the flagged records before approving this baseline.",
      };
      if (prior) {
        prior.current = false;
        for (const a of s.approvals.filter(
          (candidate) =>
            candidate.findingId === prior.id && candidate.status === "APPROVED",
        )) {
          a.status = "STALE";
          a.staleReason = `${reason}; replaced by version ${finding.version}`;
        }
      }
      s.findings.push(finding);
      changed += 1;
    }
    return changed;
  }
  approve(findingId: string, reviewer: string) {
    z.string().trim().min(2).max(100).parse(reviewer);
    return this.transaction((s) => {
      const f = s.findings.find((x) => x.id === findingId);
      assert(
        f?.current && f.status === "READY",
        "Cannot approve stale, missing or unresolved finding",
      );
      assert(
        !s.events.some((e) => e.status === "QUEUED" && e.market === f.market),
        "Incoming evidence pending; wait for processing",
      );
      this.checkSources(s, f);
      const existing = s.approvals.find(
        (a) => a.findingId === findingId && a.status === "APPROVED",
      );
      if (existing) return existing;
      const a: Approval = {
        id: randomUUID(),
        findingId,
        reviewer: reviewer.trim(),
        at: now(),
        status: "APPROVED",
      };
      s.approvals.push(a);
      s.history.push({
        at: now(),
        kind: "APPROVED",
        message: `${f.key} v${f.version} approved by ${a.reviewer}. No order placed.`,
      });
      return a;
    });
  }
  checkSources(s: State, f: Finding) {
    const ids = new Set(
      s.records
        .filter((r) => f.dependencies.includes(r.id))
        .map((r) => r.eventId),
    );
    for (const e of s.events.filter((candidate) => ids.has(candidate.id)))
      for (const source of e.sources) {
        assert(
          this.snapshot(source.name).hash === source.hash,
          `Source changed after ingestion: ${source.name}; explicit new event/review required`,
        );
      }
  }
  auditSources() {
    return this.transaction((s) => {
      for (const f of s.findings.filter((x) => x.current)) {
        try {
          this.checkSources(s, f);
        } catch (error) {
          if (
            f.status !== "NEEDS_REVIEW" ||
            !f.reason.startsWith("Source integrity")
          ) {
            const reason = `Source integrity: ${String(error)}`;
            f.current = false;
            s.findings.push({
              ...f,
              id: randomUUID(),
              version: f.version + 1,
              previous: f.id,
              current: true,
              created: now(),
              status: "NEEDS_REVIEW",
              totalCents: null,
              deltaCents: null,
              reason,
              recommendation:
                "ABSTAIN: source bytes changed or disappeared. Historical snapshots remain available; a reviewed source event is required.",
            });
            for (const a of s.approvals.filter(
              (candidate) =>
                candidate.findingId === f.id && candidate.status === "APPROVED",
            )) {
              a.status = "STALE";
              a.staleReason = reason;
            }
            s.history.push({
              at: now(),
              kind: "SOURCE_CHANGED",
              message: reason,
            });
          }
        }
      }
    });
  }
  correct(input: {
    recordId: string;
    qty: number;
    unit: string;
    pack: number | null;
    reviewer: string;
    reason: string;
  }) {
    const data = z
      .object({
        recordId: z.string(),
        qty: z.number().int().min(-1000000).max(1000000),
        unit: z.enum(["piece", "box", "kg", "g", "l", "ml"]),
        pack: z.number().int().positive().max(100000).nullable(),
        reviewer: z.string().trim().min(2).max(100),
        reason: z.string().trim().min(8).max(1000),
      })
      .strict()
      .parse(input);
    return this.transaction((s) => {
      const old = s.records.find((r) => r.id === data.recordId);
      assert(
        old?.status === "CURRENT",
        "Record changed; reload before correcting",
      );
      assert(
        !s.events.some((e) => e.market === old.market && e.status === "QUEUED"),
        "Incoming evidence pending",
      );
      const f = s.findings.find(
        (x) => x.current && x.dependencies.includes(old.id),
      );
      if (f) this.checkSources(s, f);
      assert(
        data.qty < 0 === old.credit,
        "A correction must preserve the signed credit/invoice classification",
      );
      normalize(data.qty, data.unit, data.pack);
      assert(
        old.qty !== data.qty ||
          old.unit !== data.unit ||
          old.pack !== data.pack,
        "Correction has no changes",
      );
      assert(
        old.amountCents !== null &&
          !old.issues.some((x) => x.includes("product")),
        "Unit correction cannot repair currency or product identity errors",
      );
      const record: RecordVersion = {
        ...old,
        id: randomUUID(),
        version: old.version + 1,
        qty: data.qty,
        unit: data.unit,
        pack: data.pack,
        validFrom: now(),
        issues: [],
        normalizedQty: null,
        normalizedUnit: null,
        unitPriceEUR: null,
        correction: {
          reviewer: data.reviewer,
          reason: data.reason,
          previous: old.id,
        },
        transform: `${old.transform} Human quantity/unit correction; source line amount remains unchanged.`,
      };
      this.normalizeRecord(record);
      old.status = "SUPERSEDED";
      old.validTo = now();
      s.records.push(record);
      this.recompute(
        s,
        new Set([`${old.market}:${old.product}`]),
        `Human correction by ${data.reviewer}: ${data.reason}`,
      );
      s.history.push({
        at: now(),
        kind: "CORRECTED",
        message: `${old.logicalId} v${record.version}: ${data.reason}`,
      });
      return record;
    });
  }
}

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        assert(quoted || cell.length === 0, "Malformed CSV quote");
        quoted = !quoted;
      }
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  assert(!quoted, "Unterminated CSV quote");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function openEngine() {
  return new EvidenceEngine(
    process.env.WOLF_DB_PATH ??
      (process.env.VERCEL
        ? resolve("/tmp/wolf-evidence.sqlite")
        : resolve(process.cwd(), ".wolf/evidence.sqlite")),
    resolveDatasetDir(),
  );
}

function resolveDatasetDir(): string {
  const candidates = [
    process.env.WOLF_DATASET_PATH,
    resolve(process.cwd(), "../kit/dataset"),
    resolve(process.cwd(), "kit/dataset"),
  ].filter((x): x is string => Boolean(x));
  const found = candidates.find((p) => existsSync(p));
  return found ?? resolve(candidates[0] ?? process.cwd());
}
