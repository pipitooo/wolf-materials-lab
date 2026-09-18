import type { State } from "./evidence";

import { resolve } from "node:path";
// Deterministic sourcing model. ALL arithmetic here is plain application code;
// the AI layer can only explain results, never compute or change them.
import { existsSync, readFileSync } from "node:fs";

export const SCENARIO_MODES = [
  "BALANCED",
  "LOWEST_COST",
  "FASTEST_DELIVERY",
  "MOST_RELIABLE",
  "LOWEST_RISK",
] as const;
export type ScenarioMode = (typeof SCENARIO_MODES)[number];

export type Weights = {
  cost: number;
  time: number;
  supply: number;
  reliability: number;
  trust: number;
  evidence: number;
};

// Documented default weights. Exposed in the UI under "How was this calculated?".
export const SCENARIO_WEIGHTS: Record<ScenarioMode, Weights> = {
  BALANCED: { cost: 0.3, time: 0.2, supply: 0.15, reliability: 0.2, trust: 0.1, evidence: 0.05 },
  LOWEST_COST: { cost: 0.7, time: 0.06, supply: 0.12, reliability: 0.07, trust: 0.03, evidence: 0.02 },
  FASTEST_DELIVERY: { cost: 0.05, time: 0.75, supply: 0.12, reliability: 0.04, trust: 0.02, evidence: 0.02 },
  MOST_RELIABLE: { cost: 0.15, time: 0.1, supply: 0.15, reliability: 0.45, trust: 0.1, evidence: 0.05 },
  LOWEST_RISK: { cost: 0.15, time: 0.05, supply: 0.2, reliability: 0.25, trust: 0.05, evidence: 0.3 },
};

export type Profile = {
  iso: string;
  supplierId: string;
  brand: string;
  transport: {
    mode: "domestic" | "road" | "rail" | "sea" | "air";
    distanceKm: number;
    transitDays: number;
    costPerUnitEUR: number;
    fuelSurchargePerUnitEUR: number;
  };
  logistics: {
    feePerUnitEUR: number;
    handlingPerUnitEUR: number;
    customsPerUnitEUR: number;
    dutyPct: number;
    insurancePct: number;
    warehouseCostPerOrderEUR: number;
    expectedStorageDays: number;
  };
  time: {
    productionLeadTimeDays: number;
    handlingTimeDays: number;
    customsDelayDays: number;
  };
  supply: { productionCapacityPerMonth: number; availableQuantity: number };
  reliability: {
    onTimeDeliveryPercent: number;
    historicalFulfillmentPercent: number;
    defectRatePercent: number;
    cancellationRatePercent: number;
    numberOfHistoricalOrders: number;
    reliabilityScore: number;
  };
  trust: {
    supplierRating: number;
    numberOfReviews: number;
    verifiedBuyerPercent: number;
    communityTrustScore: number;
  };
};

type ProfilesFile = { meta: unknown; profiles: Profile[]; internalOps: unknown };

export type CostComponent = {
  key: string;
  label: string;
  perUnitEUR: number;
  totalEUR: number;
  status: "CHECKED_EVIDENCE" | "SYNTHETIC" | "DERIVED";
  note: string;
};

export type MarketRow = {
  iso: string;
  name: string;
  supplierId: string;
  brand: string;
  unit: string;
  route: "direct" | "indirect";
  piecePriceEUR: number;
  priceStatus: "CHECKED_EVIDENCE" | "INCONSISTENT" | "SYNTHETIC_LEDGER";
  priceSpread: { min: number; median: number; max: number } | null;
  evidenceRows: number;
  evidenceIssues: number;
  demandQty: number;
  availableQty: number;
  coveragePct: number;
  canFulfill: boolean;
  productionCapacityPerMonth: number;
  transportMode: Profile["transport"]["mode"];
  distanceKm: number;
  landed: { components: CostComponent[]; totalEUR: number; perUnitEUR: number };
  leadTime: { production: number; handling: number; transit: number; customs: number; totalDays: number };
  reliabilityScore: number;
  onTimeDeliveryPercent: number;
  supplierRating: number;
  numberOfReviews: number;
  verifiedBuyerPercent: number;
  evidenceScore: number;
  // Cost confidence: only a broken price (checked rows disagree) is
  // discounted; synthetic guidance still counts fully as a cost signal.
  priceConfidence: number;
  scores: Record<ScenarioMode, number>;
  ranks: Record<ScenarioMode, number>;
};

