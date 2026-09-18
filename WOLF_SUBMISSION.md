# Wolf submission: version-aware procurement evidence

## What was found before implementation

The only application in this folder is `frontend/`, a Next.js 15 / React 19 / TypeScript application using MUI. Existing pages cover overview, demand intake, baseline, deep analysis, products, abrasives, supply chain, tender, contracts, decision slides, maturity and training. The existing theme, layouts, navigation, charts and drawers remain intact.

The domain screens consume generated TypeScript adapters under `src/data/`; the baseline drilldown reads `public/data/nullmessung-lines.json`. State is predominantly local React state. Authentication is explicitly skipped; the access endpoint rejects sign-in. There was no database, ingestion queue, persistent approval or dependency engine. The live feed and voice are scripted; intake uses keywords. `/api/analyse` has an optional server-side model adapter, but defaults to a labelled fixed response. It has no authority in the new evidence workflow.

Reviewed materials: both CHALLENGE copies, README, DATASET, COMPONENTS, BRIEFING, VALIDATION, all text notes, package/config/auth/API files, relevant screen implementations, fixture schemas, raw sheet layouts, lineage, generator/validator logic, reference data, and examples from the invoice and ledger families. Images and template assets are not procurement evidence. The ZIP contains the distributed starter; the extracted project is the working copy.

### Dataset inventory and interpretation

| Family | Meaning and treatment |
| --- | --- |
| transactions JSON/CSV, country spend CSVs | 4,872 clean synthetic ledger rows; original dashboard remains separate, as organizers require. |
| products, suppliers, countries | 21 product families, 10 supplier names, 29 markets. Product families are not exact commercial SKUs. |
| product-reference-catalog | 106 reference descriptions; dimensions, pack variants, chemistry and other specifications do not establish supplier equivalence. |
| fx-rates | Synthetic local-currency units per EUR; snapshotted as calculation evidence, never presented as live FX. |
| offer-versions | 414 effective-dated offers; separate exercise, not joined to import records to invent a quotation. |
| synthetic-invoices / invoice-text / invoice-gold | 36 structured/text invoices plus answer data: match, overcharge, below-agreement, missing article, unit and missing agreement cases. Not scanned PDFs; not used as import answers. |
| workflow-events / quality-issues | Designed event and review cases, originally not an implemented workflow. |
| ingestion-versions | Initial `v1` rows are genuine inputs for this exercise. `v2` and `current` are expected outputs, used only by tests. No original v1 workbooks exist. |
| input-sheets JSON/CSV / input-schema | Five raw sheet layouts with duplicate headers, grouped rows and repeated totals. France/Hungary CSVs are parsed directly by this submission. |
| update-lineage | Authoritative update scope: XK market replacement; IT two-sheet market replacement; HU supplier addition; FR supplier-subset replacement. |
| ui-exports | Reconciliation values for generated screens; not a second ledger to append. |

France has 24 baseline rows: 16 for sup-aster plus eight unaffected rows for sup-novex. Its late file replaces the 16-row subset. Two negative credit/cancellation lines remain negative. Invoice header totals repeat on multiple rows; they are checked once per invoice against signed line amounts. Hungary has 24 initial rows and adds 24 sup-orbit rows at HUF prices. Neither fixture proves like-for-like supplier equivalence.

## Smallest defensible architecture implemented

`source delivery → immutable bytes + SHA-256 + declared scope → durable queue → positional CSV parser / typed v1 input → canonical versions → exact record dependencies → versioned spend finding → reviewer approval`

The event endpoint only accepts the two implemented adapters and version labels. The UI polls every 2.5 seconds and processes at most one queued delivery per call. An optional separate worker continues processing with the browser closed. This is explicitly simulated source delivery; there is no supplier inbox integration.

Canonical records preserve raw values, source filename, sheet or JSON pointer, row/item, source event, original currency/amount, normalized quantity/unit/price, transformation, validity interval and prior correction. Findings depend on exact canonical version IDs. The evidence drawer also answers the reverse question: which findings use this record? Entire original source snapshots, catalog and FX snapshots remain in SQLite.

Replacement, normalization, arithmetic, recomputation and approval invalidation are deterministic. Money uses integer cents with BigInt decimal conversion and half-away-from-zero rounding. Raw France column 11 is the line amount; column 4 is never summed once per line. Unknown currency/unit/product becomes review or a quarantined event, never an invented value. Rejected deliveries do not retire current evidence.

