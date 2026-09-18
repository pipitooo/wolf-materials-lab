"use client";

import type { State, Finding } from "src/server/evidence";
import type {
  MarketRow,
  ScenarioMode,
  Recommendation,
  SourcingPayload,
} from "./sourcing-types";

import { useMemo, useState, useEffect, useCallback } from "react";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import Drawer from "@mui/material/Drawer";
import Switch from "@mui/material/Switch";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CardHeader from "@mui/material/CardHeader";
import FormControlLabel from "@mui/material/FormControlLabel";

import { SourcingMap } from "./sourcing-map";
import { eur, MODE_LABEL, STATUS_LABEL } from "./sourcing-types";

const TIER_GREEN = "#2E9E5B";
const TIER_YELLOW = "#E8A13A";
const TIER_RED = "#D9483B";
const tierColor = (rank: number, total: number) => {
  if (total <= 1) return TIER_GREEN;
  if (rank <= Math.ceil(total / 3)) return TIER_GREEN;
  if (rank <= Math.ceil((2 * total) / 3)) return TIER_YELLOW;
  return TIER_RED;
};

function Bar({ pct, color, height = 8 }: { pct: number; color: string; height?: number }) {
  return (
    <Box sx={{ height, borderRadius: 1, bgcolor: "action.hover", overflow: "hidden" }}>
      <Box
        sx={{
          width: `${Math.max(4, Math.min(100, pct))}%`,
          height: "100%",
          borderRadius: 1,
          bgcolor: color,
          transition: "width .5s ease",
        }}
      />
    </Box>
  );
}

function MetricCard({
  label,
  value,
  sub,
  pct,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  pct: number;
  color: string;
}) {
  return (
    <Box sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1.5, flex: 1, minWidth: 108 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
        {value}
      </Typography>
      <Bar pct={pct} color={color} />
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
        {sub}
      </Typography>
    </Box>
  );
}

type Props = {
  state: State | null;
  onApprove: (findingId: string) => Promise<boolean>;
  onInspect: (f: Finding) => void;
};

type DrawerKind = "cost" | "timeline" | "data" | "compare" | "weights" | null;