export type WhyFact = { tone: "pro" | "con" | "warn"; text: string };
export type Recommendation = {
  mode: ScenarioMode;
  winnerIso: string;
  runnerUpIso: string;
  score: number;
  why: WhyFact[];
};

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const round4 = (n: number) => Math.round(n * 10000) / 10000;

function cents(n: number): number {
  return Math.round(n * 100);
}

export function datasetDir(): string {
  const candidates = [
    process.env.WOLF_DATASET_PATH,
    resolve(process.cwd(), "../kit/dataset"),
    resolve(process.cwd(), "kit/dataset"),
  ].filter((x): x is string => Boolean(x));
  const found = candidates.find((p) => existsSync(p));
  return found ?? resolve(candidates[0] ?? process.cwd());
}

export function loadProfiles(): ProfilesFile {
  return JSON.parse(
    readFileSync(resolve(datasetDir(), "sourcing-profiles.json"), "utf8"),
  ) as ProfilesFile;
}

type Tx = {
  iso: string;
  productCode: string;
  supplierId: string;
  brand: string;
  description: string;
  unit: string;
  qty: number;
  unitPriceEUR: number;
  route: "direct" | "indirect";
  source: string;
};

export function loadLedger(): Tx[] {
  return JSON.parse(
    readFileSync(resolve(datasetDir(), "transactions.json"), "utf8"),
  ) as Tx[];
}

// Checked-evidence price per market+product, derived from CURRENT canonical
// records only. Credits never count as a purchase price.
export function evidencePrice(
  state: State | null,
  market: string,
  product: string,
): {
  median: number | null;
  min: number;
  max: number;
  count: number;
  issues: number;
  netQty: number;
} {
  const rows = (state?.records ?? []).filter(
    (r) => r.status === "CURRENT" && r.market === market && r.product === product,
  );
  const prices = rows
    .filter((r) => !r.credit)
    .map((r) => Number.parseFloat(r.unitPriceEUR ?? ""))
    .filter((n) => Number.isFinite(n));
  const netQty = rows.reduce((s, r) => s + r.qty, 0);
  if (!prices.length)
    return { median: null, min: 0, max: 0, count: rows.length, issues: rows.reduce((s, r) => s + r.issues.length, 0), netQty };
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    median: round2(median),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    count: rows.length,
    issues: rows.reduce((s, r) => s + r.issues.length, 0),
    netQty,
  };
}

// Deterministic landed cost. All amounts in integer cents.
export function computeLanded(
  piecePriceEUR: number,
  profile: Profile,
  qty: number,
  priceStatus: MarketRow["priceStatus"],
): { components: CostComponent[]; totalEUR: number; perUnitEUR: number } {
  if (!(Number.isSafeInteger(qty) && qty > 0))
    throw new Error("Quantity must be a positive integer");
  const priceCents = cents(piecePriceEUR);
  const perUnit = (amount: number) => {
    const c = cents(amount);
    return { perUnitEUR: c / 100, totalEUR: (c * qty) / 100 };
  };
  const piece: CostComponent = {
    key: "piece",
    label: "Parts (piece price)",
    perUnitEUR: piecePriceEUR,
    totalEUR: (priceCents * qty) / 100,
    status: priceStatus === "SYNTHETIC_LEDGER" ? "SYNTHETIC" : "CHECKED_EVIDENCE",
    note:
      priceStatus === "CHECKED_EVIDENCE"
        ? "Median of current checked canonical rows"
        : priceStatus === "INCONSISTENT"
          ? "Checked rows disagree; median shown — review required"
          : "Synthetic market ledger row",
  };
  const t = perUnit(profile.transport.costPerUnitEUR);
  const transport = { key: "transport", label: "Transport", ...t, status: "SYNTHETIC" as const, note: `${profile.transport.mode}, ${profile.transport.distanceKm} km` };
  const f = perUnit(profile.transport.fuelSurchargePerUnitEUR);
  const fuel = { key: "fuel", label: "Fuel surcharge", ...f, status: "SYNTHETIC" as const, note: "Synthetic surcharge percentage" };
  const l = perUnit(profile.logistics.feePerUnitEUR);
  const logistics = { key: "logistics", label: "Logistics fee", ...l, status: "SYNTHETIC" as const, note: profile.logistics.feePerUnitEUR === 0 ? "Domestic — no fee" : "Synthetic fee" };
  const c = perUnit(profile.logistics.customsPerUnitEUR);
  const customs = { key: "customs", label: "Customs", ...c, status: "SYNTHETIC" as const, note: profile.logistics.customsPerUnitEUR === 0 ? "No customs (same customs area)" : "Synthetic customs fee" };
  const dutyPerUnit = round2((piecePriceEUR * profile.logistics.dutyPct * 100) / 100);
  const d = perUnit(dutyPerUnit);
  const duty = { key: "duty", label: "Import duty", ...d, status: "DERIVED" as const, note: `${profile.logistics.dutyPct * 100}% of piece price (deterministic)` };
  const h = perUnit(profile.logistics.handlingPerUnitEUR);
  const handling = { key: "handling", label: "Handling", ...h, status: "SYNTHETIC" as const, note: "Synthetic handling fee" };
  const insPerUnit = round2((piecePriceEUR * profile.logistics.insurancePct * 100) / 100);
  const i = perUnit(insPerUnit);
  const insurance = { key: "insurance", label: "Insurance", ...i, status: "DERIVED" as const, note: `${profile.logistics.insurancePct * 100}% of piece price (deterministic)` };
  const warehouse = { key: "warehouse", label: "Warehouse / storage", perUnitEUR: round2(profile.logistics.warehouseCostPerOrderEUR / qty), totalEUR: profile.logistics.warehouseCostPerOrderEUR, status: "SYNTHETIC" as const, note: `Fixed per order, ${profile.logistics.expectedStorageDays} expected storage days` };
  const components: CostComponent[] = [piece, transport, fuel, logistics, customs, duty, handling, insurance, warehouse];
  const totalCents = components.reduce((s, x) => s + cents(x.totalEUR), 0);
  return {
    components,
    totalEUR: totalCents / 100,
    perUnitEUR: round2(totalCents / 100 / qty),
  };
}

