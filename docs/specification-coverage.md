# Specification coverage matrix

Every requirement and decision in the approved [PROJECT_PLAN.md](../PROJECT_PLAN.md),
mapped to the code, tests, and documents that will satisfy it, with its status today.

This is the honest inventory. At this commit the repository contains the toolchain,
documentation, tenant-bound function wrappers with **mandatory server-side permission
enforcement and audited authorization attempts**, signed Clerk webhook
synchronization, the permission catalogue, policy evaluator, and provisioning
seed, and — as of this commit — the **pure inventory primitives**: quantity as
integer minor units, exact rational UOM conversion, GS1 parsing, identifier
normalization, LPNs, Bangkok business dates, and FIFO/FEFO ordering
([`convex/model/**`](../convex/model/README.md)), the append-only ledger, and — as of
this commit — a Thai-first application shell whose two inventory screens call the
ledger's real public queries. The inbound
workflow now exists end to end — purchase orders, previewed import, receipts with tolerance and
exception rules, QC sampling and dispositions, handling units, versioned label payloads, and
explainable putaway, each with a Thai-first desktop screen and, where an operator needs one, a
handheld screen. A denied _read_ is still not recorded (`RG-071`). With no identity
provider configured, every tenant-bound read is denied, so the read path has never
run against a resolved tenant. Accordingly, no product outcome claims more than
`Partial`.

## How to read this

- **IDs are stable.** `SC-D12` stays `SC-D12` for the life of the project. Later commits
  change the `Status` column and the linked artefacts, never the IDs.
- **Planned code** paths follow the intended structure in plan §8. Except where a row links
  a real path, they do not exist yet.
- **Status vocabulary** — three values are currently valid:

  | Status            | Meaning                                                                                                     |
  | ----------------- | ----------------------------------------------------------------------------------------------------------- |
  | `Not implemented` | Nothing in the repository advances this requirement. An installed-but-unwired dependency counts as nothing. |
  | `Foundation only` | Something real exists — a pipeline, a tier, a pin — but it asserts scaffolding, not domain behaviour.       |
  | `Partial`         | Part of the requirement is implemented and tested, and the row says which part is still missing.            |

  Later commits may introduce `Implemented` and `Verified` (gate satisfied with evidence).
  Do not use those values until they are true.

- **Docs** column links the ADR or contract that owns the decision.

## 1. MVP outcomes (plan §2.1)

