"use client";

import type { FeatureCollection } from "geojson";
import type { MarketRow } from "./sourcing-types";

import { feature } from "topojson-client";
import { geoPath, geoNaturalEarth1 } from "d3-geo";
import { useRef, useMemo, useState, useEffect, useCallback } from "react";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";

import { countries } from "src/data/platform";

import { eur } from "./sourcing-types";

// ViewBox coordinate space (geography). k transforms this into screen space.
const W = 960;
const H = 500;
const MIN_K = 1;
const MAX_K = 8;
// Constant on-screen (css px) sizes — marker visuals must NOT scale with k.
const MARKER_R = 13;
const SELECTED_R = 15;
const CLUSTER_BASE_R = 16;
const CLUSTER_R_STEP = 2.5;
const WHEEL_STEP = 1.12;

const TIER_GREEN = "#2E9E5B";
const TIER_YELLOW = "#E8A13A";
const TIER_RED = "#D9483B";
const LAND = "#EDF1F5";
const LAND_MARKET = "#D9E3EA";
const LAND_STROKE = "#B9C7D1";

const NUM_TO_ISO: Record<string, string> = {
  "040": "AT", "276": "DE", "752": "SE", "250": "FR", "380": "IT", "724": "ES",
  "620": "PT", "756": "CH", "616": "PL", "203": "CZ", "703": "SK", "348": "HU",
  "705": "SI", "191": "HR", "642": "RO", "100": "BG", "688": "RS", "070": "BA",
  "008": "AL", "807": "MK", "499": "ME", "804": "UA", "156": "CN", "392": "JP",
  "458": "MY", "702": "SG", "152": "CL", "170": "CO",
};

const euroPaths = [
  "M4 10h12",
  "M4 14h9",
  "M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2",
];

const tier = (rank: number, total: number) => {
  if (total <= 1) return TIER_GREEN;
  if (rank <= Math.ceil(total / 3)) return TIER_GREEN;
  if (rank <= Math.ceil((2 * total) / 3)) return TIER_YELLOW;
  return TIER_RED;
};

type Props = {
  markets: MarketRow[];
  selectedIso: string | null;
  winnerIso: string | null;
  onSelect: (iso: string) => void;
};

type BasePos = { row: MarketRow; x: number; y: number };
type Cluster = {
  id: string;
  members: BasePos[];
  x: number; // viewBox (screen) position, marker layer space
  y: number;
  best: MarketRow;
  label: string;
};