export function computeLeadTime(profile: Profile): MarketRow["leadTime"] {
  const t = profile.time;
  return {
    production: t.productionLeadTimeDays,
    handling: t.handlingTimeDays,
    transit: profile.transport.transitDays,
    customs: t.customsDelayDays,
    totalDays:
      t.productionLeadTimeDays +
      t.handlingTimeDays +
      profile.transport.transitDays +
      t.customsDelayDays,
  };
}

export function computeCoverage(demandQty: number, profile: Profile) {
  const available = profile.supply.availableQuantity;
  const coveragePct = demandQty <= 0 ? 100 : Math.min(100, Math.round((available / demandQty) * 100));
  return {
    availableQty: available,
    coveragePct,
    canFulfill: available >= demandQty,
    productionCapacityPerMonth: profile.supply.productionCapacityPerMonth,
  };
}

function normalizeLowerBetter(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 1);
  return values.map((x) => (max - x) / (max - min));
}

function normalizeHigherBetter(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 1);
  return values.map((x) => (x - min) / (max - min));
}

function rankScore(values: number[], lowerBetter: boolean): number[] {
  const order = values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => (lowerBetter ? a.v - b.v : b.v - a.v));
  const out = new Array<number>(values.length);
  order.forEach((x, pos) => {
    out[x.i] = values.length > 1 ? 1 - pos / (values.length - 1) : 1;
  });
  return out;
}

export function score(
  rows: (Pick<
    MarketRow,
    "landed" | "leadTime" | "coveragePct" | "reliabilityScore" | "supplierRating" | "evidenceScore"
  > & { priceConfidence?: number })[],
): Record<ScenarioMode, number>[] {
  // Cost uses rank-based normalization: min-max over all 29 markets is
  // dominated by distant, expensive outliers and would erase the real
  // differences between competitive sources near the cost frontier.
  const costN = rankScore(rows.map((r) => r.landed.perUnitEUR), true);
  const timeN = normalizeLowerBetter(rows.map((r) => r.leadTime.totalDays));
  const supplyN = normalizeHigherBetter(rows.map((r) => r.coveragePct));
  const relN = normalizeHigherBetter(rows.map((r) => r.reliabilityScore));
  const trustN = normalizeHigherBetter(rows.map((r) => r.supplierRating));
  const evN = normalizeHigherBetter(rows.map((r) => r.evidenceScore));
  // Risk-adjusted cost: only a broken price (checked rows disagree) is
  // discounted; synthetic guidance still counts fully as a cost signal.
  const riskAdjustedCost = rows.map((r, i) =>
    costN[i] * (r.priceConfidence ?? r.evidenceScore),
  );
  return rows.map((_, idx) => {
    const out = {} as Record<ScenarioMode, number>;
    for (const mode of SCENARIO_MODES) {
      const w = SCENARIO_WEIGHTS[mode];
      out[mode] = round4(
        w.cost * riskAdjustedCost[idx] +
          w.time * timeN[idx] +
          w.supply * supplyN[idx] +
          w.reliability * relN[idx] +
          w.trust * trustN[idx] +
          w.evidence * evN[idx],
      );
    }
    return out;
  });
}

