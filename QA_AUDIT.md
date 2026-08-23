# Authenticated application QA audit

Focused UI/UX follow-up: [`UI_UX_IMPROVEMENT_BACKLOG.md`](./UI_UX_IMPROVEMENT_BACKLOG.md)

Date: 2026-08-23

Environment: local Next.js at `http://localhost:3000`, Convex development deployment, Clerk development identity

Test context: organization **Test account**, warehouse **QA-MAIN · QA Main Warehouse**

## Follow-up implementation audit

Waves 1 and 2 from the linked implementation plan were completed on 2026-08-23. The findings below describe the original browser pass; use this disposition when reading them:

| Original finding                                                                               | Follow-up result                                                                                                             |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Contradictory Dashboard system state                                                           | Fixed and regression-tested. Operational Dashboard no longer renders setup or release-status prose.                          |
| Workspace auth race                                                                            | Fixed and regression-tested. The tenant query is skipped while auth is loading or signed out.                                |
| Wrong multi-query denial/error attribution                                                     | Fixed and regression-tested across Fulfillment, Production, and Transfers.                                                   |
| Permission-blind navigation                                                                    | Fixed with bounded server-resolved grants, fail-closed shell behavior, composite route policies, and desktop/handheld tests. |
| Missing Production route and repeated icons                                                    | Fixed in the desktop shell.                                                                                                  |
| Reports lose all content on one failed query                                                   | Fixed. Exception, stock, and movement outcomes render independently; tabs pass keyboard and axe tests.                       |
| Developer language / browser-default dates / selected raw statuses                             | Fixed in the audited Wave 2 surfaces.                                                                                        |
| Internal identifiers, import UX, engineering decomposition, offline/physical/provider evidence | Still open and retained in the feature table below.                                                                          |

Post-change verification: **2,892/2,892 Vitest**, **82/82 accessibility**, **550/550 integration**, **74/74 desktop/handheld E2E**, TypeScript, ESLint, Prettier, tenant-boundary/workflow/native-select guards, and production build all pass. The live in-app browser was signed out after the build refresh, so this follow-up does not claim a second authenticated screenshot pass.

## Scope and limits

- Opened all 28 desktop navigation destinations.
- Opened the handheld launcher and all 12 linked handheld workflows at a 390 × 844 viewport.
- Checked the English and Thai handheld launchers.
- Captured 44 screenshots in [`qa-screenshots/`](./qa-screenshots/).
- Inspected visible states, controls, empty states, permission failures, responsive geometry, and browser console errors.
- Did not submit forms or create/change tenant data. This was a read-only audit, so transactional success paths still need a seeded role-specific E2E fixture.
- Several modules are not authorized for the current test role. Those screens were verified only through their access-denied boundary.

## Automated checks

| Check                          | Result                         | Interpretation                                                                                                   |
| ------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Auth/configless browser suite  | **74/74 passed**               | Signed-out redirects, locale routing, and security headers are green. It does not cover authenticated workflows. |
| Accessibility project          | **82/82 passed**               | The current component-level axe and accessibility checks are green.                                              |
| Full Vitest run                | **2,857 passed, 10 timed out** | Nine unrelated files timed out together under the full parallel run.                                             |
| Serial rerun of affected tests | **137/137 passed**             | No assertion reproduced; the full run has a resource-contention/flakiness problem.                               |
| Production build               | **Passed**                     | Completed as part of `pnpm test:e2e`.                                                                            |

## Highest-priority findings

### P1 — Authenticated deep links race Clerk/Convex readiness

Direct page loads intermittently call `workspace/current` before a verified token is available. The server returns `TENANT_CONTEXT_DENIED / ANONYMOUS`, and the UI says the signed-in user has no active organization. Reloading later recovers the real **Test account / QA-MAIN** context. This reproduced on desktop Items and on handheld My Work and Receive.

Improve by keeping the shell in an explicit **Signing you in / restoring workspace** state until Clerk is loaded and Convex has received the token; retry workspace resolution when auth changes. Map `ANONYMOUS` separately from `NO_ACTIVE_ORG`. Add authenticated deep-link and hard-refresh E2E coverage.

Evidence: [`auth-race-organization-access.png`](./qa-screenshots/auth-race-organization-access.png)

### P1 — Navigation exposes work the current role cannot use