| ID       | Outcome                                                                                   | Planned code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Planned tests                                                                     | Docs                                                                                                                           | Status          |
| -------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| `SC-O01` | Tenant provisioned; users invited; restricted to authorized warehouses and actions        | `convex/organizations/**`, `convex/lib/auth.ts`, `convex/lib/permissions.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | integration, isolation, e2e                                                       | [ADR-0001](./adr/0001-multi-tenant-saas-and-identity-ownership.md), [ADR-0006](./adr/0006-authorization-and-support-access.md) | Not implemented |
| `SC-O02` | Create or import a PO and receive it partially or completely                              | [`convex/purchasing/orders.ts`](../convex/purchasing/orders.ts), [`convex/receiving/receipts.ts`](../convex/receiving/receipts.ts), [`convex/model/inbound/**`](../convex/model/inbound), [`src/features/inbound/**`](../src/features/inbound)                                                                                                                                                                                                                                                                                                    | unit, property, integration, isolation, a11y, e2e (both shells)                   | [ADR-0007](./adr/0007-inbound-slice-scope.md)                                                                                  | Partial         |
| `SC-O03` | Scan an item; capture quantity, UOM, lot, manufacture/expiry; build a pallet HU           | [`convex/model/gs1/**`](../convex/model/gs1), [`convex/model/identifiers/**`](../convex/model/identifiers), [`convex/model/uom/**`](../convex/model/uom); [`src/features/inbound/InboundForms.tsx`](../src/features/inbound/InboundForms.tsx) resolves a scanned barcode or SKU to an item through [`resolveScanToItem`](../convex/masterData/catalogue.ts), captures quantity, UOM, lot, and expiry, and builds a pallet; GS1 element-string resolution at capture, LPN-to-handling-unit resolution, and the `INT-03` camera fallback are absent | unit, property, integration, a11y, e2e (preview)                                  | [ADR-0005](./adr/0005-warehouse-location-and-stock-identity.md)                                                                | Partial         |
| `SC-O04` | QC-controlled stock lands in `QC_HOLD`; permitted approver dispositions it                | [`convex/quality/inspections.ts`](../convex/quality/inspections.ts), [`convex/model/inbound/qcPolicy.ts`](../convex/model/inbound/qcPolicy.ts), [`src/features/inbound/QualityWorkbench.tsx`](../src/features/inbound/QualityWorkbench.tsx)                                                                                                                                                                                                                                                                                                       | unit, property, integration (two users), isolation, a11y, e2e                     | [ADR-0007](./adr/0007-inbound-slice-scope.md)                                                                                  | Partial         |
| `SC-O05` | Versioned ZPL plus PDF fallback generated, printed, and retained as audit evidence        | [`convex/labels/print.ts`](../convex/labels/print.ts) generates and retains a versioned payload with its hash; nothing renders a PDF, transmits, or prints — `PrinterTransportPort` absent                                                                                                                                                                                                                                                                                                                                                        | unit, property, integration, isolation; physical absent                           | [INT-04](./integration-contracts/printer-transport-port.md)                                                                    | Partial         |
| `SC-O06` | Putaway gives an explainable recommendation, allows an audited override, posts the move   | [`convex/model/inbound/putawayScoring.ts`](../convex/model/inbound/putawayScoring.ts), [`convex/putaway/tasks.ts`](../convex/putaway/tasks.ts), [`src/features/inbound/PutawayRecommendation.tsx`](../src/features/inbound/PutawayRecommendation.tsx)                                                                                                                                                                                                                                                                                             | unit, property, integration, isolation, a11y, e2e (both shells)                   | [ADR-0007](./adr/0007-inbound-slice-scope.md)                                                                                  | Partial         |
| `SC-O07` | Every inventory change is immutable, idempotent, balanced, with same-transaction balances | [`convex/lib/inventoryLedgerStore.ts`](../convex/lib/inventoryLedgerStore.ts), [`convex/lib/idempotency.ts`](../convex/lib/idempotency.ts), [`convex/inventory/**`](../convex/inventory)                                                                                                                                                                                                                                                                                                                                                          | property, integration, isolation                                                  | [ADR-0003](./adr/0003-append-only-inventory-ledger.md)                                                                         | Partial         |
| `SC-O08` | Users inspect stock and history without editing balances                                  | [`convex/inventory/ledger.ts`](../convex/inventory/ledger.ts), [`src/features/inventory/**`](../src/features/inventory), [`src/components/inventory/**`](../src/components/inventory)                                                                                                                                                                                                                                                                                                                                                             | unit, a11y, integration (contract), e2e (preview)                                 | [ADR-0003](./adr/0003-append-only-inventory-ledger.md)                                                                         | Partial         |
| `SC-O09` | Small dashboard on bounded/pre-aggregated queries, including occupancy                    | [`convex/model/reporting/**`](../convex/model/reporting), [`convex/lib/rollupStore.ts`](../convex/lib/rollupStore.ts), [`convex/reporting/**`](../convex/reporting), [`src/features/reporting/**`](../src/features/reporting); maintained counters moved in the domain transaction, verified against a fresh derivation; occupancy as an accessible 2D table rather than SVG                                                                                                                                                                      | unit, property (counter and CSV), integration, isolation, a11y, e2e (both shells) | [ADR-0011](./adr/0011-async-jobs-reporting-and-observability.md)                                                               | Partial         |
| `SC-O10` | Asynchronous CSV export jobs with private artifacts                                       | [`convex/reporting/exports.ts`](../convex/reporting/exports.ts), [`convex/model/reporting/csv.ts`](../convex/model/reporting/csv.ts), [`src/features/reporting/ExportWorkbench.tsx`](../src/features/reporting/ExportWorkbench.tsx); chunked, resumable, replayed on a repeated request, stopped rather than truncated; signed-URL delivery needs the file-storage vendor                                                                                                                                                                         | property (round trip), integration, isolation, a11y, e2e (preview)                | [ADR-0011](./adr/0011-async-jobs-reporting-and-observability.md)                                                               | Partial         |
| `SC-O11` | Independent encrypted export with a rehearsed restore                                     | [`scripts/lib/exportEnvelope.mjs`](../scripts/lib/exportEnvelope.mjs), [`scripts/rehearse-restore.mjs`](../scripts/rehearse-restore.mjs); AES-256-GCM, plaintext digest, declared record count, and three refusals; a production snapshot restored against the agreed RTO stays open                                                                                                                                                                                                                                                              | integration                                                                       | [ADR-0021 backlog](./adr/README.md), [RB-02](./runbooks/backup-and-restore.md)                                                 | Partial         |

## 2. Phase 0 blocking decisions (plan §4)

All twelve are accepted without exceptions, recorded in the
[approval record](./approval-record.md) (`AR-001`, 2026-08-03), which satisfies `RG-001`.
Acceptance is a decision, not an implementation: every row below is still
`Not implemented`.

| ID       | Decision                                      | Where it is recorded                                                                                                    | Verification / evidence       | Status          |
| -------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------- |
| `SC-B01` | Launch customer profile                       | [ADR-0001](./adr/0001-multi-tenant-saas-and-identity-ownership.md)                                                      | `RG-001`, `RG-063`            | Not implemented |
| `SC-B02` | Sales-provisioned tenancy, manual billing     | [ADR-0001](./adr/0001-multi-tenant-saas-and-identity-ownership.md), [RB-05](./runbooks/tenant-onboarding.md)            | `RG-001`                      | Not implemented |
| `SC-B03` | Hosting region and residency                  | [ADR-0008](./adr/0008-adapter-ports-and-release-gates.md), [INT-02](./integration-contracts/convex-hosting.md)          | `RG-002`, `RG-006`            | Not implemented |
| `SC-B04` | Degraded-online connectivity                  | [ADR-0009](./adr/0009-degraded-online-connectivity.md)                                                                  | `RG-009`, `RG-010`            | Not implemented |
| `SC-B05` | Hardware baseline (HID scanner, ZPL printer)  | [ADR-0008](./adr/0008-adapter-ports-and-release-gates.md), [INT-08](./integration-contracts/device-capture-adapters.md) | `RG-003`, `RG-004`            | Not implemented |
| `SC-B06` | Traceability: `NONE`/`LOT`, serial-ready, HUs | [ADR-0005](./adr/0005-warehouse-location-and-stock-identity.md)                                                         | property, integration tiers   | Partial         |
| `SC-B07` | ERP boundary: in-app plus CSV/XLSX import     | [ADR-0007](./adr/0007-inbound-slice-scope.md)                                                                           | `RG-068`                      | Not implemented |
| `SC-B08` | Three.js deferred; flat 2D occupancy          | [ADR-0011](./adr/0011-async-jobs-reporting-and-observability.md)                                                        | `three` absent; a11y tier     | Implemented     |
| `SC-B09` | Thai compliance and counsel gate              | [ADR-0012](./adr/0012-delivery-release-and-quality-gates.md)                                                            | `RG-006`, `RG-048`            | Not implemented |
| `SC-B10` | Thai-first locale                             | [ADR-0010](./adr/0010-thai-first-i18n-and-accessibility.md)                                                             | `RG-043`, a11y and unit tiers | Partial         |
| `SC-B11` | Scale envelope                                | [ADR-0011](./adr/0011-async-jobs-reporting-and-observability.md), [INT-02](./integration-contracts/convex-hosting.md)   | `RG-037`, `RG-069`            | Not implemented |
| `SC-B12` | No catch-weight; 3-decimal precision cap      | [ADR-0004](./adr/0004-exact-quantities-and-uom.md)                                                                      | property tier                 | Partial         |

## 3. Recommended defaults (plan §3.2)

All thirty are accepted without exceptions in the same
[approval record](./approval-record.md) entry (`AR-001`). None is implemented.

| ID       | Default                                              | Planned code / artefact                                                                                                                                  | Planned tests                              | Docs                                                                  | Status          |
| -------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------- | --------------- |
| `SC-D01` | Target tenant profile and volumes                    | Load-test fixtures                                                                                                                                       | load                                       | [ADR-0001](./adr/0001-multi-tenant-saas-and-identity-ownership.md)    | Not implemented |
| `SC-D02` | Installable PWA, handheld and desktop shells         | [`public/manifest.webmanifest`](../public/manifest.webmanifest), [`src/app/[locale]/`](../src/app), [`src/components/shell/**`](../src/components/shell) | e2e, a11y                                  | [ADR-0009](./adr/0009-degraded-online-connectivity.md)                | Partial         |
| `SC-D03` | Supported browser and device matrix                  | [Playwright projects](../playwright.config.ts) (desktop + Pixel 5 Chromium); no capability detection                                                     | e2e                                        | [ADR-0009](./adr/0009-degraded-online-connectivity.md)                | Foundation only |
| `SC-D04` | HID scanner primary, camera secondary                | `ScannerPort`, `CameraScanPort`                                                                                                                          | unit, e2e (synthetic HID)                  | [INT-08](./integration-contracts/device-capture-adapters.md)          | Not implemented |
| `SC-D05` | UTC timestamps, org-timezone business dates          | [`convex/model/time/businessDate.ts`](../convex/model/time/businessDate.ts)                                                                              | unit (midnight boundary, host-TZ sweep)    | [ADR-0010](./adr/0010-thai-first-i18n-and-accessibility.md)           | Partial         |
| `SC-D06` | Thai default, English fallback, BE display only      | [`messages/`](../messages), [`src/i18n/**`](../src/i18n), [`src/lib/formatters.ts`](../src/lib/formatters.ts)                                            | unit (key parity), a11y, e2e               | [ADR-0010](./adr/0010-thai-first-i18n-and-accessibility.md)           | Partial         |
| `SC-D07` | THB integer minor units, single currency             | `src/lib/money/**`                                                                                                                                       | unit                                       | [ADR-0004](./adr/0004-exact-quantities-and-uom.md)                    | Not implemented |
| `SC-D08` | Integer base-UOM quantities, exact conversions       | [`convex/model/uom/**`](../convex/model/uom)                                                                                                             | unit, property, integration                | [ADR-0004](./adr/0004-exact-quantities-and-uom.md)                    | Partial         |
| `SC-D09` | Tracking modes with serial disabled                  | `convex/schema.ts`, feature flag                                                                                                                         | integration (serial rejected)              | [ADR-0005](./adr/0005-warehouse-location-and-stock-identity.md)       | Not implemented |
| `SC-D10` | HUs, LPN history, split/merge/nest, mixed off        | `convex/handlingUnits/**`                                                                                                                                | property, integration                      | [ADR-0005](./adr/0005-warehouse-location-and-stock-identity.md)       | Not implemented |
| `SC-D11` | Status and owner orthogonal; consignment off         | `convex/schema.ts` bucket fields                                                                                                                         | property, integration                      | [ADR-0005](./adr/0005-warehouse-location-and-stock-identity.md)       | Not implemented |
| `SC-D12` | Negative available inventory forbidden               | `convex/model/ledger/**`                                                                                                                                 | property                                   | [ADR-0003](./adr/0003-append-only-inventory-ledger.md)                | Not implemented |
| `SC-D13` | Capacity advisory, compatibility hard                | `convex/model/putaway/**`                                                                                                                                | unit, integration                          | [ADR-0005](./adr/0005-warehouse-location-and-stock-identity.md)       | Not implemented |
| `SC-D14` | Deterministic explainable putaway with override      | `convex/model/putaway/**`, `convex/putaway/**`                                                                                                           | property, integration                      | [ADR-0007](./adr/0007-inbound-slice-scope.md)                         | Not implemented |
| `SC-D15` | GS1-128 where licensed, internal LPN otherwise       | [`convex/model/gs1/**`](../convex/model/gs1), [`convex/model/identifiers/lpn.ts`](../convex/model/identifiers/lpn.ts)                                    | unit, property; corpus fixtures absent     | [ADR-0005](./adr/0005-warehouse-location-and-stock-identity.md)       | Partial         |
| `SC-D16` | ZPL primary, PDF fallback, local print bridge        | `PrinterTransportPort` adapter, label generator                                                                                                          | unit, physical                             | [INT-04](./integration-contracts/printer-transport-port.md)           | Not implemented |
| `SC-D17` | Server-side permission model with policies           | `convex/lib/permissions.ts`, `convex/lib/authorization.ts`, `convex/lib/authorizationLookupsConvex.ts`, `convex/lib/tenantFunctions.ts`                  | integration matrix, property, isolation    | [permissions](./permissions.md)                                       | Partial         |
| `SC-D18` | `orgId` on every tenant table and index first        | `convex/schema.ts`, `convex/lib/tenantTable.ts`, `convex/lib/schemaPolicy.ts`; `convex/lib/tenantDb.ts` absent                                           | isolation (present), static guard (absent) | [ADR-0002](./adr/0002-convex-tenant-boundary-and-index-discipline.md) | Partial         |
| `SC-D19` | Pure domain modules, thin Convex functions           | `convex/model/**`, feature modules                                                                                                                       | unit, static guard                         | [ADR-0002](./adr/0002-convex-tenant-boundary-and-index-discipline.md) | Not implemented |
| `SC-D20` | Private tenant files, short-lived signed URLs        | `FileStoragePort` adapter, `src/app/api/uploadthing/**`                                                                                                  | unit, integration                          | [INT-03](./integration-contracts/file-storage-port.md)                | Not implemented |
| `SC-D21` | Workflow/Workpool/crons plus transactional outbox    | `convex/crons.ts`, `JobQueuePort`, outbox tables                                                                                                         | integration                                | [INT-06](./integration-contracts/job-queue-port.md)                   | Not implemented |
| `SC-D22` | Expand–migrate–contract, idempotent seeds            | `convex/migrations/**`, seeds                                                                                                                            | integration                                | [ADR-0012](./adr/0012-delivery-release-and-quality-gates.md)          | Not implemented |
| `SC-D23` | Trunk-based, previews, staging, production, CI gates | `.github/workflows/**`, `scripts/verify-workflows.mjs`                                                                                                   | CI itself                                  | [ADR-0012](./adr/0012-delivery-release-and-quality-gates.md)          | Foundation only |
| `SC-D24` | WCAG 2.2 AA plus warehouse ergonomics                | [`src/app/globals.css`](../src/app/globals.css) tokens, [`src/components/**`](../src/components), a11y tier                                              | a11y, e2e, manual audit                    | [ADR-0010](./adr/0010-thai-first-i18n-and-accessibility.md)           | Partial         |
| `SC-D25` | Paid Convex tier sized after load testing            | Sizing note                                                                                                                                              | load                                       | [INT-02](./integration-contracts/convex-hosting.md)                   | Not implemented |
| `SC-D26` | RPO 24 h / RTO 8 h with rehearsed restores           | Export jobs, [RB-02](./runbooks/backup-and-restore.md)                                                                                                   | rehearsal                                  | [ADR-0012](./adr/0012-delivery-release-and-quality-gates.md)          | Not implemented |
| `SC-D27` | Seven-year ledger/audit retention, pending review    | Retention config, export jobs                                                                                                                            | integration                                | [ADR-0012](./adr/0012-delivery-release-and-quality-gates.md)          | Not implemented |
| `SC-D28` | No Three.js; 2D SVG occupancy                        | Occupancy map component                                                                                                                                  | static (`three` absent), a11y              | [ADR-0011](./adr/0011-async-jobs-reporting-and-observability.md)      | Foundation only |
| `SC-D29` | pnpm with exact pinned versions                      | `package.json`, `pnpm-lock.yaml`, `.npmrc`                                                                                                               | CI frozen install                          | [README](../README.md)                                                | Foundation only |
| `SC-D30` | Server-enforced entitlements, manual billing         | `convex/lib/authorization.ts` (fact), `convex/organizations/entitlements` (absent)                                                                       | integration, isolation                     | [ADR-0001](./adr/0001-multi-tenant-saas-and-identity-ownership.md)    | Partial         |

`SC-D28` is `Foundation only` because the true half is already true — `three` is absent from
the dependency graph — while the occupancy map it substitutes for does not exist.

`SC-D05`, `SC-D08`, and `SC-D15` are `Partial` in the same narrow sense: the algebra each
decision names is implemented and tested as pure modules under
[`convex/model/**`](../convex/model/README.md), and nothing stores, posts, or serves any of
it.

`SC-D02`, `SC-D06`, `SC-D24`, and `SC-B10` move to `Partial` at this commit. What is real:
locale-segmented routing with server-resolved locale, both catalogues with asserted key and
placeholder parity, a desktop and a handheld shell over one navigation model, one formatting
layer, semantic tokens with a 48-pixel touch token and a never-removed focus ring, status as
a word rather than a colour, and axe-core assertions against the Thai catalogue for every
screen that ships. What is not: a service worker or any caching (`SC-D02`), Thai collation
and reviewed Thai copy (`SC-D06`, `SC-B10`, `OPS-0010-01`), Buddhist Era on any document
(`RG-043`), and every manual acceptance item — screen reader, glove, lighting, and contrast
audit on real hardware (`SC-D24`, `RG-042`).

`SC-O07` moves to `Partial`: the ledger posts, projects, reverses, and is idempotent, and this
commit extracted that idempotency machinery into
[`convex/lib/idempotency.ts`](../convex/lib/idempotency.ts) so a second writer reuses the
proved decision rather than reimplementing it — with the ledger's own suites re-run unchanged
to prove the extraction regressed nothing. What keeps it short of `Implemented` is the absence
of a soak test and of any run against a deployed backend.

`SC-O08` is `Partial` for a narrower reason: the balances and history screens read the real
`queryWithOrg` functions and no screen can write a balance, but with no identity provider
configured every one of those reads is denied, so the path has never been exercised against a
resolved tenant. The same is now true of the master-data surface
([`convex/masterData/catalogue.ts`](../convex/masterData/catalogue.ts),
[`convex/masterData/writes.ts`](../convex/masterData/writes.ts)) and its screens: bounded list
functions each declaring its own **read** permission rather than borrowing a `manage` code,
idempotent audited mutations, and desktop screens that now maintain suppliers, item barcodes,
alternate units, storage classes, label templates, items, locations, and lots — all proved
tenant-confined by blocking isolation suites, and all denied on an unconfigured machine.

The inbound slice (`SC-O02`, `SC-O04`, `SC-O05`, `SC-O06`) stays `Partial` together and for one
shared reason, which is no longer the absence of screens. Purchase-order authoring and previewed
import, partial/over/under/unexpected/cancelled/blind receipt rules, lot and expiry capture, QC
sampling and maker-checker dispositions, pallet construction, versioned label evidence, and
explainable putaway with audited override are all implemented, tenant-confined, and proved by
unit, property, integration, and two-tenant isolation suites — and each has a Thai-first desktop
screen, with handheld screens for receive, quality, and putaway, covered by component,
accessibility, and Playwright suites on both viewports.

Every identifier those screens send is chosen rather than typed: each inbound field whose name
ends `Id` is a select over a bounded, tenant-scoped catalogue read — or, for the item on a carton,
a scan the server resolves — and `tests/integration/inbound-real-mode.integration.test.ts` asserts
that structurally over the feature source, because a hard-coded preview identifier is invisible to
both the type checker and the preview end-to-end suite.

What keeps them short of `Implemented` is that **none has run against a resolved tenant**: with no
Clerk instance every tenant-bound call is denied, so the screens have only ever been exercised
against synthetic preview data. `RG-051` — a real PO completing the journey on pilot hardware —
is a physical gate that stays open, as do `RG-003` (scanner spike), `RG-004`/`RG-029` (printed
labels), and `INT-03`/`INT-04` (scanner and printer transports).

`SC-O09`, `SC-O10`, and `SC-O11` are Phase 4 and are `Partial` for reasons that are
each a named vendor rather than missing work.

The dashboard counters are maintained by the domain mutations themselves, so a tile
is a single indexed document read rather than a count over the tables that grow
fastest (`INV-0011-07`). Every counter is recomputable, and
`reporting/rollups:verifyRollups` recomputes it: the integration tier drives real
receipts, dispositions, and putaway claims and then asserts the tile equals a fresh
derivation of the tables that define it. A decrement that would go below zero clamps
and marks the counter suspect rather than refusing a posting at a dock — a display
counter must never stop a warehouse — and the tile says so in words.

`SC-B08` moves to `Implemented`: `three` is absent from the dependency graph and the
occupancy view is a flat, accessible grid. It is a `<table>` rather than the ADR's
"SVG", which honours the decision that was actually being made (flat, not Three.js)
and improves on it — a warehouse map is tabular data, so keyboard traversal and
row/column announcement come from the element rather than from an ARIA parallel that
could drift.

What keeps the export row short of `Implemented` is `INV-0011-08`: artifacts must be
delivered through short-lived signed URLs, which needs the file-storage vendor
(`INT-08`). Until then the artifact is fetched through a permission-checked query and
saved as a local blob — a narrower channel than a signed URL, stated as such on the
screen, and capped by a document size limit that a production-scale export would
exceed. The chunk runner is likewise a control an operator presses rather than a
Workflow/Workpool worker (`INT-06`), and it advances exactly one bounded page per
press so the shape is honest about which of those exists.

`SC-O11` rehearses the _format and the procedure_ locally: seal, restore, and prove
the three refusals — wrong key, tampered ciphertext, and the one every backup story
misses, an archive that decrypts correctly and is short. `pnpm rehearse:restore`
exits non-zero on any of them. A production snapshot restored from the operator's own
key store against the agreed RTO is the part that stays open (`RG-006`).

Implementing the slice surfaced a latent ledger defect worth recording: `MAX_TRANSACTION_LINES`
was 200 while the tenant-bound reader caps a `take` at 100, so every idempotent **replay** of a
posting failed with `INVALID_LIMIT` (`INV-0003-01`). Nothing had exercised a replay through a
mutation before. The cap is now 100 and the coupling is asserted.

`SC-O05` moves to `Partial` for a deliberately narrow reason, and the boundary is worth
stating because a label feature implies a printer. Template **versions** are authored,
bounded, versioned server-side, and published under maker-checker; a printed label can cite
the version that produced it. Nothing in this repository generates ZPL, renders a PDF,
previews a payload, or transmits anything to a device. The printer transport is `INT-04` and
does not exist, physical print verification is `RG-004` and has not happened, and no screen
implies otherwise.

## 4. Ledger invariants (plan §7.5)

Each invariant maps to the ADR-0003 identifier and the tier that must prove it.

| ID       | Invariant                                                 | ADR ID        | Proving tier              | Status          |
| -------- | --------------------------------------------------------- | ------------- | ------------------------- | --------------- |
| `SC-L01` | Request ID unique per org; replay returns original        | `INV-0003-01` | property, integration     | Not implemented |
| `SC-L02` | Lines balance, including virtual boundaries               | `INV-0003-02` | property                  | Not implemented |
| `SC-L03` | No zero-quantity line                                     | `INV-0003-03` | property                  | Not implemented |
| `SC-L04` | All references belong to the active organization          | `INV-0003-04` | isolation, property       | Not implemented |
| `SC-L05` | Lot/item, location/warehouse, single HU location          | `INV-0003-05` | property, integration     | Not implemented |
| `SC-L06` | Available balance never negative without explicit policy  | `INV-0003-06` | property                  | Not implemented |
| `SC-L07` | Transactions and lines never updated or deleted           | `INV-0003-07` | static guard, integration | Not implemented |
| `SC-L08` | Reversal rules: one original, compensating, not chainable | `INV-0003-08` | property, integration     | Not implemented |
| `SC-L09` | Projections written in the same mutation                  | `INV-0003-09` | integration               | Not implemented |
| `SC-L10` | Scheduled replay proves equality and alerts on drift      | `INV-0003-10` | integration, soak         | Not implemented |
| `SC-L11` | No direct balance-write API                               | `INV-0003-11` | static guard              | Not implemented |
| `SC-L12` | Audit appended in the same mutation, never mutated        | `INV-0003-12` | integration, static guard | Not implemented |

## 5. Merge gates and quality strategy (plan §12)

| ID       | Gate or suite                                             | Where it runs                                           | Gate ID  | Status          |
| -------- | --------------------------------------------------------- | ------------------------------------------------------- | -------- | --------------- |
| `SC-Q01` | Formatting and lint                                       | `Static analysis` job, `pnpm format:check`, `pnpm lint` | `RG-053` | Foundation only |
| `SC-Q02` | Strict typecheck                                          | `Static analysis` job, `pnpm typecheck`                 | `RG-053` | Foundation only |
| `SC-Q03` | Dependency audit                                          | Not present                                             | `RG-053` | Not implemented |
| `SC-Q04` | Unit tier (domain algebra, components)                    | `Test (unit)` job                                       | `RG-054` | Partial         |
| `SC-Q05` | Property tier (ledger, UOM, parsers, putaway)             | `Test (property)` job                                   | `RG-054` | Partial         |
| `SC-Q06` | Integration tier (schema contracts; no `convex-test`)     | `Test (integration)` job                                | `RG-054` | Partial         |
| `SC-Q07` | Isolation tier, blocking                                  | `Test (isolation)` job                                  | `RG-031` | Partial         |
| `SC-Q08` | Accessibility tier (axe-core)                             | `Test (a11y)` job                                       | `RG-042` | Partial         |
| `SC-Q09` | Playwright smoke journey                                  | `Playwright` workflow                                   | `RG-055` | Partial         |
| `SC-Q10` | Production build with no environment variables            | `Production build` job                                  | —        | Foundation only |
| `SC-Q11` | CI configuration guard (SHA pinning, no secrets)          | `pnpm verify:workflows`                                 | —        | Foundation only |
| `SC-Q17` | Environment contract guard (per-class required/forbidden) | `pnpm verify:environment`                               | `RG-014` | Partial         |
| `SC-Q12` | Static: no exported function bypasses the wrapper         | `pnpm verify:tenant-boundary`                           | `RG-032` | Partial         |
| `SC-Q13` | Static: no mutation updates or deletes ledger/audit       | `pnpm verify:tenant-boundary` (`auditEvents` only)      | `RG-033` | Partial         |
| `SC-Q14` | Static: no unbounded tenant scan or tenant `.filter()`    | Not present                                             | `RG-034` | Not implemented |
| `SC-Q15` | Physical device acceptance                                | Pilot site                                              | `RG-051` | Not implemented |
| `SC-Q16` | Load and hot-bucket contention tests                      | Not present                                             | `RG-037` | Not implemented |

The remaining `Foundation only` rows above are the honest description of a green pipeline
whose content proves the wiring rather than the domain. No placeholder test files remain: the
scaffold unit, a11y, property, and e2e placeholders were deleted as their real suites landed.

`SC-Q04` and `SC-Q05` are `Partial` as of this commit: both tiers now carry real domain
suites over the pure inventory primitives — the unit tier also collects
`convex/model/**/*.test.ts` — and the property tier includes negative controls that fail
against deliberately weakened implementations. Neither tier covers a ledger, a putaway
policy, or a component, because none exists.

`SC-Q06` and `SC-Q07` are `Partial`, not `Foundation only`, because their placeholders are
gone and what replaced them asserts real properties: `orgId`-first tenancy, the three-table
root allowlist, closed value sets, bounded uniqueness lookups, the absence of credential
fields, the guards' own ability to fail, and — through `convex-test` — the tenant-bound
accessor and the authorization decisions of two tenants sharing one actor. What they still do
not assert is anything against a deployed backend, and no feature function exists to exercise
either tier end to end. That is why `RG-013` and `RG-031` stay open.

`SC-Q17` is a new row, not in the plan's §12 list: the plan asks for environment _design_
(§10 Phase 1) and this is the mechanical half of it. It is `Partial` because the contract and
its validator are real and run in CI, while nothing checks a deployed environment — there is
no deployed environment. See [environment contracts](./environments.md) for the precise
external prerequisites.

`SC-Q18` and `SC-Q19` are new rows and both are `Partial`. The drivers are real, bounded,
resumable, tenant-confined, and read-only, with unit, integration, and two-tenant isolation
coverage including interruption and resume from a foreign checkpoint. What is missing is a
**schedule**: a Convex cron needs a deployment, and the scheduled entry point needs a
`SYSTEM` actor path that `INV-0006-08` reserves and nothing implements. The exact gate is in
[the jobs manual](./manuals/inventory-jobs.md).

A platform constraint shaped both, and is worth recording: **Convex permits one paginated
query per function execution**. Each driver therefore reads exactly one page per call and the
caller loops; per-bucket reconciliation uses a bounded `take` capped one below the accessor's
own page cap, and a bucket deeper than that is reported as `RECONCILE_INCOMPLETE` rather than
folded partially.

`SC-Q08` and `SC-Q09` are `Partial` as of this commit: their placeholders are gone. The a11y
tier asserts zero axe violations for both shells, both inventory tables in Thai and English,
all seven panel states, and the setup checklist, rendered against the Thai catalogue. The
Playwright covers localized sign-in, every private route on desktop and handheld,
the Clerk callback path, and security headers. Authenticated feature behavior is
covered by component, integration, and tenant-isolation suites.

`SC-Q12` and `SC-Q13` are `Partial` because the guards exist and are proved to fail on each
bypass, while the things they guard — exported feature functions, ledger tables — do not exist
yet.

## 5a. Tenant security schema and enforcement (plan §7.1)

The implemented slices, listed separately so they cannot be mistaken for a working
capability. Rows `SC-S01`…`SC-S08` are schema shape plus tests over that shape; `SC-S09`…
`SC-S11` are code that runs, though only against `convex-test` — nothing is deployed.

| ID       | Item                                                              | Code                                                                                                                                             | Tests                            | Status  |
| -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | ------- |
| `SC-S01` | Tenant, identity, and membership tables with Clerk keys           | `convex/schema.ts`                                                                                                                               | integration, isolation           | Partial |
| `SC-S02` | `orgId` required and first; every index `orgId`-prefixed          | `convex/lib/tenantTable.ts`                                                                                                                      | integration, isolation           | Partial |
| `SC-S03` | Root allowlist is exactly `organizations`, `users`, `permissions` | `convex/lib/schemaPolicy.ts`                                                                                                                     | isolation                        | Partial |
| `SC-S04` | Closed value sets for status, scope, outcome, denial reason       | `convex/lib/validators.ts`                                                                                                                       | integration                      | Partial |
| `SC-S05` | Safe organization defaults; every capability flag off             | `convex/lib/organizationDefaults.ts`                                                                                                             | integration                      | Partial |
| `SC-S06` | Bounded-lookup contracts for every unique-by-contract key         | `convex/lib/schemaPolicy.ts`                                                                                                                     | integration, isolation           | Partial |
| `SC-S07` | No credential material in any field, at any depth                 | `convex/lib/schemaPolicy.ts`                                                                                                                     | isolation                        | Partial |
| `SC-S08` | Support grants schema-ready, disabled, no bypass field            | `convex/schema.ts`, `convex/lib/organizationDefaults.ts`                                                                                         | integration                      | Partial |
| `SC-S09` | Tenant-bound accessor (`G-102`) and auth wrappers                 | `convex/lib/tenantDb.ts`, `convex/lib/tenantFunctions.ts`                                                                                        | integration, isolation           | Partial |
| `SC-S10` | Provisioning, webhook sync, role seeding, permission checks       | `convex/http.ts`, `convex/lib/clerkWebhook*.ts`, `convex/lib/identityMirrorConvex.ts`, `convex/lib/authorizationSeedConvex.ts`                   | property, integration, isolation | Partial |
| `SC-S11` | Mandatory permission enforcement and audited attempts             | `convex/lib/authorization.ts`, `convex/lib/authorizationLookupsConvex.ts`, `convex/lib/tenantFunctions.ts`, `scripts/verify-tenant-boundary.mjs` | integration, isolation           | Partial |

`SC-S11` is `Partial` for three stated reasons: no feature function declares a permission
yet, a denied read cannot be recorded from a Convex query (`RG-071`), and threshold and
maker-checker values are supplied per operation by a server-side callback because no policy
table exists (§5 Q26).

## 6. Documentation coverage

| ID       | Document                                                   | Purpose                                         | Status                            |
| -------- | ---------------------------------------------------------- | ----------------------------------------------- | --------------------------------- |
| `SC-X01` | [ADR-0001…ADR-0012](./adr/README.md)                       | Cross-cutting architecture decisions            | Complete for Phase 0 (`RG-062`)   |
| `SC-X02` | [Domain glossary](./domain-glossary.md)                    | Ubiquitous language                             | Complete, expands with the domain |
| `SC-X03` | [Permission catalogue](./permissions.md)                   | Code-owned permissions, roles, policy semantics | Complete, review pending `RG-024` |
| `SC-X04` | [Release gate register](./release-gates.md)                | Every gate with owner, evidence, status         | Complete, gates open              |
| `SC-X05` | [Integration contracts](./integration-contracts/README.md) | Eight external capability contracts             | Complete for MVP scope            |
| `SC-X06` | [Runbooks](./runbooks/README.md)                           | Nine operational procedures                     | Skeletons with explicit `TODO`s   |
| `SC-X07` | This matrix                                                | Requirement-to-artefact traceability            | Complete, statuses current        |
| `SC-X08` | [Approval record](./approval-record.md)                    | Dated authorization and unsupplied approvals    | `AR-001` recorded (`RG-001`)      |

## 7. Deliberately absent

These are standing non-goals (plan §2.3) and must have **no** coverage rows, no code, and no
tests until a dated plan change promotes them: picking, packing, shipping, POD, reservations,
waves, route optimization, manufacturing orders, BOM, WIP, machine telemetry, returns, CAPA,
statistical AQL, true offline execution, native mobile, RFID, NFC, MHE/AS-RS integration,
serial UI workflows, multi-currency, in-product billing, 3PL storage billing, live ERP sync,
and 3D visualization.

## 8. Updating this matrix

1. Change `Status` and add links to the artefacts that now exist. Never renumber IDs.
2. Add a row when a new plan requirement is promoted; do not silently widen an existing row.
3. When a row reaches `Verified`, link the evidence in the
   [release gate register](./release-gates.md) too.
4. If a status would be optimistic, choose the lower one. This document's only value is that
   it can be trusted.
