// Generates kit/dataset/sourcing-profiles.json — synthetic supplier/country
// sourcing profiles. All values are fake. Run: node kit/scripts/generate-sourcing.mjs
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const COORDS = {
  AT: { lat: 47.6, lon: 14.1 }, DE: { lat: 51.2, lon: 10.4 }, SE: { lat: 62, lon: 15 },
  FR: { lat: 46.6, lon: 2.4 }, IT: { lat: 42.8, lon: 12.5 }, ES: { lat: 40.4, lon: -3.7 },
  PT: { lat: 39.6, lon: -8 }, CH: { lat: 46.8, lon: 8.2 }, PL: { lat: 52, lon: 19.3 },
  CZ: { lat: 49.8, lon: 15.5 }, SK: { lat: 48.7, lon: 19.5 }, HU: { lat: 47.2, lon: 19.5 },
  SI: { lat: 46.1, lon: 14.8 }, HR: { lat: 45.5, lon: 16 }, RO: { lat: 45.9, lon: 25 },
  BG: { lat: 42.8, lon: 25.2 }, RS: { lat: 44.2, lon: 20.9 }, BA: { lat: 44.2, lon: 17.8 },
  AL: { lat: 41.1, lon: 20.1 }, MK: { lat: 41.6, lon: 21.7 }, ME: { lat: 42.7, lon: 19.4 },
  UA: { lat: 49, lon: 32 }, CN: { lat: 35, lon: 104 }, JP: { lat: 36.2, lon: 138.3 },
  MY: { lat: 3.9, lon: 102 }, SG: { lat: 1.35, lon: 103.8 }, CL: { lat: -33.5, lon: -70.7 },
  CO: { lat: 4.6, lon: -74 }, XK: { lat: 42.6, lon: 20.9 },
};

const EU = ["AT", "DE", "SE", "FR", "IT", "ES", "PT", "PL", "CZ", "SK", "HU", "SI", "HR", "RO", "BG"];

// distance from FR (buyer market)
const dist = (iso) => {
  const a = COORDS.FR; const b = COORDS[iso];
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat); const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
};

const round2 = (n) => Math.round(n * 100) / 100;

// transport mode rules (synthetic)
const modeFor = (iso) => {
  if (iso === "FR") return "domestic";
  if (["CN", "MY", "CL", "CO"].includes(iso)) return "sea";
  if (["JP", "SG"].includes(iso)) return "air";
  if (EU.includes(iso)) return dist(iso) <= 1800 ? "road" : "rail";
  return dist(iso) <= 1800 ? "road" : "rail";
};