Fulfillment, Transport, Transfers, Stock Counts, HR, Integration Health, Devices, and most advanced handheld work end in generic **Access denied** screens. Fulfillment renders six separate denial panels and six request references.

Improve by making navigation permission-aware. Hide truly irrelevant modules; show disabled entries with the missing permission/role when discoverability matters. At page level, collapse multiple denied queries into one actionable authorization state and provide a path to request access.

### P1 — Internal database identifiers leak into operator workflows

Customer-order cards display internal customer order IDs. Factory Packets asks users for a production-site/warehouse ID and customer-order-line ID and displays factory packet IDs. Opening Stock asks for an Adjustment reason ID. Other advanced forms use the same pattern.

Improve by replacing IDs with bounded selectors, typeahead search, task context, barcode/QR scanning, and human-readable references. Keep immutable IDs available only in a copyable troubleshooting/details panel.

Evidence: [`08-sales--orders.png`](./qa-screenshots/08-sales--orders.png), [`10-production--packets.png`](./qa-screenshots/10-production--packets.png), [`22-inventory--opening-stock.png`](./qa-screenshots/22-inventory--opening-stock.png)

### P1 — Runtime status contradicts the working environment

The Dashboard's **System state** says Convex and the identity provider are not configured, while authenticated Convex data, the organization, and the warehouse are visibly working.

Improve by deriving status from actual provider/runtime readiness, or remove setup guidance from the normal authenticated dashboard. Never present copy instructing a working tenant to edit `.env.local`.

### P2 — The full test command is not stable under parallel load

`pnpm test` produced ten 5-second timeouts across unrelated UI/property tests; all affected tests passed serially. This is likely worker/resource contention, but it makes the primary verification command non-deterministic.

Improve by profiling worker count and axe concurrency, limiting heavy projects, preventing overlapping axe runs, and separating property/a11y pools where necessary. The default command should be reliably green on the supported developer machine.

### P2 — Production execution exists but is missing from desktop navigation

`/en/production/orders` is built and appears in the production build route map, but the Order-to-Ship navigation only exposes Factory Packets.

Improve by adding **Production orders / Production execution** to the correct navigation group and including it in authenticated route coverage.

### P2 — Thai localization has a visible accessibility leak

The Thai launcher correctly sets `lang="th"` and translates its task content, but the account menu retains the English accessible name **Open user menu**.

Improve by localizing shell-level accessible names and adding catalogue/DOM tests for non-visible labels, not only visible strings.

Evidence: [`43-handheld-launcher-thai-mobile.png`](./qa-screenshots/43-handheld-launcher-thai-mobile.png)

## Feature-by-feature improvements

