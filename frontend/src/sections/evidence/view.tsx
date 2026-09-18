"use client";

import type { State, Finding, RecordVersion } from "src/server/evidence";

import { useState, useEffect, useCallback } from "react";

import {
  Box,
  Card,
  Chip,
  Alert,
  Stack,
  Table,
  Button,
  Dialog,
  MenuItem,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  DialogTitle,
  DialogActions,
  DialogContent,
} from "@mui/material";

import { DashboardContent } from "src/layouts/dashboard";

import { SourcingCard } from "./sourcing-card";

const money = (cents: number | null) =>
  cents === null
    ? "ABSTAIN"
    : (cents / 100).toLocaleString("en-GB", {
        style: "currency",
        currency: "EUR",
      });
const comparisonWarning =
  "Cannot safely compare suppliers — product IDs describe families with multiple sizes/specifications. PC/piece is a fixture convention, not proof of physical pack equivalence.";

type AgentProposal = {
  summary: string;
  risks: string[];
  suggestion: { action: string; note: string };
  confidence: string;
};

export function EvidenceView() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [record, setRecord] = useState<RecordVersion | null>(null);
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("piece");
  const [pack, setPack] = useState("1");
  const [reason, setReason] = useState("");
  const [showTech, setShowTech] = useState(false);
  const [aiResult, setAiResult] = useState<Record<string, AgentProposal>>({});
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiError, setAiError] = useState("");
  const [recordLevel, setRecordLevel] = useState<Record<string, "calc" | "source" | "raw" | null>>({});
  const refresh = useCallback(async () => {
    const response = await fetch("/api/evidence/");
    if (!response.ok) throw new Error("Evidence store unavailable");
    setState(await response.json());
  }, []);
  const send = useCallback(async (body: unknown) => {
    const response = await fetch("/api/evidence/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Action failed");
    return result;
  }, []);
  useEffect(() => {
    let stopped = false;
    let running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        await send({ action: "tick" });
        if (!stopped) await refresh();
      } catch (e) {
        if (!stopped) setError(String(e));
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [refresh, send]);
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/auth/me/");
        const data = await response.json();
        if (response.ok && data.user) setUser(data.user);
      } catch {
        /* unauthenticated */
      } finally {
        setAuthChecked(true);
      }
    })();
  }, []);
  async function act(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await send(body);
      await refresh();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function askAgent(f: Finding) {
    setAiLoading(f.id);
    setAiError("");
    try {
      const response = await fetch("/api/evidence/agent/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId: f.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "AI review failed");
      setAiResult((prev) => ({ ...prev, [f.id]: data.proposal }));
    } catch (e) {
      setAiError(String(e instanceof Error ? e.message : e));
    } finally {
      setAiLoading(null);
    }
  }
  const finding = state?.findings.find((f) => f.id === selected);
  function inspect(f: Finding) {
    setSelected(f.id);
  }
  function edit(r: RecordVersion) {
    setRecord(r);
    setQty(String(r.qty));
    setUnit(r.unit === "PC" ? "piece" : r.unit);
    setPack(String(r.pack ?? ""));
    setReason("");
  }
  const current = state?.findings.filter((f) => f.current) ?? [];
  const active = state?.records.filter((r) => r.status === "CURRENT") ?? [];
  const frBaselineDone = !!state?.events.some(
    (e) => e.version === "FR-v1" && e.status === "PROCESSED",
  );
  const frLateSeen = !!state?.events.some((e) => e.version === "FR-v2");
  const frLateDone = !!state?.events.some(
    (e) => e.version === "FR-v2" && e.status === "PROCESSED",
  );
  const frFindings =
    state?.findings.filter((f) => f.current && f.market === "FR") ?? [];
  const target =
    frFindings.find((f) => f.product === "WLF-1008") ?? frFindings[0];
  const targetApproved = !!(
    target &&
    state?.approvals.some(
      (a) => a.findingId === target.id && a.status === "APPROVED",
    )
  );
  const queued = !!state?.events.some((e) => e.status === "QUEUED");
  const reviewerReady = !!user;
  let next: {
    button: string;
    hint: string;
    body?: unknown;
    disabled?: boolean;
  } | null = null;
  if (!frBaselineDone) {
    next = {
      button: "Load the France baseline",
      hint: "Imports 24 records and creates the first recommendation.",
      body: { action: "deliver", market: "FR", version: "v1" },
    };
  } else if (!frLateSeen && !targetApproved) {
    next = {
      button: "Approve the recommendation",
      hint: reviewerReady
        ? "This is the baseline you accept today."
        : "Sign in first.",
      body: { action: "approve", findingId: target?.id },
      disabled: !reviewerReady || !target,
    };
  } else if (!frLateSeen && targetApproved) {
    next = {
      button: "Send the corrected late file",
      hint: "A supplier file arrives late and replaces 16 rows. Watch the decision change.",
      body: { action: "deliver", market: "FR", version: "v2" },
    };
  } else if (frLateSeen && !frLateDone && queued) {
    next = {
      button: "Process the late file",
      hint: "The poller usually does this automatically.",
      body: { action: "tick" },
    };
  } else if (frLateDone && !targetApproved) {
    next = {
      button: "Approve the revised decision",
      hint: reviewerReady
        ? "The old approval is now STALE. Accept the new version."
        : "Sign in first.",
      body: { action: "approve", findingId: target?.id },
      disabled: !reviewerReady || !target,
    };
  } else if (frLateDone && targetApproved) {
    next = {
      button: "Replay the late file",
      hint: "Prove nothing double-counts. You can click this again and again.",
      body: { action: "deliver", market: "FR", version: "v2" },
    };
  } else {
    next = {
      button: "Continue",
      hint: "Use the sections below to inspect evidence or correct a record.",
      body: { action: "tick" },
    };
  }
  const milestones = [
    { label: "Load the France baseline", done: frBaselineDone },
    { label: "Send the corrected late file", done: frLateDone },
    { label: "Approve the revised decision", done: frLateDone && targetApproved },
  ];
  return (
    <DashboardContent maxWidth="xl">
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline">
            Wolf · Track 1 · Synthetic organizer data
          </Typography>
          <Typography variant="h3" color="primary.main">
            Procurement evidence
          </Typography>
          <Typography color="text.secondary">
            A source changes. The affected decision changes. Yesterday’s
            approval stays in history.
          </Typography>
        </Box>
        <Card sx={{ p: 3, border: 2, borderColor: "primary.main" }}>
          <Stack spacing={2}>
            <Typography variant="h6">How to use this (2-minute demo)</Typography>
            <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
              {milestones.map((m, i) => (
                <Chip
                  key={m.label}
                  label={`${i + 1}. ${m.label}`}
                  color={m.done ? "success" : "default"}
                  variant={m.done ? "filled" : "outlined"}
                />
              ))}
            </Stack>
            {authChecked ? (
              user ? (
                <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
                  <Chip color="success" label={`Signed in as ${user.name}`} />
                  <Typography variant="body2" color="text.secondary">
                    {user.email}
                  </Typography>
                  <Button
                    size="small"
                    onClick={async () => {
                      await fetch("/api/auth/sign-out/", { method: "POST" });
                      window.location.href =
                        "/auth/sign-in?returnTo=/dashboard/evidence";
                    }}
                  >
                    Sign out
                  </Button>
                </Stack>
              ) : (
                <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
                  <Alert severity="warning" sx={{ py: 0 }}>
                    Sign in to approve decisions under your own name.
                  </Alert>
                  <Button
                    variant="contained"
                    onClick={() =>
                      (window.location.href =
                        "/auth/sign-in?returnTo=/dashboard/evidence")
                    }
                  >
                    Sign in
                  </Button>
                </Stack>
              )
            ) : (
              <Typography variant="body2" color="text.secondary">
                Checking sign-in…
              </Typography>
            )}
            {next && (
              <Stack spacing={1}>
                <Box>
                  <Button
                    variant="contained"
                    color="primary"
                    disabled={busy || next.disabled}
                    onClick={() => void act(next.body)}
                  >
                    {next.button}
                  </Button>
                </Box>
                {next.hint && (
                  <Typography variant="body2" color="text.secondary">
                    {next.hint}
                  </Typography>
                )}
              </Stack>
            )}
            <Typography variant="body2" color="text.secondary">
              Extra: open “Inspect evidence &amp; history” on a recommendation to
              see the exact source row behind a number, or “Correct quantity /
              unit” to fix a record and re-approve. Replay the late file as many
              times as you like — totals never change.
            </Typography>
          </Stack>
        </Card>
        <SourcingCard
          state={state}
          onInspect={inspect}
          onApprove={async (findingId) =>
            act({ action: "approve", findingId })
          }
        />
        <Alert severity="info">
          Persistent local SQLite · Simulated source delivery and polling every
          2.5 seconds while this page is open. The AI review assistant only
          proposes; arithmetic and approvals stay in deterministic code. No
          purchase or external message is involved.
        </Alert>
        {error && (
          <Alert severity="error" onClose={() => setError("")}>
            {error}
          </Alert>
        )}
        {aiError && (
          <Alert severity="warning" onClose={() => setAiError("")}>
            {aiError}
          </Alert>
        )}
        <Card sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h6">1. Deliver a source</Typography>
            <Stack direction="row" gap={1} flexWrap="wrap">
              {(["FR", "HU"] as const).map((m) => (
                <Box key={m}>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void act({ action: "deliver", market: m, version: "v1" })
                    }
                  >
                    Load baseline ({m})
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={busy}
                    onClick={() =>
                      void act({ action: "deliver", market: m, version: "v2" })
                    }
                  >
                    Deliver late file ({m})
                  </Button>
                </Box>
              ))}
            </Stack>
            <Typography variant="body2">
              France replaces only sup-aster; Hungary adds sup-orbit. Delivery
              queues immutable bytes. The poller processes one event at a time
              and asks for a specific review.
            </Typography>
            <Typography>
              {active.length} current records ·{" "}
              {state?.records.filter((r) => r.status === "SUPERSEDED").length ??
                0}{" "}
              historical records ·{" "}
              {state?.approvals.filter((a) => a.status === "STALE").length ?? 0}{" "}
              stale approvals
            </Typography>
          </Stack>
        </Card>
        <Alert severity="warning">
          {comparisonWarning} Approval below accepts a historical spend baseline
          only.
        </Alert>
        <Card sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            2. Review the affected decision
          </Typography>
          {!current.length && (
            <Typography>Load the France baseline to begin.</Typography>
          )}
          <Stack spacing={2}>
            {current.map((f) => {
              const prev = state?.findings.find((x) => x.id === f.previous);
              const approval = state?.approvals.find(
                (a) => a.findingId === f.id && a.status === "APPROVED",
              );
              return (
                <Box
                  key={f.id}
                  sx={{
                    p: 2,
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    flexWrap="wrap"
                  >
                    <Typography variant="h6">
                      {f.market} / {f.product}
                    </Typography>
                    <Chip size="small" label={`v${f.version}`} />
                    <Chip
                      size="small"
                      color={
                        approval
                          ? "success"
                          : f.status === "READY"
                            ? "info"
                            : "warning"
                      }
                      label={approval ? "APPROVED" : f.status}
                    />
                  </Stack>
                  <Typography variant="h4" sx={{ my: 1 }}>
                    {money(f.totalCents)}
                  </Typography>
                  {prev && (
                    <Typography>
                      Previously {money(prev.totalCents)} → now{" "}
                      {money(f.totalCents)} · change {money(f.deltaCents)}
                    </Typography>
                  )}
                  <Typography variant="body2">{f.recommendation}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Why: {f.reason}
                  </Typography>
                  {state?.approvals
                    .filter(
                      (a) =>
                        a.status === "STALE" &&
                        state.findings.find((x) => x.id === a.findingId)
                          ?.key === f.key,
                    )
                    .map((a) => (
                      <Alert key={a.id} severity="warning" sx={{ mt: 1 }}>
                        STALE approval by {a.reviewer}: {a.staleReason}
                      </Alert>
                    ))}
                  {aiResult[f.id] && (
                    <Alert severity="info" icon={false} sx={{ mt: 1 }}>
                      <Typography variant="subtitle2">
                        AI proposal · {aiResult[f.id].suggestion.action} ·{" "}
                        confidence {aiResult[f.id].confidence}
                      </Typography>
                      <Typography variant="body2">
                        {aiResult[f.id].summary}
                      </Typography>
                      {aiResult[f.id].risks.length > 0 && (
                        <Box component="ul" sx={{ mt: 0.5, mb: 0.5, pl: 2 }}>
                          {aiResult[f.id].risks.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </Box>
                      )}
                      <Typography variant="body2">
                        {aiResult[f.id].suggestion.note}
                      </Typography>
                      <Typography variant="caption">
                        Proposal only — arithmetic and totals are verified by
                        code, not the model.
                      </Typography>
                    </Alert>
                  )}
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    <Button onClick={() => inspect(f)}>
                      Inspect evidence & history
                    </Button>
                    <Button
                      variant="outlined"
                      disabled={aiLoading === f.id}
                      onClick={() => void askAgent(f)}
                    >
                      {aiLoading === f.id ? "Asking AI…" : "AI review"}
                    </Button>
                    <Button
                      variant="contained"
                      disabled={
                        busy ||
                        !!approval ||
                        f.status !== "READY" ||
                        !user
                      }
                      onClick={() =>
                        void act({
                          action: "approve",
                          findingId: f.id,
                        })
                      }
                    >
                      Approve this recommendation (v{f.version})
                    </Button>
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        </Card>
        <Card sx={{ p: 3 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography variant="h6">
              3. Source events and replay proof
            </Typography>
            <Button size="small" onClick={() => setShowTech((v) => !v)}>
              {showTech ? "Hide technical details" : "Show technical details"}
            </Button>
          </Stack>
          {showTech && (
            <>
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      {[
                        "Event / scope",
                        "Status",
                        "Added / superseded / unchanged",
                        "Affected findings",
                        "Source hash",
                      ].map((x) => (
                        <TableCell key={x}>{x}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {state?.events.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>
                          {e.id}
                          <br />
                          {e.mode} / {e.supplier ?? e.market}
                        </TableCell>
                        <TableCell>
                          {e.status}
                          {e.error && (
                            <Typography color="error">{e.error}</Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          {e.changes
                            ? `${e.changes.added} / ${e.changes.superseded} / ${e.changes.unchanged}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {e.changes?.findings ?? "—"} ({e.changes?.review ?? 0}{" "}
                          review rows)
                        </TableCell>
                        <TableCell
                          sx={{ maxWidth: 260, overflowWrap: "anywhere" }}
                        >
                          {e.sources[0]?.name}
                          <br />
                          {e.sources[0]?.hash}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
              <Typography variant="caption">
                Unchanged counts include all currently loaded markets. A
                modified source line is a new canonical version; the prior
                scoped rows remain superseded. No row identity across deliveries
                is invented.
              </Typography>
              <Stack spacing={1} sx={{ mt: 2 }}>
                {state?.history
                  .slice(-12)
                  .reverse()
                  .map((h, i) => (
                    <Typography variant="body2" key={`${h.at}-${i}`}>
                      <strong>{h.kind}</strong> · {h.message}
                    </Typography>
                  ))}
              </Stack>
            </>
          )}
        </Card>
        <Dialog
          open={!!finding}
          onClose={() => setSelected(null)}
          fullWidth
          maxWidth="lg"
        >
          <DialogTitle>
            Evidence: {finding?.key} · v{finding?.version}{" "}
            {!finding?.current && "(historical)"}
          </DialogTitle>
          <DialogContent dividers>
            {finding && (
              <Stack spacing={2}>
                <Typography>{finding.recommendation}</Typography>
                <Typography>
                  {money(finding.totalCents)} · signed quantity{" "}
                  {finding.quantity ?? "unknown"} {finding.unit} ·{" "}
                  {finding.dependencies.length} exact record dependencies
                </Typography>
                <Alert severity="info">
                  Calculation: sum signed line net amounts in integer EUR cents.
                  Quantity and unit price are descriptive; credits are not
                  supplier quotes. Raw evidence is untrusted data.
                </Alert>
                <Stack direction="row" gap={1} flexWrap="wrap">
                  {state?.findings
                    .filter((f) => f.key === finding.key)
                    .map((f) => (
                      <Button
                        key={f.id}
                        variant={f.id === finding.id ? "contained" : "outlined"}
                        onClick={() => inspect(f)}
                      >
                        v{f.version} · {money(f.totalCents)}
                      </Button>
                    ))}
                </Stack>
                {state?.approvals
                  .filter((a) => a.findingId === finding.id)
                  .map((a) => (
                    <Alert
                      severity={a.status === "STALE" ? "warning" : "success"}
                      key={a.id}
                    >
                      {a.status} · {a.reviewer} · {a.at} {a.staleReason}
                    </Alert>
                  ))}
                {state?.records
                  .filter((r) => finding.dependencies.includes(r.id))
                  .map((r) => {
                    const level = recordLevel[r.id] ?? null;
                    const levelBtn = (kind: "calc" | "source" | "raw", label: string) => (
                      <Button
                        size="small"
                        variant={level === kind ? "contained" : "text"}
                        onClick={() =>
                          setRecordLevel((prev) => ({
                            ...prev,
                            [r.id]: prev[r.id] === kind ? null : kind,
                          }))
                        }
                      >
                        {label}
                      </Button>
                    );
                    return (
                      <Card variant="outlined" key={r.id} sx={{ p: 2 }}>
                        <Stack
                          direction="row"
                          justifyContent="space-between"
                          alignItems="center"
                          flexWrap="wrap"
                        >
                          <Typography variant="subtitle1">
                            {r.credit ? "Credit note (signed)" : "Supplier invoice"} ·{" "}
                            {r.description}
                          </Typography>
                          {r.status === "CURRENT" && (
                            <Button size="small" onClick={() => edit(r)}>
                              Correct quantity / unit
                            </Button>
                          )}
                        </Stack>
                        <Stack direction="row" gap={1} flexWrap="wrap" sx={{ my: 1 }}>
                          <Chip
                            size="small"
                            color={r.issues.length ? "warning" : "success"}
                            label={r.issues.length ? "⚠ Needs review" : "✓ Verified"}
                          />
                          <Chip size="small" variant="outlined" label={`canonical v${r.version}`} />
                          <Chip size="small" variant="outlined" label={`${r.status}`} />
                          {r.issues.map((x) => (
                            <Chip size="small" color="warning" key={x} label={x} />
                          ))}
                        </Stack>
                        <Stack direction="row" gap={3} flexWrap="wrap">
                          <Box>
                            <Typography variant="caption" color="text.secondary" display="block">
                              QUANTITY
                            </Typography>
                            <Typography variant="body1">
                              {r.qty} {r.unit}
                              {r.pack ? ` (pack ${r.pack})` : ""}
                            </Typography>
                          </Box>
                          <Box>
                            <Typography variant="caption" color="text.secondary" display="block">
                              UNIT PRICE
                            </Typography>
                            <Typography variant="body1">
                              €{r.unitPriceEUR ?? "ABSTAIN"}
                            </Typography>
                          </Box>
                          <Box>
                            <Typography variant="caption" color="text.secondary" display="block">
                              TOTAL
                            </Typography>
                            <Typography variant="body1" fontWeight={700}>
                              {money(r.amountCents)}
                            </Typography>
                          </Box>
                          <Box>
                            <Typography variant="caption" color="text.secondary" display="block">
                              USED BY
                            </Typography>
                            <Typography variant="body1">
                              {state.findings
                                .filter((f) => f.dependencies.includes(r.id))
                                .map((f) => f.key)
                                .join(", ")}
                            </Typography>
                          </Box>
                        </Stack>
                        <Stack direction="row" gap={0.5} sx={{ mt: 1 }} flexWrap="wrap">
                          {levelBtn("calc", "View calculation")}
                          {levelBtn("source", "View source")}
                          {levelBtn("raw", "Technical details")}
                        </Stack>
                        {level === "calc" && (
                          <Alert severity="info" icon={false} sx={{ mt: 1 }}>
                            <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                              {r.qty} {r.unit}
                              {r.pack ? ` × ${r.pack} (pack)` : ""} ×{" "}
                              {r.originalAmount} {r.currency} ={" "}
                              <strong>{money(r.amountCents)}</strong>
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              Normalized: {r.qty} {r.unit} → {r.normalizedQty ?? "?"}{" "}
                              {r.normalizedUnit ?? ""} · €{r.unitPriceEUR ?? "?"} per normalized
                              unit · FX snapshotted at ingestion
                            </Typography>
                            {r.correction && (
                              <Typography variant="body2" color="text.secondary">
                                Human correction by {r.correction.reviewer}: {r.correction.reason}
                              </Typography>
                            )}
                          </Alert>
                        )}
                        {level === "source" && (
                          <Alert severity="info" icon={false} sx={{ mt: 1 }}>
                            <Typography variant="body2">
                              <strong>Source file</strong> {r.source}
                              <br />
                              <strong>Sheet / location</strong> {r.sheet} · row/item {r.row}
                              <br />
                              <strong>Source event</strong> {r.eventId}
                              <br />
                              <strong>Snapshot hash</strong>{" "}
                              <Box
                                component="span"
                                sx={{ fontSize: 12, overflowWrap: "anywhere" }}
                              >
                                {state.events
                                  .find((e) => e.id === r.eventId)
                                  ?.sources.find((x) => x.name === r.source)?.hash}
                              </Box>
                            </Typography>
                          </Alert>
                        )}
                        {level === "raw" && (
                          <Box sx={{ mt: 1 }}>
                            <Typography variant="caption" color="text.secondary">
                              {r.transform}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" display="block">
                              Dependent decisions:{" "}
                              {state.findings
                                .filter((f) => f.dependencies.includes(r.id))
                                .map(
                                  (f) =>
                                    `${f.key} v${f.version}${f.current ? " (current)" : " (historical)"}`,
                                )
                                .join(", ")}
                            </Typography>
                            <Box
                              component="pre"
                              sx={{
                                whiteSpace: "pre-wrap",
                                overflowWrap: "anywhere",
                                fontSize: 12,
                                mt: 1,
                              }}
                            >
                              {JSON.stringify(
                                {
                                  logicalId: r.logicalId,
                                  hash: state.events
                                    .find((e) => e.id === r.eventId)
                                    ?.sources.find((x) => x.name === r.source)?.hash,
                                  raw: r.raw,
                                },
                                null,
                                2,
                              )}
                            </Box>
                          </Box>
                        )}
                      </Card>
                    );
                  })}
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSelected(null)}>Close</Button>
          </DialogActions>
        </Dialog>
        <Dialog open={!!record} onClose={() => setRecord(null)} fullWidth>
          <DialogTitle>Human correction · {record?.logicalId}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Alert severity="warning">
                Enter only a correction you can attest to, with its evidence
                reference. The original line amount stays fixed. This changes
                normalized quantity/price and creates a new decision version. It
                does not assert product equivalence.
              </Alert>
              <TextField
                label="Signed source quantity"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                type="number"
              />
              <TextField
                select
                label="Unit"
                value={unit}
                onChange={(e) => {
                  setUnit(e.target.value);
                  setPack(e.target.value === "box" ? "" : "1");
                }}
              >
                {["piece", "box", "kg", "g", "l", "ml"].map((u) => (
                  <MenuItem key={u} value={u}>
                    {u}
                  </MenuItem>
                ))}
              </TextField>
              {unit === "box" && (
                <TextField
                  label="Proven pieces per box"
                  value={pack}
                  onChange={(e) => setPack(e.target.value)}
                  type="number"
                />
              )}
              <TextField
                disabled
                label="Reviewer (from your sign-in)"
                value={user?.name ?? ""}
              />
              <TextField
                multiline
                label="Reason and supporting evidence reference"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRecord(null)}>Cancel</Button>
            <Button
              disabled={
                busy ||
                !qty ||
                !user ||
                reason.trim().length < 8
              }
              onClick={async () => {
                if (
                  record &&
                  (await act({
                    action: "correct",
                    recordId: record.id,
                    qty: Number(qty),
                    unit,
                    pack: pack ? Number(pack) : null,
                    reason,
                  }))
                ) {
                  setRecord(null);
                  setSelected(null);
                }
              }}
            >
              Save correction & recompute
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </DashboardContent>
  );
}
