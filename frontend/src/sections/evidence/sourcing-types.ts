export type ScenarioMode =
  | "BALANCED"
  | "LOWEST_COST"
  | "FASTEST_DELIVERY"
  | "MOST_RELIABLE"
  | "LOWEST_RISK";

export type Weights = {
  cost: number;
  time: number;
  supply: number;
  reliability: number;
  trust: number;
  evidence: number;
};

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
  transportMode: "domestic" | "road" | "rail" | "sea" | "air";
  distanceKm: number;
  landed: { components: CostComponent[]; totalEUR: number; perUnitEUR: number };
  leadTime: {
    production: number;
    handling: number;
    transit: number;
    customs: number;
    totalDays: number;
  };
  reliabilityScore: number;
  onTimeDeliveryPercent: number;
  supplierRating: number;
  numberOfReviews: number;
  verifiedBuyerPercent: number;
  evidenceScore: number;
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

export type InternalOps = {
  employeeCount: number;
  warehouseEmployees: number;
  logisticsEmployees: number;
  procurementEmployees: number;
  averageSalaryEUR: number;
  monthlySalaryCostEUR: number;
  employerContributionsEUR: number;
  overtimeCostEUR: number;
  temporaryLaborCostEUR: number;
  totalMonthlyLaborCostEUR: number;
  orderLabor: {
    receivingEUR: number;
    inspectionEUR: number;
    warehousingEUR: number;
    administrationEUR: number;
    estimatedInternalHandlingEUR: number;
    laborHoursRequiredForOrder: number;
  };
  status: string;
  note: string;
};

export type SourcingPayload = {
  products: { code: string; description: string }[];
  product: string;
  description: string;
  note: string;
  modes: ScenarioMode[];
  weights: Record<ScenarioMode, Weights>;
  demand: { qty: number; basis: string; market: string } | null;
  hasFRDecision: boolean;
  markets: MarketRow[];
  recommendations: Recommendation[];
  internalOps: InternalOps | null;
};

export const MODE_LABEL: Record<ScenarioMode, string> = {
  BALANCED: "Balanced",
  LOWEST_COST: "Lowest cost",
  FASTEST_DELIVERY: "Fastest delivery",
  MOST_RELIABLE: "Most reliable",
  LOWEST_RISK: "Lowest risk",
};

export const STATUS_LABEL: Record<
  "CHECKED_EVIDENCE" | "SYNTHETIC" | "DERIVED" | "INCONSISTENT" | "SYNTHETIC_LEDGER",
  string
> = {
  CHECKED_EVIDENCE: "✓ SOURCE-BACKED",
  SYNTHETIC: "S SYNTHETIC",
  DERIVED: "◆ DERIVED",
  INCONSISTENT: "⚠ NEEDS REVIEW",
  SYNTHETIC_LEDGER: "S SYNTHETIC",
};

export const eur = (n: number) =>
  n.toLocaleString("en-GB", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  });