| Feature                      | What worked / observed                                                                  | Improve next                                                                                                                                                        | Missing or blocked                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Shell, auth, tenant context  | Locale routes, skip link, organization/warehouse context, and responsive shells render. | Fix auth-token race; distinguish loading, anonymous, no membership, and denied permission; localize the account-menu label.                                         | Signed-in deep-link E2E and role-switch/multi-warehouse E2E.                                                                           |
| Dashboard                    | Counters, occupancy bands/grid, and workflow entry points load for QA-MAIN.             | Remove contradictory setup status; show last refresh/connection state once; prioritize exceptions and next work over explanatory copy.                              | Historical trends, cross-warehouse overview, actionable exception drill-down.                                                          |
| Items                        | Create form clearly explains immutable SKU/base UOM and disabled serial tracking.       | Remove “Read-only” while an Add form is present; add search/filter, UOM preview, barcode shortcut, and item-detail navigation.                                      | Serial receiving, stronger uniqueness enforcement, real GS1 capture.                                                                   |
| Suppliers                    | Simple empty state and add form are understandable.                                     | Add search, contacts, lead times, compliance status, supplier item codes, and duplicate detection.                                                                  | Supplier-label corpus and real supplier integration.                                                                                   |
| Storage classes              | Clear organization-wide meaning.                                                        | Show locations/items using each class and block unsafe deactivation.                                                                                                | Hazard/compatibility rules and policy validation.                                                                                      |
| Label templates              | Versioning and maker-checker intent are clear.                                          | Add syntax validation, variable browser, visual/ZPL preview, sample-data test print, diff, and approval history.                                                    | Printer transport, physical Thai/English print validation, scannability evidence.                                                      |
| Locations                    | QA-MAIN location loads and create/deactivate controls are clear.                        | Add search/filter, occupancy/use links, QR label action, bulk import, and safe deactivation impact preview.                                                         | Database-level uniqueness and physical location-label proof.                                                                           |
| Storage building planner     | Existing building summary gives dimensions, floor count, and usable area.               | Add a guided first-run/editor CTA, clear draft/review/active states, validation summary, and direct link from occupancy/location records.                           | Target-device performance, multi-user conflict handling, operational commissioning evidence.                                           |
| Customer orders              | Draft/released/cancelled lanes and the three-step flow are understandable.              | Remove internal IDs; make the static lanes clearly non-draggable; add search/filter, due/priority/owner signals, and customer selector.                             | Automatic downstream demand resumption and complete new-design path evidence.                                                          |
| Engineering                  | Rich master-card workflow and independent release model are present.                    | Split the very long form into progressive sections with completeness, save state, sticky actions, error summary, and selector-based references.                     | File-level revision diff, waiting-order impact, first-article/customer approval, controlled repin/replan.                              |
| Factory packets / production | Released snapshots and packet context are visible.                                      | Remove raw IDs; add a discoverable Production navigation item, packet preview/print layout, scan-to-open, and clear acknowledgement ownership.                      | Physical packet/tag printing, capacity planning, shortages-to-purchasing, returns/reversals, multi-lot and partial-close UX.           |
| Fulfillment                  | Route and page boundary exist.                                                          | Collapse six denial cards into one permission state; once authorized, keep one next legal action per stage and expose exception ownership.                          | Authorized QA fixture, physical printing, recovery/retention/load proof.                                                               |
| Transport                    | Route and independent transport boundary exist.                                         | Provide one authorization state; surface trip/vehicle/search filters and offline/manual recovery before operational rollout.                                        | Real carrier/provider adapters, target-device/load/deployment proof.                                                                   |
| Transfers                    | Explicit in-transit model exists.                                                       | Replace generic denial with permission guidance; show source/destination queues and discrepancy SLA once authorized.                                                | Return/resolution, aging/SLA, replenishment and external proof.                                                                        |
| Purchase orders              | Empty state correctly points to missing supplier prerequisite.                          | Offer an inline “Add supplier” link/action, templates, order search, draft saving, and clearer warehouse persistence.                                               | Scheduled/import automation and broader supplier connectivity.                                                                         |
| Purchase-order import        | Parse-before-write and idempotent chunks are well explained.                            | Replace pasted CSV with file picker, drag/drop, mapping, per-row errors, download template, resumable progress, and retry controls.                                 | Scheduled/background runner and large-file evidence.                                                                                   |
| Inbound board                | Four controlled stages are clearly explained and empty states are consistent.           | Add counts/SLA/owner filters and deep links to create prerequisites; avoid repeating identical empty-state copy four times.                                         | Full GS1 item+lot+expiry capture, LPN resolution, camera adapter, QC photo evidence, policy entry points.                              |
| Receiving                    | Empty-state prerequisites are precise: no PO and no reason code.                        | Add direct links to create the prerequisite records, scanner focus/terminator feedback, recent scans, undo/reversal guidance, and progress.                         | Camera scanning, GS1 combined capture, real label/printer loop.                                                                        |
| Quality                      | Queue, disposition, and second-person approval boundaries are explicit.                 | Reduce desktop-style stacked panels on handheld; present one dominant action, sampling evidence, photo/attachment state, and approver availability.                 | QC photo adapter and physical/device workflow proof.                                                                                   |
| Putaway                      | Recommendation reasoning and task selection boundary are clear.                         | Add a scan-first claim/confirm loop, route/aisle ordering, capacity visualization, override reason clarity, and offline recovery.                                   | Persistent offline intent queue and device/scanner proof.                                                                              |
| Balances/history             | Read-only and append-only semantics are clear; empty states are honest.                 | Add URL-addressable filters, SKU/location/lot search, export from current filter, running balance, and record deep links.                                           | Historical as-of reconstruction and scalable full aggregation.                                                                         |
| Opening stock                | Maker-checker/append-only purpose is clear.                                             | Replace file name/hash/row text forms and reason ID with a real file upload, mapping, validation table, selectors, error export, and approval timeline.             | Real file import, target-load/device proof, deployed reconciliation evidence.                                                          |
| Stock counts                 | Plan scope, visibility, movement policy, and thresholds are modeled.                    | Do not show the builder before its prerequisite/permission queries succeed; replace raw thresholds with units/examples and add count-plan templates.                | Authorized fixture, physical-count device proof, stable reconciliation evidence.                                                       |
| Reports/exports              | Export limits and unsigned-download behavior are explained honestly.                    | Allow each report tab to fail independently; use proper tab/tabpanel keyboard semantics; persist filters in URL; show job progress and retry/resume.                | Signed URLs, historical as-of/running balance, full exception coverage, scalable aggregation.                                          |
| HR                           | Route and privacy-focused intent exist.                                                 | Replace generic denial with role guidance; separate worker self-service from supervisor administration.                                                             | Employee/team admin, shifts/policies, overtime, accruals, medical evidence, closed periods, payroll views, kiosk/offline/device proof. |
| Integration health           | Recovery intent and first-party availability are described.                             | Replace generic denial; show adapter ownership, last success, backlog age, retry/dead-letter actions, runbook links, and safe manual fallback.                      | Real provider adapter, worker identity, credential vault, recovery/load/deployment proof.                                              |
| Handheld launcher            | 12 linked tasks fit the mobile viewport and use large full-width targets.               | Prioritize by assigned work/urgency rather than a static list; show counts, offline state, last sync, and scanner readiness; keep one dominant action per workflow. | Pallet task is unavailable; several linked modules are permission-blocked; many boards still reuse desktop composition.                |
| Devices                      | Registration form explains binding and private correlation ID.                          | Hide registration from unauthorized roles, add device health/last sync/app version/capabilities, revoke/rebind flow, and QR-assisted setup.                         | Fleet management, kiosk policy, remote diagnostics, scanner/printer capability proof.                                                  |