SQLite WAL transactions serialize writes, including multiple local polling clients. A small typed document aggregate is stored in one SQLite row, rather than deploying a second service. This keeps mutation of records, findings and approvals atomic; it is intentionally not a scalable relational warehouse. Event IDs detect collisions; content hashes plus interpretation scope also detect replay with a new ID. Repeated approvals are idempotent. Corrections use optimistic record-version checks.

An approval names one finding ID/version. Changed dependencies create a new finding, retain the old one and mark its approval STALE. Pending evidence blocks approval. Source-integrity polling detects missing/modified files and blocks approval even if a file was edited outside the event pathway. Historical snapshot values remain inspectable.

The decision is **whether to accept a signed historical spend baseline for procurement review**. It is not a supplier award, saving or future spending commitment. This is a deliberate engineering boundary: supplied product IDs group multiple specifications, so a cheapest-equivalent claim would be unsupported. The UI states “Cannot safely compare suppliers.”

## Run and setup (PowerShell)

Node.js 24 is required. No Python, API key, database installation or model endpoint is needed for the evidence workflow.

```powershell
cd D:\projects\dail_germany\ressource_given\wolf-starter\wolf-materials-lab\frontend
npm ci
npm run dev
```

Open http://127.0.0.1:8084/dashboard/evidence/ or choose **Procurement evidence** in the retained sidebar. Baseline also links to this workflow. The original hub's optional ZIP packaging is not required to run it.

For production-mode local demonstration:

```powershell
npm run build
npm start
```

Default database: `frontend/.wolf/evidence.sqlite`, created automatically. Keep the whole starter directory together because the server reads `../kit/dataset`. Optional server variables:

| Variable | Default |
| --- | --- |
| WOLF_DB_PATH | absolute frontend/.wolf/evidence.sqlite |
| WOLF_DATASET_PATH | absolute kit/dataset relative to frontend |

No required environment variables. Existing WOLF_MODEL_* settings only affect the original analyst; they are unrelated to verified evidence.

Stop the server/worker before reset, then run:

```powershell
npm run wolf:reset
```

Reset archives the prior database as a timestamped `.backup`, then creates an empty store. It never rewrites supplied datasets. Start the server again. Optional `npm run wolf:seed` loads both baselines; omit this if demonstrating baseline import on screen.

For delivery while the page is closed, run a second terminal:

```powershell
npm run wolf:worker
```

And deliver a file from a third terminal:

```powershell
npm run wolf:deliver -- FR
npm run wolf:deliver -- HU
```

These commands queue the actual allowed CSV bytes. Without a worker or open evidence page, events remain safely QUEUED. Repeating delivery proves replay.

## Jury demonstration

1. Start from an empty store. Open **Procurement evidence** and click **FR: load baseline**. The poller creates 24 records and three findings. Enter `Demo Buyer` as the reviewer.
2. Approve the `FR / WLF-1008` v1 baseline. Optionally approve `WLF-1001` to show an unaffected approval survives.
3. Click **FR: deliver / replay late file**. Wait for PROCESSED. The event reports **16 added, 16 superseded, eight unchanged, two affected findings**. Net France spend changes from **€171,941.83 to €116,546.84**. The `WLF-1008` finding shows its old/new amount; its old approval is STALE. The unrelated finding retains the same version and approval.
4. Click **Inspect evidence & history** for `WLF-1008`. Select v1/v2 to inspect both. Expand a source row: the late CSV, Sheet1, row number, original values and SHA-256 are visible. `FAC-WOLF-0001:10` is a negative cancellation; it remains **−€11,336.16**, not a positive price opportunity. Repeated header totals are not duplicated.
5. Demonstrate correction on `FAC-WOLF-0001:20` (174 PC, €8,727.84). Click **Correct quantity / unit**. For a clearly labelled *additional simulated human attestation*, enter 87 boxes, two pieces per box; reason: `DEMO attestation only: 87 boxes of two; no supplier equivalence asserted.` This is a workflow test, not a claim supplied by organizers. The source amount stays fixed, the normalized quantity remains 174, and the canonical/finding version changes with the reviewer note. Alternatively enter a genuinely verified correction with its source reference.
6. Approve the new current version. The approval is stored server-side. Reload the page to show persistence. No purchase is made.
7. Click **FR: deliver / replay late file** twice. The history says **0 records, 0 findings, 0 approvals added; totals unchanged**. The corrected record and its current approval remain in place. This is also asserted by automated deep-equality tests.
8. Optional: load HU baseline, then deliver HU late file. Its 24 old rows remain and 24 new rows are added. Total becomes **€389,114.61**; the first added row has **12,911.38 HUF/unit ÷ 394 = €32.77/unit**. Do not call this proof of equivalent products.