type Hover =
  | { kind: "marker"; iso: string; x: number; y: number }
  | { kind: "cluster"; cluster: Cluster; x: number; y: number };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function SourcingMap({ markets, selectedIso, winnerIso, onSelect }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef<number | null>(null);
  const [world, setWorld] = useState<FeatureCollection | null>(null);
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [boxW, setBoxW] = useState(0);

  useEffect(() => {
    let active = true;
    fetch("/countries-110m.json")
      .then((res) => res.json())
      .then((topo) => {
        if (active)
          setWorld(feature(topo, topo.objects.countries) as unknown as FeatureCollection);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Track the real container width so marker sizes stay constant in css px
  // regardless of panel width (viewBox units → css px conversion).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w) setBoxW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Native non-passive wheel listener: Ctrl/Cmd+wheel zooms around the cursor;
  // plain wheel falls through to normal page scrolling.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (!rect.width) return;
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      const sx = ((e.clientX - rect.left) * W) / rect.width;
      const sy = ((e.clientY - rect.top) * H) / rect.height;
      setView((v) => {
        const k = clamp(v.k * factor, MIN_K, MAX_K);
        const wx = (sx - v.tx) / v.k;
        const wy = (sy - v.ty) / v.k;
        return { k, tx: sx - wx * k, ty: sy - wy * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const geo = useMemo(() => {
    if (!world) return null;
    const projection = geoNaturalEarth1().fitSize([W, H], world as never);
    const path = geoPath(projection);
    const paths = world.features.map((f) => ({
      d: path(f) ?? "",
      iso: NUM_TO_ISO[String(f.id)],
    }));
    const pos = new Map<string, { lon: number; lat: number }>();
    for (const c of countries) pos.set(c.iso, { lon: c.lon, lat: c.lat });
    const project = (iso: string): { x: number; y: number } | null => {
      const p = pos.get(iso);
      if (!p) return null;
      const out = projection([p.lon, p.lat]);
      return out && Number.isFinite(out[0]) ? { x: out[0], y: out[1] } : null;
    };
    return { paths, project };
  }, [world]);

  const base = useMemo(() => {
    if (!geo) return [];
    return markets
      .map((r) => {
        const p = geo.project(r.iso);
        return p ? { row: r, x: p.x, y: p.y } : null;
      })
      .filter(Boolean) as BasePos[];
  }, [geo, markets]);

  // css px → viewBox units
  const scale = boxW ? boxW / W : 1;
  const s = useCallback((n: number) => n / scale, [scale]);

  // Screen-space clustering, seed-fixed (no centroid chaining). The merge
  // radius shrinks with zoom: wide at world view (Europe = one cluster),
  // tight at detail zoom (neighbors only). Clusters split as k grows.
  const clusters = useMemo(() => {
    const th = Math.max(20, 90 - (view.k - 1) * 110);
    const screen = base
      .map((b) => ({
        b,
        sx: b.x * view.k + view.tx,
        sy: b.y * view.k + view.ty,
      }))
      .sort((a, b2) => a.b.row.ranks.BALANCED - b2.b.row.ranks.BALANCED);
    const out: { seedX: number; seedY: number; members: BasePos[]; best: MarketRow }[] = [];
    for (const p of screen) {
      let found: (typeof out)[number] | null = null;
      for (const c of out) {
        if (Math.hypot((c.seedX - p.sx) * scale, (c.seedY - p.sy) * scale) <= th) {
          found = c;
          break;
        }
      }
      if (found) {
        found.members.push(p.b);
        if (p.b.row.ranks.BALANCED < found.best.ranks.BALANCED) found.best = p.b.row;
      } else {
        out.push({ seedX: p.sx, seedY: p.sy, members: [p.b], best: p.b.row });
      }
    }
    return out.map((c, i) => {
      const regionCounts = new Map<string, number>();
      for (const m of c.members) {
        const region = countries.find((x) => x.iso === m.row.iso)?.region ?? "Other";
        regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
      }
      const regionGroups: Record<string, string[]> = {
        Europe: ["Austria", "Northern Europe", "Central and Eastern Europe", "Southwestern Europe"],
        Asia: ["Asia"],
        "South America": ["South America"],
      };
      const covered = (g: string[]) => c.members.every((m) => {
        const r = countries.find((x) => x.iso === m.row.iso)?.region;
        return r ? g.includes(r) : false;
      });
      const group = Object.entries(regionGroups).find(([, g]) => covered(g))?.[0];
      const label = group ?? [...regionCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const x = c.members.reduce((s2, m) => s2 + m.x * view.k + view.tx, 0) / c.members.length;
      const y = c.members.reduce((s2, m) => s2 + m.y * view.k + view.ty, 0) / c.members.length;
      return { id: `c${i}`, members: c.members, best: c.best, label, x, y };
    });
  }, [base, view, scale]);

  const zoomTo = useCallback(
    (pts: { x: number; y: number }[], pad = 70) => {
      if (!pts.length) return;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const bw = Math.max(maxX - minX, 1);
      const bh = Math.max(maxY - minY, 1);
      const k = clamp(Math.min((W - pad * 2) / bw, (H - pad * 2) / bh), MIN_K, MAX_K);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      setView({ k, tx: W / 2 - cx * k, ty: H / 2 - cy * k });
    },
    [],
  );

  const panBounds = useCallback(
    (k: number, v: { tx: number; ty: number }) => ({
      tx: k > MIN_K ? clamp(v.tx, W - W * k + 60, -60) : 0,
      ty: k > MIN_K ? clamp(v.ty, H - H * k + 60, -60) : 0,
    }),
    [],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    const el = boxRef.current;
    if (!el) return;
    const markerTarget = (e.target as Element).closest?.("[data-marker]");
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1 && !markerTarget) {
      el.setPointerCapture?.(e.pointerId);
      setDrag({ x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty });
    }
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      pinchDist.current = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      setDrag(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const el = boxRef.current;
    if (!el || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = el.getBoundingClientRect();
    if (!rect.width) return;
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const prev = pinchDist.current;
      pinchDist.current = dist;
      if (!prev) return;
      const midX = ((p1.x + p2.x) / 2 - rect.left) * (W / rect.width);
      const midY = ((p1.y + p2.y) / 2 - rect.top) * (H / rect.height);
      const factor = dist / prev;
      setView((v) => {
        const k = clamp(v.k * factor, MIN_K, MAX_K);
        const wx = (midX - v.tx) / v.k;
        const wy = (midY - v.ty) / v.k;
        const next = panBounds(k, { tx: midX - wx * k, ty: midY - wy * k });
        return { k, ...next };
      });
      return;
    }
    if (!drag) return;
    const dx = ((e.clientX - drag.x) * W) / rect.width;
    const dy = ((e.clientY - drag.y) * H) / rect.height;
    const bounds = panBounds(view.k, { tx: drag.tx + dx, ty: drag.ty + dy });
    setView((v) => ({ ...v, ...bounds }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchDist.current = null;
    if (pointers.current.size === 0) setDrag(null);
  };

  const reset = () => setView({ k: 1, tx: 0, ty: 0 });
  const total = markets.length;

  const moveHover = (h: Hover) => (e: React.MouseEvent) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ ...h, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const hoveredMarket = hover?.kind === "marker" ? markets.find((m) => m.iso === hover.iso) : undefined;
  const hoveredCluster = hover?.kind === "cluster" ? hover.cluster : undefined;

  return (
    <Box>
      <Box
        ref={boxRef}
        onMouseLeave={() => setHover(null)}
        sx={{
          position: "relative",
          borderRadius: 1.5,
          overflow: "hidden",
          bgcolor: "background.default",
          border: (theme) => `solid 1px ${theme.vars.palette.divider}`,
          cursor: drag ? "grabbing" : "grab",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        {!geo ? (
          <Skeleton variant="rectangular" height={360} />
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ width: "100%", height: "auto", display: "block" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/* GEOGRAPHY LAYER — transformed by pan/zoom */}
            <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
              {geo.paths.map((p, i) => (
                <path
                  key={i}
                  d={p.d}
                  fill={p.iso && markets.some((m) => m.iso === p.iso) ? LAND_MARKET : LAND}
                  stroke={LAND_STROKE}
                  strokeWidth={0.5}
                />
              ))}
            </g>
            {/* MARKER LAYER — positions follow pan/zoom, visual size is constant */}
            {clusters.map((c) => {
              const single = c.members.length === 1;
              const b = c.members[0];
              const isSelected = single && selectedIso === b.row.iso;
              const isWinner = single && winnerIso === b.row.iso;
              const containsWinner = c.members.some((m) => m.row.iso === winnerIso);
              const containsSelected = c.members.some((m) => m.row.iso === selectedIso);
              const r = single ? s(isSelected ? SELECTED_R : MARKER_R) : s(CLUSTER_BASE_R + CLUSTER_R_STEP * Math.min(5, c.members.length));
              return (
                <g
                  key={c.id}
                  data-marker="true"
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    if (single) onSelect(b.row.iso);
                    else zoomTo(c.members.map((m) => ({ x: m.x, y: m.y })));
                  }}
                  onMouseEnter={moveHover(single ? { kind: "marker", iso: b.row.iso, x: 0, y: 0 } : { kind: "cluster", cluster: c, x: 0, y: 0 })}
                  onMouseMove={moveHover(single ? { kind: "marker", iso: b.row.iso, x: 0, y: 0 } : { kind: "cluster", cluster: c, x: 0, y: 0 })}
                >
                  {!single && (containsWinner || containsSelected) && (
                    <circle
                      cx={c.x}
                      cy={c.y}
                      r={r + s(4)}
                      fill="none"
                      stroke="#101820"
                      strokeWidth={s(2)}
                    />
                  )}
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={r}
                    fill={tier(c.best.ranks.BALANCED, total)}
                    stroke={isSelected || (single && isWinner) ? "#101820" : "#FFFFFF"}
                    strokeWidth={s(isSelected ? 2 : isWinner ? 2 : 1.4)}
                  />
                  {single ? (
                    <>
                      <g
                        transform={`translate(${c.x - r * 0.52}, ${c.y - r * 0.52}) scale(${r / 24})`}
                        fill="none"
                        stroke="#FFFFFF"
                        strokeWidth={2.2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ pointerEvents: "none" }}
                      >
                        {euroPaths.map((d, i) => (
                          <path key={i} d={d} />
                        ))}
                      </g>
                      {isWinner && (
                        <g transform={`translate(${c.x + r * 0.62}, ${c.y - r * 0.62})`} style={{ pointerEvents: "none" }}>
                          <circle r={s(7)} fill="#101820" stroke="#FFFFFF" strokeWidth={s(1)} />
                          <text
                            textAnchor="middle"
                            dominantBaseline="central"
                            fontSize={s(8)}
                            fill="#FFC93C"
                          >
                            ★
                          </text>
                        </g>
                      )}
                      {isSelected && (
                        <g style={{ pointerEvents: "none" }}>
                          <rect
                            x={c.x - s(34)}
                            y={c.y + r + s(4)}
                            width={s(68)}
                            height={s(17)}
                            rx={s(3)}
                            fill="#FFFFFF"
                            stroke="#C7D2DB"
                          />
                          <text
                            x={c.x}
                            y={c.y + r + s(15.5)}
                            textAnchor="middle"
                            fontSize={s(10)}
                            fontWeight={700}
                            fill="#1C2B33"
                          >
                            {b.row.iso} {b.row.landed.perUnitEUR.toFixed(1)}
                          </text>
                        </g>
                      )}
                    </>
                  ) : (
                    <>
                      <text
                        x={c.x}
                        y={c.y + s(0.5)}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={s(9.5)}
                        fontWeight={700}
                        fill="#FFFFFF"
                        style={{ pointerEvents: "none" }}
                      >
                        €×{c.members.length}
                      </text>
                      <text
                        x={c.x}
                        y={c.y + r + s(11)}
                        textAnchor="middle"
                        fontSize={s(8.5)}
                        fontWeight={600}
                        fill="#3B4A55"
                        style={{ pointerEvents: "none" }}
                      >
                        {c.label}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {hoveredMarket && (
          <Box
            sx={{
              position: "absolute",
              left: Math.min(hover!.x + 14, (boxRef.current?.clientWidth ?? 600) - 230),
              top: Math.min(hover!.y + 10, (boxRef.current?.clientHeight ?? 300) - 130),
              px: 1.5,
              py: 1,
              borderRadius: 1,
              bgcolor: "background.paper",
              border: (theme) => `solid 1px ${theme.vars.palette.divider}`,
              boxShadow: (theme) => theme.shadows[8],
              pointerEvents: "none",
              zIndex: 9,
              minWidth: 200,
            }}
          >
            <Stack spacing={0.25}>
              <Typography variant="subtitle2">{hoveredMarket.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {hoveredMarket.brand} · {hoveredMarket.supplierId} · {hoveredMarket.route}
              </Typography>
              <Typography variant="caption">
                {eur(hoveredMarket.piecePriceEUR)} piece →{" "}
                <strong>{eur(hoveredMarket.landed.perUnitEUR)}</strong> landed
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {hoveredMarket.leadTime.totalDays} days · {hoveredMarket.coveragePct}% available ·{" "}
                {hoveredMarket.reliabilityScore}% reliable · {hoveredMarket.supplierRating}/5
              </Typography>
            </Stack>
          </Box>
        )}
        {hoveredCluster && (
          <Box
            sx={{
              position: "absolute",
              left: Math.min(hover!.x + 14, (boxRef.current?.clientWidth ?? 600) - 240),
              top: Math.min(hover!.y + 10, (boxRef.current?.clientHeight ?? 300) - 120),
              px: 1.5,
              py: 1,
              borderRadius: 1,
              bgcolor: "background.paper",
              border: (theme) => `solid 1px ${theme.vars.palette.divider}`,
              boxShadow: (theme) => theme.shadows[8],
              pointerEvents: "none",
              zIndex: 9,
              minWidth: 210,
            }}
          >
            <Stack spacing={0.25}>
              <Typography variant="subtitle2">
                {hoveredCluster.label} · {hoveredCluster.members.length} markets
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Best: {hoveredCluster.best.name} · {eur(hoveredCluster.best.landed.perUnitEUR)}{" "}
                landed
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Click to zoom in and see individual markets
              </Typography>
            </Stack>
          </Box>
        )}
        <Stack direction="row" spacing={0.5} sx={{ position: "absolute", right: 10, top: 10, zIndex: 5 }}>
          {[
            { label: "+", fn: () => setView((v) => ({ ...v, k: clamp(v.k * 1.4, MIN_K, MAX_K) })) },
            {
              label: "−",
              fn: () =>
                setView((v) => {
                  const k = clamp(v.k / 1.4, MIN_K, MAX_K);
                  return { k, ...panBounds(k, v) };
                }),
            },
            { label: "⌂", fn: reset },
          ].map((b) => (
            <Box
              key={b.label}
              component="button"
              onClick={b.fn}
              sx={{
                width: 30,
                height: 30,
                border: "none",
                borderRadius: 1,
                bgcolor: "background.paper",
                color: "text.primary",
                cursor: "pointer",
                fontSize: 15,
                boxShadow: (theme) => theme.shadows[2],
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              {b.label}
            </Box>
          ))}
        </Stack>
      </Box>
      <Stack direction="row" gap={2} flexWrap="wrap" sx={{ mt: 1.5 }}>
        <Stack direction="row" gap={0.75} alignItems="center">
          <Box sx={{ width: 12, height: 12, borderRadius: 1, bgcolor: TIER_GREEN }} />
          <Typography variant="caption" color="text.secondary">cheapest landed</Typography>
        </Stack>
        <Stack direction="row" gap={0.75} alignItems="center">
          <Box sx={{ width: 12, height: 12, borderRadius: 1, bgcolor: TIER_YELLOW }} />
          <Typography variant="caption" color="text.secondary">mid</Typography>
        </Stack>
        <Stack direction="row" gap={0.75} alignItems="center">
          <Box sx={{ width: 12, height: 12, borderRadius: 1, bgcolor: TIER_RED }} />
          <Typography variant="caption" color="text.secondary">most expensive</Typography>
        </Stack>
        <Stack direction="row" gap={0.75} alignItems="center">
          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "#101820" }} />
          <Typography variant="caption" color="text.secondary">★ recommended</Typography>
        </Stack>
        <Stack direction="row" gap={1} alignItems="center" sx={{ ml: "auto" }}>
          <Chip
            size="small"
            label="Ctrl+scroll or +/− to zoom · drag to pan · click a cluster to open it"
          />
        </Stack>
      </Stack>
    </Box>
  );
}