export function SourcingCard({ state, onApprove, onInspect }: Props) {
  const [payload, setPayload] = useState<SourcingPayload | null>(null);
  const [prevPayload, setPrevPayload] = useState<SourcingPayload | null>(null);
  const [product, setProduct] = useState("WLF-1008");
  const [mode, setMode] = useState<ScenarioMode>("BALANCED");
  const [selectedIso, setSelectedIso] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [showOps, setShowOps] = useState(false);
  const [ai, setAi] = useState<{
    findingId: string;
    summary: string;
    action: string;
    note: string;
    confidence: string;
  } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");

  const frFinding = state?.findings.find(
    (f) => f.current && f.market === "FR" && f.product === product,
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const catalog = await fetch("/api/evidence/supply").then((r) =>
        r.ok ? r.json() : null,
      );
      const res2 = await fetch(`/api/evidence/supply?product=${product}`);
      if (res2.ok && active) {
        const json = await res2.json();
        if (!json.products?.length && catalog?.products?.length)
          json.products = catalog.products;
        setPayload(json);
        setSelectedIso(json.recommendations?.[0]?.winnerIso ?? null);
      } else if (catalog && active) {
        setPayload(catalog);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadProduct = useCallback(
    async (code: string) => {
      setProduct(code);
      setAi(null);
      setAiError("");
      const res = await fetch(`/api/evidence/supply?product=${code}`);
      if (res.ok) {
        const json = await res.json();
        setPayload((prev) => {
          if (prev) setPrevPayload(prev);
          return json;
        });
        setSelectedIso(json.recommendations?.[0]?.winnerIso ?? null);
      }
    },
    [],
  );

  // When checked evidence changes (new finding version), recompute the model.
  useEffect(() => {
    if (!frFinding) return;
    void loadProduct(product);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frFinding?.id]);

  const markets = useMemo(() => payload?.markets ?? [], [payload]);
  const byIso = useMemo(
    () => new Map(markets.map((m) => [m.iso, m])),
    [markets],
  );
  const rec: Recommendation | undefined = payload?.recommendations?.find(
    (r) => r.mode === mode,
  );
  const winner: MarketRow | undefined = rec ? byIso.get(rec.winnerIso) : undefined;
  const selected = selectedIso ? byIso.get(selectedIso) : undefined;

  const prevWinner = prevPayload?.recommendations?.find((r) => r.mode === mode);
  const winnerChanged =
    prevWinner && rec && prevWinner.winnerIso !== rec.winnerIso;

  const approval = frFinding
    ? state?.approvals.find((a) => a.findingId === frFinding.id && a.status === "APPROVED")
    : undefined;
  const stale = state?.approvals
    .filter(
      (a) =>
        a.status === "STALE" &&
        state.findings.find((x) => x.id === a.findingId)?.key === frFinding?.key,
    )
    .at(-1);
  const findingHistory = state?.findings
    .filter((f) => f.key === `FR:${product}`)
    .sort((a, b) => a.version - b.version) ?? [];

  const demand = payload?.demand?.qty ?? 0;
  const maxCost = Math.max(...markets.map((m) => m.landed.perUnitEUR), 1);
  const maxDays = Math.max(...markets.map((m) => m.leadTime.totalDays), 1);

  async function askAi() {
    if (!frFinding) return;
    setAiBusy(true);
    setAiError("");
    try {
      const res = await fetch("/api/evidence/agent/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId: frFinding.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI review failed");
      setAi({
        findingId: frFinding.id,
        summary: data.proposal.summary,
        action: data.proposal.suggestion.action,
        note: data.proposal.suggestion.note,
        confidence: data.proposal.confidence,
      });
    } catch (e) {
      setAiError(String(e instanceof Error ? e.message : e));
    } finally {
      setAiBusy(false);
    }
  }

  const approveEnabled =
    !!frFinding &&
    frFinding.status === "READY" &&
    !approval &&
    payload?.hasFRDecision &&
    !state?.events.some((e) => e.status === "QUEUED" && e.market === "FR");

  const compareRows = compare.map((iso) => byIso.get(iso)).filter(Boolean) as MarketRow[];

  const ops = payload?.internalOps;

  return (
    <Card>
      <CardHeader
        title="Where should we buy?"
        subheader={
          payload
            ? `${payload.description} · demand ${demand.toLocaleString("en-GB")} ${winner?.unit ?? "units"} (${payload.demand?.basis.toLowerCase()})`
            : "Synthetic sourcing model — guidance only, not part of the versioned approval workflow."
        }
        action={
          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
            <TextField
              select
              size="small"
              label="Product"
              value={product}
              onChange={(e) => void loadProduct(e.target.value)}
              sx={{ minWidth: 240 }}
            >
              {(payload?.products ?? []).map((p) => (
                <MenuItem key={p.code} value={p.code}>
                  {p.code} · {p.description}
                </MenuItem>
              ))}
            </TextField>
            <Button size="small" onClick={() => setDrawer("data")}>
              Data behind this decision
            </Button>
          </Stack>
        }
      />
      <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ px: 3, pb: 1 }}>
        {payload?.modes.map((m) => (
          <Chip
            key={m}
            clickable
            label={MODE_LABEL[m]}
            color={mode === m ? "primary" : "default"}
            variant={mode === m ? "filled" : "outlined"}
            onClick={() => setMode(m)}
          />
        ))}
        <Chip
          size="small"
          variant="outlined"
          label="How was this calculated?"
          onClick={() => setDrawer("weights")}
          sx={{ ml: "auto", cursor: "pointer" }}
        />
      </Stack>
      <Stack direction={{ xs: "column", lg: "row" }} spacing={2} sx={{ px: 3, pb: 3 }}>
        <Box sx={{ flex: 1.25, minWidth: 0 }}>
          <SourcingMap
            markets={markets}
            selectedIso={selectedIso}
            winnerIso={rec?.winnerIso ?? null}
            onSelect={setSelectedIso}
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {winner && rec ? (
            <Stack spacing={1.5}>
              <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
                <Typography variant="h6">{winner.name}</Typography>
                <Chip size="small" color="success" label={`#${winner.ranks[mode]} of ${markets.length}`} />
                <Chip size="small" variant="outlined" label={winner.brand} />
                <Chip size="small" variant="outlined" label={`${winner.leadTime.totalDays} days`} />
              </Stack>
              <Stack direction="row" gap={2} alignItems="flex-end" flexWrap="wrap">
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    LANDED / {winner.unit.toUpperCase()}
                  </Typography>
                  <Typography variant="h3" color="primary.main" sx={{ lineHeight: 1.1 }}>
                    {eur(winner.landed.perUnitEUR)}
                  </Typography>
                </Box>
                <Stack spacing={0} sx={{ pb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    piece {eur(winner.piecePriceEUR)} · extras{" "}
                    {eur(winner.landed.perUnitEUR - winner.piecePriceEUR)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    order total {eur(winner.landed.totalEUR)} for {demand.toLocaleString("en-GB")} units
                  </Typography>
                </Stack>
              </Stack>
              {winnerChanged && prevWinner && (
                <Alert severity="info" sx={{ py: 0 }}>
                  Recommendation changed:{" "}
                  <strong>{prevPayload?.markets.find((m) => m.iso === prevWinner.winnerIso)?.name}</strong>{" "}
                  → <strong>{winner.name}</strong> after new evidence.
                </Alert>
              )}
              {stale && (
                <Alert severity="warning" sx={{ py: 0 }}>
                  Previous approval is STALE — {stale.staleReason}. Review and approve the current
                  version.
                </Alert>
              )}
              {winner.priceStatus === "INCONSISTENT" && (
                <Alert severity="warning" sx={{ py: 0 }}>
                  Checked records disagree on price ({eur(winner.priceSpread?.min ?? 0)} –{" "}
                  {eur(winner.priceSpread?.max ?? 0)}) — cannot safely compare without review.
                </Alert>
              )}
              <Box>
                <Typography variant="overline">Why this choice?</Typography>
                <Stack spacing={0.5}>
                  {rec.why.map((f, i) => (
                    <Stack key={i} direction="row" gap={1} alignItems="flex-start">
                      <Typography
                        component="span"
                        sx={{
                          color: f.tone === "pro" ? "success.main" : f.tone === "warn" ? "warning.main" : "error.main",
                          fontWeight: 700,
                        }}
                      >
                        {f.tone === "pro" ? "✓" : f.tone === "warn" ? "⚠" : "△"}
                      </Typography>
                      <Typography variant="body2">{f.text}</Typography>
                    </Stack>
                  ))}
                </Stack>
              </Box>
              <Stack direction="row" gap={1} flexWrap="wrap">
                <MetricCard
                  label="COST"
                  value={`${winner.landed.perUnitEUR.toFixed(2)} €`}
                  sub={`#${winner.ranks[mode]} cheapest`}
                  pct={100 - (winner.landed.perUnitEUR / maxCost) * 100}
                  color={tierColor(winner.ranks[mode], markets.length)}
                />
                <MetricCard
                  label="DELIVERY"
                  value={`${winner.leadTime.totalDays} d`}
                  sub={winner.leadTime.totalDays <= 4 ? "Very fast" : "Moderate"}
                  pct={100 - (winner.leadTime.totalDays / maxDays) * 100}
                  color={winner.leadTime.totalDays <= 4 ? TIER_GREEN : TIER_YELLOW}
                />
                <MetricCard
                  label="SUPPLY"
                  value={`${winner.coveragePct}%`}
                  sub={winner.canFulfill ? "Full order" : "Partial only"}
                  pct={winner.coveragePct}
                  color={winner.canFulfill ? TIER_GREEN : TIER_RED}
                />
              </Stack>
              <Stack direction="row" gap={1} flexWrap="wrap">
                <MetricCard
                  label="RELIABILITY"
                  value={`${winner.reliabilityScore}%`}
                  sub={`${winner.onTimeDeliveryPercent}% on-time`}
                  pct={winner.reliabilityScore}
                  color={winner.reliabilityScore >= 95 ? TIER_GREEN : TIER_YELLOW}
                />
                <MetricCard
                  label="TRUST"
                  value={`${winner.supplierRating} / 5`}
                  sub={`${winner.numberOfReviews} reviews`}
                  pct={(winner.supplierRating / 5) * 100}
                  color={winner.supplierRating >= 4.5 ? TIER_GREEN : TIER_YELLOW}
                />
                <MetricCard
                  label="EVIDENCE"
                  value={
                    winner.priceStatus === "CHECKED_EVIDENCE"
                      ? `${winner.evidenceRows} checked`
                      : "Synthetic"
                  }
                  sub={winner.priceStatus === "INCONSISTENT" ? "Needs review" : "9 fields"}
                  pct={
                    winner.priceStatus === "CHECKED_EVIDENCE"
                      ? 100
                      : winner.priceStatus === "INCONSISTENT"
                        ? 45
                        : 70
                  }
                  color={
                    winner.priceStatus === "CHECKED_EVIDENCE" ? TIER_GREEN : TIER_YELLOW
                  }
                />
              </Stack>
              <Stack direction="row" gap={1} flexWrap="wrap">
                <Button size="small" variant="outlined" onClick={() => setDrawer("cost")}>
                  Cost breakdown
                </Button>
                <Button size="small" variant="outlined" onClick={() => setDrawer("timeline")}>
                  Delivery timeline
                </Button>
                <Button size="small" variant="outlined" onClick={() => setDrawer("compare")}>
                  Compare
                </Button>
                <Button size="small" variant="outlined" onClick={() => void askAi()} disabled={aiBusy}>
                  {aiBusy ? "Asking AI…" : "AI review"}
                </Button>
              </Stack>
              {(ai || aiError) && (
                <Alert severity={aiError ? "warning" : "info"} icon={false}>
                  {aiError ? (
                    aiError
                  ) : (
                    <>
                      <Typography variant="caption" color="text.secondary">
                        AI proposal ({ai?.action}, confidence {ai?.confidence}) — arithmetic stays in
                        deterministic code:
                      </Typography>
                      <Typography variant="body2">{ai?.summary}</Typography>
                      <Typography variant="body2">{ai?.note}</Typography>
                    </>
                  )}
                </Alert>
              )}
              <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap" sx={{ mt: 0.5 }}>
                <Button
                  variant="contained"
                  disabled={!approveEnabled}
                  onClick={() => frFinding && void onApprove(frFinding.id)}
                >
                  {approval
                    ? "Approved"
                    : frFinding
                      ? `Approve sourcing decision (v${frFinding.version})`
                      : "Load France baseline to enable"}
                </Button>
                {approval && (
                  <Typography variant="caption" color="success.main">
                    ✓ Approved by {approval.reviewer} · {new Date(approval.at).toLocaleString("en-GB")}
                  </Typography>
                )}
                {frFinding && (
                  <Button size="small" onClick={() => onInspect(frFinding)}>
                    Inspect evidence
                  </Button>
                )}
              </Stack>
              {!payload?.hasFRDecision && (
                <Typography variant="caption" color="text.secondary">
                  No checked FR evidence for this product yet — load the France baseline to turn this
                  into a versioned decision.
                </Typography>
              )}
              {findingHistory.length > 1 && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="overline">Decision history</Typography>
                  <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
                    {findingHistory.map((f, i) => (
                      <Box key={f.id}>
                        <Stack direction="row" gap={1} alignItems="center">
                          <Chip
                            size="small"
                            label={`V${f.version}`}
                            color={f.current ? "primary" : "default"}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {prevWinner && i === 0
                              ? prevPayload?.markets.find((m) => m.iso === prevWinner.winnerIso)?.name
                              : rec?.winnerIso === winner?.iso
                                ? winner?.name
                                : ""}
                          </Typography>
                          {i < findingHistory.length - 1 && <Typography color="text.disabled">→</Typography>}
                        </Stack>
                        {state?.approvals
                          .filter((a) => a.findingId === f.id)
                          .map((a) => (
                            <Typography key={a.id} variant="caption" color={a.status === "STALE" ? "warning.main" : "success.main"} display="block">
                              {a.status === "STALE" ? "⚠ STALE" : "✓ approved"} · {a.reviewer}
                            </Typography>
                          ))}
                      </Box>
                    ))}
                  </Stack>
                </Box>
              )}
            </Stack>
          ) : (
            <Typography color="text.secondary">
              Loading the sourcing model…
            </Typography>
          )}
        </Box>
      </Stack>

      <Divider />
      <Stack direction="row" gap={2} alignItems="center" sx={{ px: 3, py: 1.5 }} flexWrap="wrap">
        <FormControlLabel
          control={<Switch size="small" checked={showOps} onChange={(e) => setShowOps(e.target.checked)} />}
          label={<Typography variant="caption">Operating costs (internal, separate)</Typography>}
        />
        <Typography variant="caption" color="text.secondary">
          {payload?.note}
        </Typography>
      </Stack>
      {showOps && ops && (
        <Stack direction="row" gap={2} flexWrap="wrap" sx={{ px: 3, pb: 2 }}>
          <Box sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1.5, flex: 1, minWidth: 220 }}>
            <Typography variant="overline" color="text.secondary">OPERATING COSTS · {ops.status}</Typography>
            <Typography variant="body2">
              Employees <strong>{ops.employeeCount}</strong> · monthly payroll{" "}
              <strong>{eur(ops.monthlySalaryCostEUR)}</strong>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Warehouse {ops.warehouseEmployees} · logistics {ops.logisticsEmployees} · procurement{" "}
              {ops.procurementEmployees}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Contributions {eur(ops.employerContributionsEUR)} · overtime{" "}
              {eur(ops.overtimeCostEUR)} · temporary {eur(ops.temporaryLaborCostEUR)} →{" "}
              <strong>{eur(ops.totalMonthlyLaborCostEUR)}/month</strong>
            </Typography>
          </Box>
          <Box sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1.5, flex: 1, minWidth: 220 }}>
            <Typography variant="overline" color="text.secondary">ORDER LABOR IMPACT · {ops.status}</Typography>
            <Typography variant="body2">
              Receiving {eur(ops.orderLabor.receivingEUR)} · inspection{" "}
              {eur(ops.orderLabor.inspectionEUR)} · warehousing{" "}
              {eur(ops.orderLabor.warehousingEUR)} · admin {eur(ops.orderLabor.administrationEUR)}
            </Typography>
            <Typography variant="body2">
              Estimated internal handling: <strong>{eur(ops.orderLabor.estimatedInternalHandlingEUR)}</strong>{" "}
              ({ops.orderLabor.laborHoursRequiredForOrder} h) — kept separate from the supplier landed
              cost.
            </Typography>
          </Box>
        </Stack>
      )}

      <Drawer anchor="right" open={drawer === "cost"} onClose={() => setDrawer(null)}>
        <Box sx={{ width: { xs: "100vw", sm: 460 }, p: 3 }}>
          {selected && (
            <Stack spacing={2}>
              <Typography variant="h6">
                Cost breakdown · {selected.name} · {demand.toLocaleString("en-GB")} units
              </Typography>
              <Box>
                {selected.landed.components.map((c) => {
                  const share = (c.totalEUR / selected.landed.totalEUR) * 100;
                  return (
                    <Stack key={c.key} spacing={0.25} sx={{ mb: 1.5 }}>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography variant="body2">
                          {c.label}{" "}
                          <Typography component="span" variant="caption" color="text.secondary">
                            · {eur(c.perUnitEUR)}/unit
                          </Typography>
                        </Typography>
                        <Typography variant="body2">
                          <strong>{eur(c.totalEUR)}</strong> · {share.toFixed(1)}%
                        </Typography>
                      </Stack>
                      <Bar pct={share * 4} color={c.key === "piece" ? "#4C6FFF" : "#9AA7B5"} />
                      <Typography variant="caption" color="text.secondary">
                        {STATUS_LABEL[c.status]} · {c.note}
                      </Typography>
                    </Stack>
                  );
                })}
                <Divider sx={{ my: 1 }} />
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="subtitle1">TOTAL ORDER COST (supplier landed)</Typography>
                  <Typography variant="subtitle1">{eur(selected.landed.totalEUR)}</Typography>
                </Stack>
                {ops && (
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      + internal handling ({ops.status.toLowerCase()}, not supplier cost)
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {eur(ops.orderLabor.estimatedInternalHandlingEUR)}
                    </Typography>
                  </Stack>
                )}
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="subtitle1">TOTAL INCLUDING INTERNAL</Typography>
                  <Typography variant="subtitle1">
                    {eur(selected.landed.totalEUR + (ops?.orderLabor.estimatedInternalHandlingEUR ?? 0))}
                  </Typography>
                </Stack>
              </Box>
              <Alert severity="info">
                Every component is deterministic code: per-unit × quantity + fixed order costs. The
                AI never calculates these values.
              </Alert>
            </Stack>
          )}
        </Box>
      </Drawer>

      <Drawer anchor="right" open={drawer === "timeline"} onClose={() => setDrawer(null)}>
        <Box sx={{ width: { xs: "100vw", sm: 460 }, p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h6">Delivery timeline</Typography>
            {selected && (
              <>
                <Stack spacing={1}>
                  {[
                    { label: "Production", days: selected.leadTime.production },
                    { label: "Handling", days: selected.leadTime.handling },
                    { label: `Transport (${selected.transportMode})`, days: selected.leadTime.transit },
                    { label: "Customs", days: selected.leadTime.customs },
                  ]
                    .filter((x) => x.days > 0)
                    .map((x) => (
                      <Stack key={x.label} direction="row" alignItems="center" gap={1}>
                        <Typography variant="body2" sx={{ width: 130 }}>
                          {x.label}
                        </Typography>
                        <Bar
                          pct={(x.days / Math.max(selected.leadTime.totalDays, 1)) * 100}
                          color="#4C6FFF"
                        />
                        <Typography variant="caption" sx={{ width: 44 }}>
                          {x.days} d
                        </Typography>
                      </Stack>
                    ))}
                  <Typography variant="h6" sx={{ mt: 1 }}>
                    {selected.leadTime.totalDays} days total
                  </Typography>
                </Stack>
                <Divider />
                <Typography variant="overline">Top markets compared</Typography>
                {[...markets]
                  .sort((a, b) => a.leadTime.totalDays - b.leadTime.totalDays)
                  .slice(0, 6)
                  .map((m) => (
                    <Stack key={m.iso} direction="row" alignItems="center" gap={1}>
                      <Typography variant="body2" sx={{ width: 130 }}>
                        {m.name}
                      </Typography>
                      <Bar
                        pct={(m.leadTime.totalDays / Math.max(maxDays, 1)) * 100}
                        color={m.iso === winner?.iso ? TIER_GREEN : "#9AA7B5"}
                      />
                      <Typography variant="caption" sx={{ width: 34 }}>
                        {m.leadTime.totalDays}d
                      </Typography>
                    </Stack>
                  ))}
                <Alert severity="info">
                  Lead times are synthetic fixtures (production + handling + transit + customs). Not
                  quoted delivery promises.
                </Alert>
              </>
            )}
          </Stack>
        </Box>
      </Drawer>

      <Drawer anchor="right" open={drawer === "data"} onClose={() => setDrawer(null)}>
        <Box sx={{ width: { xs: "100vw", sm: 520 }, p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h6">Data behind this decision</Typography>
            <Typography variant="body2" color="text.secondary">
              Which values drive the recommendation, and their epistemic status.
            </Typography>
            {winner && (
              <>
                {[
                  { cat: "PURCHASE DATA", items: [
                    ["Piece price", `${eur(winner.piecePriceEUR)}/unit`, winner.priceStatus === "CHECKED_EVIDENCE" ? "✓ SOURCE-BACKED" : winner.priceStatus === "INCONSISTENT" ? "⚠ NEEDS REVIEW" : "S SYNTHETIC", winner.priceStatus === "CHECKED_EVIDENCE" ? "Median of current checked records" : "Synthetic ledger row"],
                    ["Demand", `${demand.toLocaleString("en-GB")} units`, "◆ DERIVED", "Net quantity of current checked FR records"],
                    ["Supplier", `${winner.brand} (${winner.supplierId})`, "S SYNTHETIC", "Synthetic sourcing profile"],
                  ]},
                  { cat: "LOGISTICS DATA", items: [
                    ["Transport", `${eur(winner.landed.components.find((c) => c.key === "transport")!.perUnitEUR)}/unit`, "S SYNTHETIC", `${winner.transportMode}, ${winner.distanceKm} km`],
                    ["Fuel surcharge", `${eur(winner.landed.components.find((c) => c.key === "fuel")!.perUnitEUR)}/unit`, "S SYNTHETIC", "Synthetic rate"],
                    ["Customs + duty", `${eur(winner.landed.components.filter((c) => ["customs", "duty"].includes(c.key)).reduce((s, c) => s + c.perUnitEUR, 0))}/unit`, winner.landed.components.find((c) => c.key === "customs")!.perUnitEUR === 0 ? "✓ SOURCE-BACKED" : "S SYNTHETIC", "EU origin: none"],
                    ["Warehouse", `${eur(winner.landed.components.find((c) => c.key === "warehouse")!.totalEUR)}/order`, "S SYNTHETIC", "Fixed per order"],
                  ]},
                  { cat: "TIME DATA", items: [
                    ["Total lead time", `${winner.leadTime.totalDays} days`, "◆ DERIVED", "production + handling + transit + customs"],
                    ["Transit", `${winner.leadTime.transit} days`, "S SYNTHETIC", `${winner.transportMode} mode`],
                  ]},
                  { cat: "SUPPLY DATA", items: [
                    ["Available", `${winner.availableQty.toLocaleString("en-GB")} units`, "S SYNTHETIC", `${winner.coveragePct}% of demand`],
                    ["Monthly capacity", `${winner.productionCapacityPerMonth.toLocaleString("en-GB")}`, "S SYNTHETIC", "Synthetic profile"],
                  ]},
                  { cat: "QUALITY + TRUST DATA", items: [
                    ["Reliability", `${winner.reliabilityScore}%`, "S SYNTHETIC", "0.35 on-time + 0.30 fulfillment + 0.15 defect + 0.20 cancellation"],
                    ["Rating", `${winner.supplierRating}/5`, "S SYNTHETIC", `${winner.numberOfReviews} reviews, ${winner.verifiedBuyerPercent}% verified`],
                  ]},
                  { cat: "INTERNAL COST DATA", items: [
                    ["Payroll", `${eur(ops?.monthlySalaryCostEUR ?? 0)}/month`, "S SYNTHETIC", "Separate operating-cost model — never added to landed cost"],
                    ["Order labor", `${eur(ops?.orderLabor.estimatedInternalHandlingEUR ?? 0)}`, "S SYNTHETIC", "Receiving + inspection + warehousing + admin"],
                  ]},
                  { cat: "DECISION DATA", items: [
                    ["Landed cost", `${eur(winner.landed.perUnitEUR)}/unit`, "◆ DERIVED", "sum of deterministic components ÷ quantity"],
                    ["Score", winner.scores[mode].toFixed(3), "◆ DERIVED", `weighted criteria (${mode})`],
                  ]},
                ].map((section) => (
                  <Box key={section.cat as string}>
                    <Typography variant="overline" color="text.secondary">
                      {section.cat as string}
                    </Typography>
                    {(section.items as [string, string, string, string][]).map(([label, value, status, note]) => (
                      <Stack key={label} direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
                        <Box>
                          <Typography variant="body2">{label}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {note}
                          </Typography>
                        </Box>
                        <Stack alignItems="flex-end">
                          <Typography variant="body2" fontWeight={700}>
                            {value}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {status}
                          </Typography>
                        </Stack>
                      </Stack>
                    ))}
                    <Divider sx={{ my: 1 }} />
                  </Box>
                ))}
              </>
            )}
            <Alert severity="info">
              ✓ source-backed · ◆ derived by deterministic code · S synthetic fixture · ⚠ needs
              review. No value above is a real supplier quote.
            </Alert>
          </Stack>
        </Box>
      </Drawer>

      <Drawer anchor="right" open={drawer === "weights"} onClose={() => setDrawer(null)}>
        <Box sx={{ width: { xs: "100vw", sm: 420 }, p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h6">How was this decision calculated?</Typography>
            <Typography variant="body2">
              Score = Σ weight × normalized criterion (0–1 across all {markets.length} markets),
              then rank. Weights for <strong>{MODE_LABEL[mode]}</strong>:
            </Typography>
            {payload &&
              (Object.entries(payload.weights[mode]) as [string, number][]).map(
                ([k, v]) => (
                  <Stack key={k} direction="row" alignItems="center" gap={1}>
                    <Typography variant="body2" sx={{ width: 110, textTransform: "capitalize" }}>
                      {k}
                    </Typography>
                    <Bar pct={v * 100} color="#4C6FFF" />
                    <Typography variant="caption" sx={{ width: 40 }}>
                      {(v * 100).toFixed(0)}%
                    </Typography>
                  </Stack>
                ),
              )}
            <Typography variant="caption" color="text.secondary">
              Criteria: landed €/unit (lower better), total lead days (lower better), supply coverage
              %, reliability score, supplier rating, evidence quality. The AI never changes scores,
              weights or rankings.
            </Typography>
          </Stack>
        </Box>
      </Drawer>

      <Drawer anchor="right" open={drawer === "compare"} onClose={() => setDrawer(null)}>
        <Box sx={{ width: { xs: "100vw", sm: 520 }, p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h6">Compare sources</Typography>
            <Typography variant="body2" color="text.secondary">
              Tick up to four markets, then compare visually.
            </Typography>
            {[...markets]
              .sort((a, b) => a.ranks[mode] - b.ranks[mode])
              .slice(0, 8)
              .map((m) => (
                <FormControlLabel
                  key={m.iso}
                  control={
                    <Switch
                      size="small"
                      checked={compare.includes(m.iso)}
                      onChange={(e) =>
                        setCompare((prev) =>
                          e.target.checked
                            ? prev.length < 4
                              ? [...prev, m.iso]
                              : prev
                            : prev.filter((x) => x !== m.iso),
                        )
                      }
                    />
                  }
                  label={
                    <Typography variant="body2">
                      {m.name} · {eur(m.landed.perUnitEUR)} · {m.leadTime.totalDays}d
                    </Typography>
                  }
                />
              ))}
            {compareRows.length > 0 && (
              <Box sx={{ mt: 1 }}>
                {[
                  { label: "Landed €/unit", get: (m: MarketRow) => m.landed.perUnitEUR, max: maxCost, lowerBetter: true },
                  { label: "Delivery days", get: (m: MarketRow) => m.leadTime.totalDays, max: maxDays, lowerBetter: true },
                  { label: "Supply coverage", get: (m: MarketRow) => m.coveragePct, max: 100, lowerBetter: false },
                  { label: "Reliability", get: (m: MarketRow) => m.reliabilityScore, max: 100, lowerBetter: false },
                  { label: "Trust", get: (m: MarketRow) => m.supplierRating, max: 5, lowerBetter: false },
                ].map((row) => (
                  <Box key={row.label} sx={{ mb: 1.5 }}>
                    <Typography variant="overline">{row.label}</Typography>
                    <Stack spacing={0.75}>
                      {compareRows.map((m) => {
                        const v = row.get(m);
                        return (
                          <Stack key={m.iso} direction="row" alignItems="center" gap={1}>
                            <Typography variant="body2" sx={{ width: 80 }}>
                              {m.name}
                            </Typography>
                            <Bar
                              pct={(v / row.max) * 100}
                              color={m.iso === winner?.iso ? TIER_GREEN : "#9AA7B5"}
                            />
                            <Typography variant="caption" sx={{ width: 46 }}>
                              {typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-GB") : v}
                            </Typography>
                          </Stack>
                        );
                      })}
                    </Stack>
                  </Box>
                ))}
                <Typography variant="caption" color="text.secondary">
                  Tradeoffs are visible: the cheapest piece is rarely the cheapest landed, and the
                  fastest is rarely the cheapest. No single number decides.
                </Typography>
              </Box>
            )}
          </Stack>
        </Box>
      </Drawer>
    </Card>
  );
}