export function rankRows(
  rows: MarketRow[],
): { scores: Record<ScenarioMode, number>[]; ranks: Record<ScenarioMode, number>[] } {
  const scores = score(rows);
  const ranks = rows.map(() => ({} as Record<ScenarioMode, number>));
  for (const mode of SCENARIO_MODES) {
    const order = rows
      .map((r, i) => ({ i, s: scores[i][mode], landed: r.landed.perUnitEUR }))
      .sort((a, b) => b.s - a.s || a.landed - b.landed);
    order.forEach((x, pos) => {
      ranks[x.i][mode] = pos + 1;
    });
  }
  return { scores, ranks };
}

export function buildWhy(
  winner: MarketRow,
  runnerUp: MarketRow,
  all: MarketRow[],
  demandQty: number,
): WhyFact[] {
  const facts: WhyFact[] = [];
  const costRank = all.filter((r) => r.landed.perUnitEUR < winner.landed.perUnitEUR).length + 1;
  const medianDays =
    [...all.map((r) => r.leadTime.totalDays)].sort((a, b) => a - b)[Math.floor(all.length / 2)];
  const medianWarehouse =
    [...all.map((r) => r.landed.components.find((c) => c.key === "warehouse")!.totalEUR)].sort(
      (a, b) => a - b,
    )[Math.floor(all.length / 2)];
  facts.push({
    tone: costRank <= 2 ? "pro" : "con",
    text: `${winner.landed.perUnitEUR.toFixed(2)} €/unit landed — ${costRank <= 2 ? `#${costRank} cheapest` : `#${costRank} of ${all.length} on cost`}`,
  });
  facts.push({
    tone: winner.leadTime.totalDays <= Math.min(4, medianDays) ? "pro" : "con",
    text: `${winner.leadTime.totalDays} day delivery — ${winner.leadTime.totalDays < medianDays ? `${medianDays - winner.leadTime.totalDays} days faster` : `${winner.leadTime.totalDays - medianDays} days slower`} than the ${all.length}-market median (${medianDays}d)`,
  });
  facts.push(
    winner.canFulfill
      ? { tone: "pro", text: `Full order coverage — all ${demandQty} units available` }
      : { tone: "warn", text: `Only ${winner.coveragePct}% of ${demandQty} units available — cannot fulfill the whole order` },
  );
  facts.push({
    tone: winner.reliabilityScore >= 95 ? "pro" : winner.reliabilityScore >= 90 ? "con" : "warn",
    text: `${winner.reliabilityScore}% reliability score (${winner.onTimeDeliveryPercent}% on-time delivery)`,
  });
  facts.push({
    tone: winner.supplierRating >= 4.5 ? "pro" : "con",
    text: `${winner.supplierRating}/5 supplier rating — ${winner.numberOfReviews} reviews, ${winner.verifiedBuyerPercent}% verified buyers`,
  });
  const wh = winner.landed.components.find((c) => c.key === "warehouse")!;
  if (wh.totalEUR > medianWarehouse)
    facts.push({
      tone: "con",
      text: `Warehouse ${wh.totalEUR.toFixed(0)} € per order — above the market median`,
    });
  facts.push(
    winner.priceStatus === "CHECKED_EVIDENCE"
      ? { tone: "pro", text: "Price comes from checked, versioned evidence records" }
      : winner.priceStatus === "INCONSISTENT"
        ? { tone: "warn", text: "Checked records disagree on price — human verification required" }
        : { tone: "con", text: "Price is synthetic ledger guidance, not checked evidence" },
  );
  const delta = winner.landed.perUnitEUR - runnerUp.landed.perUnitEUR;
  if (delta < 0)
    facts.push({
      tone: "pro",
      text: `${Math.abs(delta).toFixed(2)} €/unit cheaper than the runner-up (${runnerUp.name})`,
    });
  return facts;
}