// reliability / trust / capacity tuning (synthetic)
const TUNE = {
  FR: { onTime: 91, fulfill: 92, defect: 3.0, cancel: 3.5, orders: 239, rating: 4.8, verified: 94, capacity: 5000, available: 3000, production: 1 },
  DE: { onTime: 94, fulfill: 96, defect: 2.0, cancel: 2.8, orders: 310, rating: 4.6, verified: 88, capacity: 8000, available: 5000, production: 2, wh: 420 },
  CH: { onTime: 95, fulfill: 96, defect: 1.8, cancel: 2.5, orders: 172, rating: 4.5, verified: 90, capacity: 2500, available: 800, production: 2 },
  RS: { onTime: 90, fulfill: 92, defect: 3.0, cancel: 4.0, orders: 96, rating: 4.2, verified: 71, capacity: 4000, available: 700, production: 3 },
  HU: { onTime: 94, fulfill: 95, defect: 2.0, cancel: 3.0, orders: 141, rating: 4.4, verified: 84, capacity: 3000, available: 1000, production: 2 },
  IT: { onTime: 93, fulfill: 94, defect: 2.2, cancel: 3.2, orders: 198, rating: 4.3, verified: 82, capacity: 6000, available: 4000, production: 2 },
  CN: { onTime: 88, fulfill: 90, defect: 3.5, cancel: 5.0, orders: 412, rating: 4.0, verified: 61, capacity: 50000, available: 50000, production: 5 },
  JP: { onTime: 99, fulfill: 99, defect: 0.5, cancel: 0.8, orders: 287, rating: 4.5, verified: 90, capacity: 8000, available: 6000, production: 5 },
  AT: { onTime: 95, fulfill: 96, defect: 1.7, cancel: 2.3, orders: 118, rating: 4.5, verified: 89, capacity: 3000, available: 1800, production: 2 },
  SE: { onTime: 95, fulfill: 96, defect: 1.6, cancel: 2.2, orders: 104, rating: 4.5, verified: 91, capacity: 3500, available: 2500, production: 2 },
  ES: { onTime: 92, fulfill: 93, defect: 2.4, cancel: 3.0, orders: 155, rating: 4.3, verified: 80, capacity: 4000, available: 2000, production: 3 },
  PT: { onTime: 91, fulfill: 92, defect: 2.6, cancel: 3.4, orders: 121, rating: 4.2, verified: 77, capacity: 4000, available: 2000, production: 3 },
  PL: { onTime: 91, fulfill: 93, defect: 2.6, cancel: 3.4, orders: 164, rating: 4.2, verified: 79, capacity: 4500, available: 3000, production: 3 },
  CZ: { onTime: 92, fulfill: 94, defect: 2.3, cancel: 3.1, orders: 137, rating: 4.3, verified: 83, capacity: 3500, available: 2200, production: 3 },
  SK: { onTime: 91, fulfill: 93, defect: 2.7, cancel: 3.5, orders: 98, rating: 4.2, verified: 78, capacity: 3500, available: 2000, production: 3 },
  SI: { onTime: 92, fulfill: 94, defect: 2.2, cancel: 3.0, orders: 88, rating: 4.3, verified: 84, capacity: 3000, available: 1600, production: 3 },
  HR: { onTime: 91, fulfill: 92, defect: 2.8, cancel: 3.6, orders: 92, rating: 4.2, verified: 76, capacity: 3000, available: 1500, production: 3 },
  RO: { onTime: 90, fulfill: 92, defect: 3.0, cancel: 4.0, orders: 109, rating: 4.1, verified: 72, capacity: 4000, available: 2500, production: 3 },
  BG: { onTime: 89, fulfill: 90, defect: 3.3, cancel: 4.4, orders: 84, rating: 4.0, verified: 69, capacity: 3000, available: 1600, production: 3 },
  BA: { onTime: 89, fulfill: 90, defect: 3.2, cancel: 4.5, orders: 76, rating: 4.1, verified: 70, capacity: 2500, available: 1200, production: 3 },
  AL: { onTime: 88, fulfill: 89, defect: 3.6, cancel: 4.8, orders: 63, rating: 4.0, verified: 64, capacity: 2500, available: 1100, production: 3 },
  MK: { onTime: 89, fulfill: 90, defect: 3.4, cancel: 4.6, orders: 71, rating: 4.0, verified: 67, capacity: 2500, available: 1200, production: 3 },
  ME: { onTime: 88, fulfill: 89, defect: 3.5, cancel: 4.7, orders: 58, rating: 3.9, verified: 62, capacity: 2500, available: 1100, production: 3 },
  UA: { onTime: 87, fulfill: 88, defect: 3.8, cancel: 5.0, orders: 89, rating: 4.0, verified: 66, capacity: 4000, available: 2500, production: 4 },
  XK: { onTime: 89, fulfill: 90, defect: 3.4, cancel: 4.5, orders: 55, rating: 4.0, verified: 65, capacity: 2500, available: 1200, production: 3 },
  MY: { onTime: 87, fulfill: 89, defect: 3.8, cancel: 5.2, orders: 190, rating: 4.0, verified: 60, capacity: 20000, available: 20000, production: 5 },
  SG: { onTime: 92, fulfill: 94, defect: 2.0, cancel: 2.4, orders: 176, rating: 4.4, verified: 87, capacity: 12000, available: 9000, production: 3 },
  CL: { onTime: 85, fulfill: 87, defect: 4.2, cancel: 6.0, orders: 81, rating: 3.9, verified: 58, capacity: 10000, available: 10000, production: 5 },
  CO: { onTime: 85, fulfill: 86, defect: 4.4, cancel: 6.2, orders: 74, rating: 3.8, verified: 55, capacity: 10000, available: 10000, production: 5 },
};

const SUPPLIERS = {
  AT: ["sup-orbit", "Würth"], DE: ["sup-helio", "Helio"], SE: ["sup-vanta", "Vanta"], FR: ["sup-aster", "Aster"],
  IT: ["sup-velora", "Velora"], ES: ["sup-lumen", "Lumen"], PT: ["sup-novex", "Novex"], CH: ["sup-arcus", "Arcus"],
  PL: ["sup-cobalt", "Cobalt"], CZ: ["sup-solis", "Solis"], SK: ["sup-orbit", "Würth"], HU: ["sup-helio", "Helio"],
  SI: ["sup-vanta", "Vanta"], HR: ["sup-aster", "Aster"], RO: ["sup-velora", "Velora"], BG: ["sup-lumen", "Lumen"],
  RS: ["sup-novex", "Novex"], BA: ["sup-arcus", "Arcus"], AL: ["sup-cobalt", "Cobalt"], MK: ["sup-solis", "Solis"],
  ME: ["sup-orbit", "Würth"], UA: ["sup-helio", "Helio"], CN: ["sup-vanta", "Vanta"], JP: ["sup-aster", "Aster"],
  MY: ["sup-velora", "Velora"], SG: ["sup-lumen", "Lumen"], CL: ["sup-novex", "Novex"], CO: ["sup-arcus", "Arcus"],
  XK: ["sup-cobalt", "Cobalt"],
};