## Declared product gaps that remain important

- No physical printer transport or verified printed/scannable labels.
- No short-lived signed download links for exports.
- No scheduled/background runner; bounded jobs require manual advancement.
- No complete GS1 capture path carrying item, lot, and expiry together.
- No production PWA/offline reference cache or persistent intent queue/drainer.
- No complete LPN resolution/never-reuse guarantee and no supplier-label corpus.
- Denied reads are not audit events.
- Threshold/maker-checker policy values are not tenant-managed.
- Contract-based uniqueness is not backed by database constraints.
- Reporting lacks historical as-of reconstruction, running balances, complete exception coverage, and deep links.
- Fulfillment, transport, transfers, production, HR, and integrations still lack important physical/deployed/provider evidence even where UI and domain slices exist.

## Screenshot index

All screenshots are in [`qa-screenshots/`](./qa-screenshots/). Key captures:

- [`01-dashboard-desktop.png`](./qa-screenshots/01-dashboard-desktop.png)
- [`08-sales--orders.png`](./qa-screenshots/08-sales--orders.png)
- [`09-engineering--designs.png`](./qa-screenshots/09-engineering--designs.png)
- [`17-receiving.png`](./qa-screenshots/17-receiving.png)
- [`23-inventory--counts.png`](./qa-screenshots/23-inventory--counts.png)
- [`30-handheld-launcher-mobile.png`](./qa-screenshots/30-handheld-launcher-mobile.png)
- [`34-handheld-quality-mobile.png`](./qa-screenshots/34-handheld-quality-mobile.png)
- [`43-handheld-launcher-thai-mobile.png`](./qa-screenshots/43-handheld-launcher-thai-mobile.png)
- [`auth-race-organization-access.png`](./qa-screenshots/auth-race-organization-access.png)

## Recommended delivery order

1. Fix auth/workspace deep-link readiness and add authenticated hard-refresh coverage.
2. Make navigation and page states permission-aware.
3. Remove internal IDs from every user-facing workflow.
4. Fix Dashboard runtime status and stabilize `pnpm test` under the default parallel configuration.
5. Add production navigation and improve long-form/handheld task composition.
6. Build seeded role-based authenticated E2E journeys for inbound, inventory count, order-to-ship, and operator work.
7. Close physical/integration gates: scanner, printer, offline persistence, signed files, scheduler, and provider adapters.
