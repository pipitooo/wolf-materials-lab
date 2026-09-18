import { z } from "zod";

import { openEngine } from "src/server/evidence";
import {
  buildModel,
  buildRecommendation,
  loadLedger,
  loadProfiles,
  SCENARIO_MODES,
  SCENARIO_WEIGHTS,
} from "src/server/sourcing";

// Read-only sourcing model: synthetic ledger + synthetic profiles + checked
// evidence override. Not part of the versioned approval workflow; the decision
// the buyer approves is the underlying FR finding.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const product = z
    .string()
    .regex(/^WLF-\d{4}$/)
    .optional()
    .parse(new URL(req.url).searchParams.get("product") ?? undefined);

  const txs = loadLedger();
  const seen = new Map<string, string>();
  for (const t of txs)
    if (!seen.has(t.productCode)) seen.set(t.productCode, t.description);
  const products = [...seen.entries()].map(([code, description]) => ({
    code,
    description,
  }));

  const note =
    "All sourcing figures are synthetic market data plus checked evidence rows from the versioned store. No real supplier quotes.";

  if (!product)
    return Response.json({
      products,
      note,
      markets: [],
      internalOps: null,
      weights: SCENARIO_WEIGHTS,
      modes: SCENARIO_MODES,
      demand: null,
    });

  if (!products.some((p) => p.code === product))
    return Response.json({ error: "Unknown product." }, { status: 404 });

  const { internalOps } = loadProfiles();

  const engine = openEngine();
  let state;
  try {
    state = engine.state();
  } finally {
    engine.close();
  }

  const model = buildModel(state, product);
  const recommendations = SCENARIO_MODES.map((m) =>
    buildRecommendation(model.rows, m, model.demandQty),
  );

  return Response.json({
    products,
    product,
    description: seen.get(product) ?? product,
    note,
    modes: SCENARIO_MODES,
    weights: SCENARIO_WEIGHTS,
    demand: {
      qty: model.demandQty,
      basis: model.demandBasis,
      market: "FR",
    },
    hasFRDecision: model.hasFRDecision,
    markets: model.rows,
    recommendations,
    internalOps,
  });
}