export function buildRecommendation(
  rows: MarketRow[],
  mode: ScenarioMode,
  demandQty: number,
): Recommendation {
  const ranked = [...rows].sort(
    (a, b) => b.scores[mode] - a.scores[mode] || a.landed.perUnitEUR - b.landed.perUnitEUR,
  );
  const winner = ranked[0];
  const runnerUp = ranked[1];
  return {
    mode,
    winnerIso: winner.iso,
    runnerUpIso: runnerUp.iso,
    score: winner.scores[mode],
    why: buildWhy(winner, runnerUp, rows, demandQty),
  };
}

export type Model = {
  rows: MarketRow[];
  demandQty: number;
  demandBasis: string;
  hasFRDecision: boolean;
};

// Builds the full sourcing model for one product. Piece prices prefer CURRENT
// checked evidence (FR/HU); other markets use the synthetic ledger. Demand is
// the net quantity of current checked FR records, else the ledger FR volume.
export function buildModel(state: State | null, product: string): Model {
  const txs = loadLedger();
  const { profiles } = loadProfiles();
  const ledgerRows = txs.filter((t) => t.productCode === product);
  const ledgerByIso = new Map<string, typeof ledgerRows>();
  for (const r of ledgerRows) {
    const list = ledgerByIso.get(r.iso) ?? [];
    list.push(r);
    ledgerByIso.set(r.iso, list);
  }

  const frEvidence = evidencePrice(state, "FR", product);
  const demandQty =
    frEvidence.netQty > 0
      ? frEvidence.netQty
      : (ledgerByIso.get("FR") ?? []).reduce((s, r) => s + r.qty, 0);
  const demandBasis =
    frEvidence.netQty > 0
      ? "Net quantity of current checked FR records"
      : "Synthetic ledger FR volume (no checked evidence loaded)";

  const rows: MarketRow[] = profiles
    .filter((p) => ledgerByIso.has(p.iso))
    .map((p) => {
      const ledger = ledgerByIso.get(p.iso)![0];
      const ev = evidencePrice(state, p.iso, product);
      let piecePriceEUR: number;
      let priceStatus: MarketRow["priceStatus"];
      let spread: { min: number; median: number; max: number } | null = null;
      if (ev.median !== null) {
        piecePriceEUR = ev.median;
        priceStatus = ev.max > ev.min * 2 ? "INCONSISTENT" : "CHECKED_EVIDENCE";
        spread = { min: ev.min, median: ev.median, max: ev.max };
      } else {
        piecePriceEUR = round2(
          Math.min(...ledgerByIso.get(p.iso)!.map((r) => r.unitPriceEUR)),
        );
        priceStatus = "SYNTHETIC_LEDGER";
      }
      const landed = computeLanded(piecePriceEUR, p, demandQty, priceStatus);
      const leadTime = computeLeadTime(p);
      const coverage = computeCoverage(demandQty, p);
      const evidenceScore =
        priceStatus === "CHECKED_EVIDENCE" ? 1 : priceStatus === "INCONSISTENT" ? 0.25 : 0.55;
      return {
        iso: p.iso,
        name: p.iso,
        supplierId: p.supplierId,
        brand: p.brand,
        unit: ledger.unit,
        route: ledger.route,
        piecePriceEUR,
        priceStatus,
        priceSpread: spread,
        evidenceRows: ev.count,
        evidenceIssues: ev.issues,
        demandQty,
        availableQty: coverage.availableQty,
        coveragePct: coverage.coveragePct,
        canFulfill: coverage.canFulfill,
        productionCapacityPerMonth: coverage.productionCapacityPerMonth,
        transportMode: p.transport.mode,
        distanceKm: p.transport.distanceKm,
        landed,
        leadTime,
        reliabilityScore: p.reliability.reliabilityScore,
        onTimeDeliveryPercent: p.reliability.onTimeDeliveryPercent,
        supplierRating: p.trust.supplierRating,
        numberOfReviews: p.trust.numberOfReviews,
        verifiedBuyerPercent: p.trust.verifiedBuyerPercent,
        evidenceScore,
        priceConfidence: priceStatus === "INCONSISTENT" ? 0.25 : 1,
        scores: {} as MarketRow["scores"],
        ranks: {} as MarketRow["ranks"],
      };
    });

  const { scores, ranks } = rankRows(rows);
  rows.forEach((r, i) => {
    r.scores = scores[i];
    r.ranks = ranks[i];
  });

  return {
    rows,
    demandQty,
    demandBasis,
    hasFRDecision: frEvidence.median !== null,
  };
}
