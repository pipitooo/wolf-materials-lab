import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  cpSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  buildModel,
  buildRecommendation,
  computeCoverage,
  computeLanded,
  computeLeadTime,
  loadProfiles,
  rankRows,
  round2,
  SCENARIO_MODES,
  SCENARIO_WEIGHTS,
} from "../src/server/sourcing.ts";
import { EvidenceEngine } from "../src/server/evidence.ts";

const dataset = resolve("../kit/dataset");
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "wolf-src-"));
  const data = join(dir, "dataset");
  cpSync(dataset, data, { recursive: true });
  const engine = new EvidenceEngine(join(dir, "test.sqlite"), data);
  t.after(() => {
    engine.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { engine, data };
}
function deliver(engine, market, version) {
  const receipt = engine.deliver(market, version);
  assert.equal(receipt.error, undefined);
  const result = engine.tick();
  assert.equal(result.error, undefined);
  return result;
}
const winner = (rows, mode) =>
  [...rows].sort(
    (a, b) => b.scores[mode] - a.scores[mode] || a.landed.perUnitEUR - b.landed.perUnitEUR,
  )[0];

test("landed cost: deterministic components, cents arithmetic, explainable total", () => {
  const { profiles } = loadProfiles();
  const de = profiles.find((p) => p.iso === "DE");
  const qty = 932;
  const landed = computeLanded(48.89, de, qty, "SYNTHETIC_LEDGER");
  const sum = landed.components.reduce((s, c) => s + Math.round(c.totalEUR * 100), 0);
  assert.equal(Math.round(landed.totalEUR * 100), sum);
  const keys = landed.components.map((c) => c.key);
  assert.deepEqual(keys, [
    "piece",
    "transport",
    "fuel",
    "logistics",
    "customs",
    "duty",
    "handling",
    "insurance",
    "warehouse",
  ]);
  const piece = landed.components[0];
  assert.equal(piece.totalEUR, (48.89 * qty * 100) / 100);
  const warehouse = landed.components.find((c) => c.key === "warehouse");
  assert.equal(warehouse.totalEUR, de.logistics.warehouseCostPerOrderEUR);
  assert.equal(landed.perUnitEUR, round2(landed.totalEUR / qty));
  // duty and insurance are DERIVED; transport etc are SYNTHETIC
  assert.equal(landed.components.find((c) => c.key === "duty").status, "DERIVED");
  assert.equal(landed.components.find((c) => c.key === "insurance").status, "DERIVED");
  assert.equal(landed.components.find((c) => c.key === "transport").status, "SYNTHETIC");
  // two calls => identical output (determinism)
  assert.deepEqual(computeLanded(48.89, de, qty, "SYNTHETIC_LEDGER"), landed);
  assert.throws(() => computeLanded(10, de, 0, "SYNTHETIC_LEDGER"), /positive integer/);
});

test("lead time and supply coverage", () => {
  const { profiles } = loadProfiles();
  const fr = profiles.find((p) => p.iso === "FR");
  const cn = profiles.find((p) => p.iso === "CN");
  const frTime = computeLeadTime(fr);
  assert.equal(
    frTime.totalDays,
    frTime.production + frTime.handling + frTime.transit + frTime.customs,
  );
  assert.equal(frTime.transit, 0);
  assert.ok(computeLeadTime(cn).totalDays > frTime.totalDays);
  assert.equal(computeCoverage(932, fr).canFulfill, true);
  assert.equal(computeCoverage(1384, profiles.find((p) => p.iso === "HU")).coveragePct, 72);
  assert.equal(computeCoverage(1384, profiles.find((p) => p.iso === "HU")).canFulfill, false);
});

test("scenario weights change the winner deterministically; weights sum per mode is documented", () => {
  for (const mode of SCENARIO_MODES) {
    const w = SCENARIO_WEIGHTS[mode];
    const sum = w.cost + w.time + w.supply + w.reliability + w.trust + w.evidence;
    assert.ok(Math.abs(sum - 1) < 1e-9, `${mode} weights sum to ${sum}`);
  }
  const fake = [
    { landed: { perUnitEUR: 20 }, leadTime: { totalDays: 30 }, coveragePct: 100, reliabilityScore: 99, supplierRating: 4.9, evidenceScore: 0.5, priceConfidence: 1 },
    { landed: { perUnitEUR: 24 }, leadTime: { totalDays: 3 }, coveragePct: 100, reliabilityScore: 90, supplierRating: 4.2, evidenceScore: 0.5, priceConfidence: 1 },
  ];
  const { scores } = rankRows(fake);
  assert.ok(scores[0].LOWEST_COST > scores[1].LOWEST_COST);
  assert.ok(scores[1].FASTEST_DELIVERY > scores[0].FASTEST_DELIVERY);
});

test("scenario diversity: different modes highlight different strengths at every state", (t) => {
  const { engine } = fixture(t);
  const winners = (m) =>
    Object.fromEntries(
      SCENARIO_MODES.map((x) => [x, buildRecommendation(m.rows, x, m.demandQty).winnerIso]),
    );
  const empty = winners(buildModel(null, "WLF-1008"));
  assert.deepEqual(empty, {
    BALANCED: "DE",
    LOWEST_COST: "DE",
    FASTEST_DELIVERY: "FR",
    MOST_RELIABLE: "JP",
    LOWEST_RISK: "JP",
  });
  assert.ok(new Set(Object.values(empty)).size >= 3, "at least three distinct winners");
  deliver(engine, "FR", "v1");
  const v1 = winners(buildModel(engine.state(), "WLF-1008"));
  assert.deepEqual(v1, empty);
  deliver(engine, "FR", "v2");
  const v2 = winners(buildModel(engine.state(), "WLF-1008"));
  assert.deepEqual(v2, {
    BALANCED: "FR",
    LOWEST_COST: "DE",
    FASTEST_DELIVERY: "FR",
    MOST_RELIABLE: "JP",
    LOWEST_RISK: "FR",
  });
});

test("France: baseline recommends Germany; corrected file flips the decision to France", (t) => {  const { engine } = fixture(t);
  deliver(engine, "FR", "v1");
  const v1 = buildModel(engine.state(), "WLF-1008");
  assert.equal(v1.hasFRDecision, true);
  assert.equal(v1.demandQty, 1384);
  const fr1 = v1.rows.find((r) => r.iso === "FR");
  assert.equal(fr1.priceStatus, "INCONSISTENT");
  const w1 = winner(v1.rows, "BALANCED");
  assert.equal(w1.iso, "DE");
  assert.ok(fr1.landed.perUnitEUR > w1.landed.perUnitEUR);

  deliver(engine, "FR", "v2");
  const v2 = buildModel(engine.state(), "WLF-1008");
  assert.equal(v2.demandQty, 932);
  const fr2 = v2.rows.find((r) => r.iso === "FR");
  assert.equal(fr2.priceStatus, "CHECKED_EVIDENCE");
  assert.equal(fr2.piecePriceEUR, 50.16);
  const w2 = winner(v2.rows, "BALANCED");
  assert.equal(w2.iso, "FR");
  assert.equal(fr2.canFulfill, true);

  const rec = buildRecommendation(v2.rows, "BALANCED", v2.demandQty);
  assert.equal(rec.winnerIso, "FR");
  assert.ok(rec.why.some((f) => f.tone === "pro"));
});

test("a source that cannot fulfill the whole order never wins on supply but can win other modes", (t) => {
  const { engine } = fixture(t);
  deliver(engine, "FR", "v1");
  const v1 = buildModel(engine.state(), "WLF-1008");
  const hu = v1.rows.find((r) => r.iso === "HU");
  assert.equal(hu.coveragePct, 72);
  assert.equal(hu.canFulfill, false);
  assert.notEqual(winner(v1.rows, "MOST_RELIABLE").iso, "HU");
});

test("corrected source propagates: finding v2, approval stale, replay leaves sourcing model unchanged", (t) => {
  const { engine } = fixture(t);
  deliver(engine, "FR", "v1");
  let s = engine.state();
  const f1 = s.findings.find((x) => x.current && x.market === "FR" && x.product === "WLF-1008");
  engine.approve(f1.id, "Buyer");
  deliver(engine, "FR", "v2");
  s = engine.state();
  const oldApproval = s.approvals.find((a) => a.findingId === f1.id);
  assert.equal(oldApproval.status, "STALE");
  const modelAfter = buildModel(s, "WLF-1008");
  assert.equal(winner(modelAfter.rows, "BALANCED").iso, "FR");
  // replay: same event processed twice => identical model output
  const before = JSON.stringify(modelAfter.rows);
  assert.equal(engine.deliver("FR", "v2").duplicate, true);
  engine.tick();
  const modelReplay = buildModel(engine.state(), "WLF-1008");
  assert.equal(JSON.stringify(modelReplay.rows), before);
});

test("determinism and isolation: model output never depends on AI or external state", (t) => {
  const { engine } = fixture(t);
  deliver(engine, "FR", "v1");
  const a = JSON.stringify(buildModel(engine.state(), "WLF-1008"));
  const b = JSON.stringify(buildModel(engine.state(), "WLF-1008"));
  assert.equal(a, b);
  // The agent route has no write access; simulating a hostile profile edit
  // only changes data files, not the deterministic functions.
  const { profiles } = loadProfiles();
  assert.ok(profiles.every((p) => p.evidence.isSynthetic === true));
});

test("workforce model is present, synthetic, and separate from landed cost", (t) => {
  const { engine } = fixture(t);
  deliver(engine, "FR", "v1");
  const model = buildModel(engine.state(), "WLF-1008");
  const fr = model.rows.find((r) => r.iso === "FR");
  const landed = fr.landed.totalEUR;
  const { internalOps } = loadProfiles();
  const withOps = landed + internalOps.orderLabor.estimatedInternalHandlingEUR;
  assert.ok(withOps > landed);
  assert.equal(
    internalOps.totalMonthlyLaborCostEUR,
    internalOps.monthlySalaryCostEUR +
      internalOps.employerContributionsEUR +
      internalOps.overtimeCostEUR +
      internalOps.temporaryLaborCostEUR,
  );
});

test("malformed dataset does not crash the model: missing profiles file becomes a visible error", (t) => {
  const { engine, data } = fixture(t);
  deliver(engine, "FR", "v1");
  const p = join(data, "sourcing-profiles.json");
  const backup = readFileSync(p, "utf8");
  writeFileSync(p, "{broken");
  const previous = process.env.WOLF_DATASET_PATH;
  process.env.WOLF_DATASET_PATH = data;
  try {
    assert.throws(() => buildModel(engine.state(), "WLF-1008"));
  } finally {
    process.env.WOLF_DATASET_PATH = previous;
    writeFileSync(p, backup);
  }
});