const RATES = {
  roadPerKmUnit: 0.001,
  railPerKmUnit: 0.0014,
  seaPerUnit: 1.6,
  airPerUnit: 4.2,
  fuelPct: { road: 0.12, rail: 0.12, sea: 0.08, air: 0.15 },
  logisticsDirect: 0.08,
  logisticsIndirect: 0.2,
  handling: 0.06,
  handlingAir: 0.3,
  insurancePctOfPiece: 0.003,
  customsPerUnitNonEU: 0.25,
  customsPerUnitAir: 0.1,
  dutyPctNonEU: 0.025,
  warehouse: {
    domestic: { cost: 300, days: 4 }, road: { cost: 500, days: 5 },
    rail: { cost: 520, days: 6 }, sea: { cost: 650, days: 10 }, air: { cost: 380, days: 2 },
  },
  transitDays: { road: (km) => Math.round(1 + km / 450), rail: (km) => Math.round(1 + km / 600), sea: (km) => Math.min(30, 16 + Math.round(km / 1500)), air: () => 2 },
  handlingTimeDays: 1,
  customsDelayNonEU: 2,
};

const profiles = Object.keys(COORDS).map((iso) => {
  const mode = modeFor(iso);
  const t = TUNE[iso];
  const km = dist(iso);
  const isEU = EU.includes(iso);
  const transportPerUnit = mode === "domestic" ? 0
    : mode === "road" ? round2(RATES.roadPerKmUnit * km)
    : mode === "rail" ? round2(RATES.railPerKmUnit * km)
    : mode === "sea" ? RATES.seaPerUnit
    : RATES.airPerUnit;
  const fuelPerUnit = mode === "domestic" ? 0 : round2(transportPerUnit * RATES.fuelPct[mode]);
  const reliabilityScore = Math.round(0.35 * t.onTime + 0.3 * t.fulfill + 0.15 * (100 - t.defect) + 0.2 * (100 - t.cancel));
  return {
    iso,
    supplierId: SUPPLIERS[iso][0],
    brand: SUPPLIERS[iso][1],
    transport: {
      mode,
      distanceKm: mode === "domestic" ? 0 : km,
      transitDays: mode === "domestic" ? 0 : RATES.transitDays[mode](km),
      costPerUnitEUR: transportPerUnit,
      fuelSurchargePerUnitEUR: fuelPerUnit,
    },
    logistics: {
      feePerUnitEUR: mode === "domestic" ? 0 : round2(mode === "air" ? RATES.handlingAir * 0.5 + 0.05 : RATES.logisticsDirect),
      handlingPerUnitEUR: mode === "domestic" ? 0.06 : mode === "air" ? RATES.handlingAir : RATES.handling,
      customsPerUnitEUR: isEU ? 0 : mode === "air" ? RATES.customsPerUnitAir : RATES.customsPerUnitNonEU,
      dutyPct: isEU ? 0 : RATES.dutyPctNonEU,
      insurancePct: RATES.insurancePctOfPiece,
      warehouseCostPerOrderEUR: t.wh ?? RATES.warehouse[mode].cost,
      expectedStorageDays: RATES.warehouse[mode].days,
    },
    time: {
      productionLeadTimeDays: t.production,
      handlingTimeDays: RATES.handlingTimeDays,
      customsDelayDays: isEU ? 0 : RATES.customsDelayNonEU,
    },
    supply: {
      productionCapacityPerMonth: t.capacity,
      availableQuantity: t.available,
    },
    reliability: {
      onTimeDeliveryPercent: t.onTime,
      historicalFulfillmentPercent: t.fulfill,
      defectRatePercent: t.defect,
      cancellationRatePercent: t.cancel,
      numberOfHistoricalOrders: t.orders,
      reliabilityScore,
    },
    trust: {
      supplierRating: t.rating,
      numberOfReviews: Math.round(t.orders * 1.6),
      verifiedBuyerPercent: t.verified,
      communityTrustScore: Math.round(t.rating * 18.7 + t.verified * 0.06),
    },
    evidence: {
      source: "synthetic-sourcing-profiles",
      sourceType: "synthetic_fixture",
      isSynthetic: true,
      isAssumption: false,
      confidence: mode === "domestic" ? "high" : mode === "air" ? "medium" : "medium",
      lastUpdated: "2026-09-18",
    },
  };
});

const internalOps = {
  employeeCount: 42,
  warehouseEmployees: 18,
  logisticsEmployees: 9,
  procurementEmployees: 6,
  averageSalaryEUR: 2081,
  monthlySalaryCostEUR: 87400,
  employerContributionsEUR: 17680,
  overtimeCostEUR: 2400,
  temporaryLaborCostEUR: 3100,
  totalMonthlyLaborCostEUR: 110580,
  orderLabor: {
    receivingEUR: 320,
    inspectionEUR: 180,
    warehousingEUR: 240,
    administrationEUR: 95,
    estimatedInternalHandlingEUR: 835,
    laborHoursRequiredForOrder: 22,
  },
  status: "SYNTHETIC",
  note: "Internal operating cost model, separate from supplier landed cost. Never added to the supplier price.",
};

const meta = {
  generated: "2026-09-18",
  synthetic: true,
  note: "ALL values are fake. No real supplier quotes, freight rates, payrolls or ratings. Transport rules use synthetic rate tables; reliability/trust/capacity are invented; distance is real great-circle geometry only.",
};

writeFileSync(
  resolve(process.cwd(), "kit/dataset/sourcing-profiles.json"),
  JSON.stringify({ meta, profiles, internalOps }, null, 2) + "\n",
);
console.log(`Wrote ${profiles.length} profiles.`);