For explicit ambiguous-unit failure, the automated test copies the dataset to a temporary test directory, changes one PC unit to a box with unknown pack, verifies ABSTAIN and rejected approval, then resolves it by human correction. Organizer files are untouched.

## Verification

```powershell
npm test
npm run typecheck
npm run build
```

With the server running, `npm run test:http` checks same-origin writes, cross-origin rejection, invalid API commands, approval guards, snapshot redaction and the overview/baseline/evidence routes. It processes at most one already-queued event; use a demo database.

Observed verification on this machine: **9/9 behavioral tests passed**, TypeScript passed, production build passed, and the HTTP checks passed. Browser verification completed baseline delivery → approval → automatic replacement → stale approval → evidence drawer → labelled simulated human correction → v3 approval → replay. Three non-blocking inherited UI lint warnings and a Next ESLint configuration notice remain. Node reports a harmless module-type inference warning for directly running TypeScript tests.

Tests use isolated temporary SQLite databases and fixture copies. `v2/current` answer fixtures are used only for open-fixture evaluation. They are not held-out accuracy measurements.

Covered: initial import, supplier-subset replacement, preservation of unrelated decisions, negative credits, repeated invoice reconciliation, content replay under same/different IDs, repeated approval, stale approval rejection, manual correction/history, HUF/decimal rounding, unit conversions, ambiguous units and correction, invalid replacement scope, missing source/base, malformed batch atomicity, source drift, injection text as data, pending-evidence guard and durable persistence.

## Files changed

- `frontend/src/server/evidence.ts`: typed domain model, SQLite transaction store, parser, normalization, queue, provenance, versioning and approval rules.
- `frontend/src/app/api/evidence/route.ts`: validated local API.
- `frontend/src/sections/evidence/view.tsx` and dashboard evidence page: buyer workflow, evidence/history and correction dialogs.
- Existing sidebar and baseline screen: links to the new workflow, preserving prior screens.
- `frontend/tests/evidence.test.mjs`: deterministic behavioral tests.
- `frontend/scripts/wolf.mjs`, package scripts, `.gitignore`: worker, seed, reset and local state exclusions.

## Known limits and next work

- FR/HU only. XK/IT layouts were inspected but have no import adapter. No arbitrary uploads, PDF/OCR, generic XLSX extraction or multi-tenant service.
- No authentication or role enforcement; reviewer names are explicitly self-declared for a localhost demo. Approval is a real persisted version boundary, not a verified real-world identity.
- No product identity graph, award optimizer, supplier-equivalence claims, live model, messaging or purchasing. AI denied/timeout/schema failures cannot corrupt this path because it makes no AI call; the existing analyst remains separate and unverified for live use.
- Credits are signed records in the replacement ledger. There is no provided original-invoice reversal link; the engine does not invent one or subtract them a second time.
- The imported baseline is the v1 JSON itself. Its descriptive `source` country CSV name is not represented as the original evidence. Snapshots preserve the true input and JSON location.
- Corrections currently cover quantity, unit and pack, with an attestation; not amount, currency or product identity. They preserve the source's line amount. A note is not independent proof of a pack size.
- Source drift intentionally fails closed. Restoring files does not silently restore approvals. For a genuinely new delivery after v2, add a reviewed adapter/version; existing version IDs cannot be reused with changed bytes. A failed event can be retried under a new event ID after fixing the cause.
- Source-integrity failure creates a new NEEDS_REVIEW finding version, retaining the prior calculation and marking its approval stale. Repeated integrity scans do not create more versions for the same outstanding failure.
- Queue processing is local polling, bounded per event, not continuous inbox monitoring. The SQLite aggregate and whole-state API suit this small demo, not large volumes. No cloud/serverless deployment is claimed.
- Next priorities: authenticated reviewer roles; normalized indexed database tables; additional tested XK/IT adapters; explicit later correction manifests; verified SKU/specification mapping; independent held-out fixtures. Keep human review and deterministic calculations as those features are added.
