# UI/UX improvement backlog

Date: 2026-08-23

Scope: authenticated desktop and handheld application

Related evidence: [`QA_AUDIT.md`](./QA_AUDIT.md) and [`qa-screenshots/`](./qa-screenshots/)

Execution sequencing: [`UX_IMPLEMENTATION_PLAN.md`](./UX_IMPLEMENTATION_PLAN.md)

## Implementation status

Waves 1 and 2 are implemented and green as of 2026-08-23. The original findings below remain as the audit record; current disposition is:

| Finding                                                                                    | Status                                                                                                           |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Dashboard system/release diagnostics                                                       | Resolved: removed from the authenticated Dashboard; setup remediation renders only when a dependency is missing. |
| Auth bootstrap false denial                                                                | Resolved at the provider seam: tenant queries are skipped until Convex auth is settled and authenticated.        |
| Multi-query request attribution                                                            | Resolved for Fulfillment, Production, and Transfers with query-specific regression tests.                        |
| Permission-blind navigation                                                                | Resolved for desktop and handheld using a bounded server-owned grant snapshot and fail-closed rendering.         |
| Missing Production navigation / repeated fallback icons                                    | Resolved.                                                                                                        |
| Report tab semantics and all-or-nothing reads                                              | Resolved with independent outcomes and keyboard-correct tabs.                                                    |
| Browser-default dates and selected raw statuses                                            | Resolved in Production, Order-to-Ship, Fulfillment, and Transfers through shared/localized formatters.           |
| Internal IDs, real file imports, engineering decomposition, offline/hardware/provider work | Open; scheduled for Waves 3–4.                                                                                   |
| Thai Clerk account-menu accessible name                                                    | Open; this label is owned by the external identity widget and needs a supported localization seam.               |
| Authenticated role-switch/deep-link E2E                                                    | Open; current automated browser suite covers signed-out gates, locale routing, headers, and production routes.   |

## Decision for the commented Dashboard section

### P1 — Remove **System state** from the normal authenticated Dashboard

The selected section should not display in its current location or form.

What is wrong:

- It tells a warehouse user that external services are not configured while the same page is successfully reading authenticated Convex data for **Test account / QA-MAIN**.
- Both badges say **configured**, but their body text always uses the missing-service instructions. The component chooses a ready-specific title but unconditionally renders `convexBody` and `identityBody`, which are the “set this environment variable” messages.
- It exposes implementation names and development instructions—Convex, Clerk, `NEXT_PUBLIC_*`, `.env.example`, and `.env.local`—inside an operational product.
- The repository’s own Dashboard comment says setup is checked rarely; that is an argument for moving it out of the supervisor’s daily work surface.

Recommended behavior:

1. Do not render this section for a configured, authenticated tenant.
2. Keep the detailed checklist on `/setup` or an administrator-only **Diagnostics** screen.
3. If a required dependency is actually unavailable, gate the application before the operational shell and show one focused recovery screen.
4. If a small status affordance is still desired, show a compact **All systems connected** indicator linking to diagnostics—no environment-variable instructions.
5. Make configured rows use ready-specific body copy or omit their body entirely.

Suggested configured copy, if retained:

> All required services are connected. View diagnostics.

Acceptance criteria:

- A configured authenticated Dashboard contains no `NEXT_PUBLIC_*`, `.env*`, Convex setup, Clerk setup, or “no sign-in bypass” copy.
- A green status can never be paired with missing-configuration instructions.
- An unconfigured deployment sends the user to one localized setup/recovery surface.
- This behavior has tests for fully configured, backend missing, identity missing, and both missing.

Evidence:

- Screenshot: [`01-dashboard-desktop.png`](./qa-screenshots/01-dashboard-desktop.png)
- Dashboard mounts setup diagnostics unconditionally: [`src/app/[locale]/(desktop)/dashboard/page.tsx`](<./src/app/[locale]/(desktop)/dashboard/page.tsx#L198>)
- Ready titles use static missing-service bodies: [`src/components/system/SetupChecklist.tsx`](./src/components/system/SetupChecklist.tsx#L37)
- The exposed setup copy: [`messages/en.json`](./messages/en.json#L347)

## Other confirmed improvements

| Priority | Area                        | Finding                                                                                                                                                                                                                  | Recommended change                                                                                                                                                                                                                |
| -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Dashboard                   | **What works today** is release/status documentation, not a warehouse decision or action. It repeats capabilities already visible in navigation.                                                                         | Remove it from the daily Dashboard. Put release notes/capability documentation under Help or an administrator page.                                                                                                               |
| P1       | Dashboard                   | **Start work** mostly duplicates the sidebar with verbose sentences and no workload signal.                                                                                                                              | Replace it with prioritized work queues: task name, waiting count, oldest age/SLA, and one short action such as **Open receiving**. Hide actions the current role cannot use.                                                     |
| P2       | Dashboard                   | At 1,859 px in the captured desktop state, the page is long largely because setup/release copy and duplicated navigation follow the operational content.                                                                 | Keep the first screen focused on exceptions, queue counts, occupancy, and the next action. Move secondary material away from the Dashboard.                                                                                       |
| P2       | Dashboard counters          | Every zero repeats **No activity recorded yet**; volume tiles also repeat **Total since this site was created**.                                                                                                         | State the time basis once per group. Render a clean `0` or em dash and one group-level explanation. Make tiles clickable to the filtered work queue.                                                                              |
| P2       | Dashboard occupancy         | The map explains implementation/encoding details before providing an operational conclusion.                                                                                                                             | Lead with actionable summaries such as **1 empty location · 0 near capacity**. Make cells open location details and add zone/aisle filters.                                                                                       |
| P1       | Authentication              | Hard-refreshing authenticated routes intermittently calls Convex before the Clerk token is ready. The UI then incorrectly says the user has no active organization. It reproduced again during this review.              | Hold the workspace query behind explicit auth readiness, retry it when the token arrives, and distinguish **restoring session**, **signed out**, **no membership**, and **permission denied**. Add authenticated deep-link tests. |
| P1       | Permissions/navigation      | The sidebar and handheld launcher expose modules that the current role cannot query. Users land on generic denial screens; Fulfillment can show several separate denials on one page.                                    | Make navigation permission-aware. Hide irrelevant modules or disable them with a clear missing-role explanation. Collapse page-level authorization failures into one actionable state.                                            |
| P1       | Multi-query error accuracy  | Fulfillment, Production, and Transfers can collapse several query outcomes into **Access denied** while displaying the request reference from a different query. This makes support evidence unreliable.                 | Preserve each query's actual loading/denied/domain/error state. Show one page-level summary and the reference belonging to the request that actually failed.                                                                      |
| P1       | User references             | Many workflows display or request opaque database IDs: customer record/order/line, design request, user, master-card revision, factory packet, warehouse, material requirement, lot, receipt, and adjustment reason IDs. | Replace IDs with bounded selectors, typeahead, scan/QR input, or inherited task context. Keep the ID only in an expandable troubleshooting panel with a copy action.                                                              |
| P1       | Developer language          | Master-data screens say **idempotency key**; import copy explains how a file reference forms the key; reports mention file-storage providers and permission-checked reads.                                               | Translate architecture into user outcomes: **Safe to retry—duplicates will not be created**, **Choose a unique import reference**, and **Downloads are available only in this browser session**.                                  |
| P2       | Request references          | Denial text leads with server behavior and a long reference, but does not say which permission is missing or what the user can do.                                                                                       | Lead with the user outcome and recovery path. Put the request reference under **Technical details** with a copy button. Do not expose whether a protected record exists.                                                          |
| P1       | Production navigation       | `/production/orders` is a real built route but is absent from the desktop Order-to-Ship navigation.                                                                                                                      | Add **Production execution** in the workflow order, or link it prominently from Factory Packets. Include it in navigation and authenticated route tests.                                                                          |
| P2       | Navigation icons            | Many newer desktop routes fall back to the same Boxes icon, so the collapsed rail does not visually distinguish Fulfillment, Transport, Transfers, and other modules.                                                    | Assign a distinct, domain-appropriate icon to every primary destination and test the collapsed rail at common widths.                                                                                                             |
| P1       | Engineering                 | The Engineering screen contains roughly 70 controls and produced a 3,541 px capture. The primary queue and a release-ready master-card form compete on one page.                                                         | Separate queue, request detail, master-card editor, files, calculation evidence, and release review into steps/routes. Add completeness, autosave status, sticky actions, and error summary.                                      |
| P1       | Engineering structured data | Paper, route, material, quality, and calculation “rows” are entered as pipe-delimited textarea lines. Client-created calculation data also supplies placeholder verification values.                                     | Use repeatable structured rows, lookups, per-field/per-row validation, import preview, and server-owned verification evidence. Do not ask engineers to learn a delimiter format.                                                  |
| P2       | Order-to-Ship pages         | Customer Orders, Engineering, and Factory Packets repeat the large three-step **How work moves** explainer. It consumes substantial space on every visit.                                                                | Show the explainer only for onboarding or collapse it into a compact progress breadcrumb. Use the saved space for current work, ownership, priority, and due state.                                                               |
| P2       | Customer orders             | The Draft/Released/Cancelled layout visually resembles a draggable Kanban, but state changes are controlled and not drag-driven. Cards also expose internal IDs.                                                         | Either implement supported drag actions with confirmation or use clearly non-draggable grouped lists. Remove internal IDs and show customer, requested date, owner, and next action.                                              |
| P2       | Master data                 | Items and Locations describe themselves as **Read-only** while the same screen contains create/deactivate controls. Every screen repeats an audit/idempotency notice.                                                    | Use precise copy such as **Balances and posted fields cannot be edited**. Put audit information in Help or a concise shared footer, not at the top of every register.                                                             |
| P2       | Master-data empty states    | Organization-wide Items, Suppliers, Storage Classes, and Label Templates use the warehouse-specific message **The selected warehouse has no rows yet**.                                                                  | Make empty copy scope-aware and feature-specific, for example **No suppliers have been added to this organization**, with the relevant create action.                                                                             |
| P1       | Label templates             | The screen offers template creation while stating that nothing is rendered or connected to a printer. Users can save content they cannot validate.                                                                       | Add syntax validation, supported variables, sample-data preview, version diff, approval history, and test print. Until then, restrict it to clearly marked draft administration.                                                  |
| P1       | Purchase-order import       | **Import purchase orders** is a file-shaped feature implemented as a file-reference textbox plus pasted CSV contents. Its main hint discusses idempotency mechanics.                                                     | Provide file picker/drag-and-drop, template download, column mapping, preview table, row-level errors, progress, retry/resume, and error-file download.                                                                           |
| P1       | Opening stock               | The user manually types file name, SHA-256, row text, and **Adjustment reason ID**. This is not a usable or safe file-import workflow.                                                                                   | Upload the file, calculate its hash automatically, validate rows in a table, select a reason by code/name, and show submission/approval/posting history.                                                                          |
| P2       | Reports/exports             | The signed-link warning explains missing infrastructure rather than the practical restriction. Report sections also fail as a group when a source is denied.                                                             | Say **Downloads are available only in this session and cannot be shared as links**. Let each tab load/fail independently, preserve filters in the URL, and show export progress/retry.                                            |
| P2       | Report tabs                 | Report buttons use `role="tab"` without a complete roving-tabindex and `tabpanel` relationship. Component-level axe passing does not prove expected arrow-key behavior.                                                  | Implement the full ARIA tabs pattern or use ordinary links/buttons. Test Arrow Left/Right, Home/End, focus state, and panel association.                                                                                          |
| P2       | Empty states                | Several pages repeat **No data — the selected warehouse has no rows yet** without the prerequisite or next action. The four inbound columns repeat the same message.                                                     | Use domain-specific empty states with a CTA: **No purchase orders—create one**, **No inspections waiting**, **No putaway tasks ready**. Do not repeat identical help four times.                                                  |
| P2       | Loading states              | Direct route review frequently showed generic **Loading — Reading from the server** for several seconds, with no skeleton or preserved context.                                                                          | Use stable page shells and content-shaped skeletons. Preserve the last successful data during refresh and distinguish initial load from background refresh.                                                                       |
| P1       | Handheld launcher           | The launcher is a static list of 12 tasks plus an unavailable pallet item; several linked tasks are denied for this role. It does not communicate assignments, urgency, offline state, or scanner readiness.             | Prioritize **My work**, then authorized tasks with waiting counts. Show offline/last-sync/scanner status. Hide or explain unauthorized and unavailable tasks.                                                                     |
| P1       | Handheld workflows          | Several handheld pages reuse multi-panel desktop composition even though the product promise is **One screen, one task**.                                                                                                | Give each route one dominant action, large glove-friendly targets, scan focus/status, explicit manual fallback, and a short recovery path. Validate on target Android hardware.                                                   |
| P1       | Handheld pick/scan          | Pick evidence still asks for minor-unit quantities and text location evidence, while camera scanning is explicitly unavailable. One empty/error message is hard-coded in English.                                        | Make picking scan-first with human UOM quantities, location/package validation, translated recovery copy, and a clear HID/manual fallback. Do not expose minor-unit storage representation.                                       |
| P1       | Physical validation         | Local browser coverage cannot prove scanner terminators/focus, weak Wi-Fi recovery, gloves, harsh lighting, Thai label glyphs, printing, or label rescanning.                                                            | Add a target-device test matrix and pilot evidence for supported Android hardware, scanners, printers, media, lighting, and degraded connectivity before rollout.                                                                 |
| P2       | Thai accessibility          | Visible Thai launcher copy is localized and `lang="th"` is correct, but the account-menu accessible name remains **Open user menu**.                                                                                     | Localize shell-level ARIA labels and add DOM-level translation tests for accessible names, not only visible catalogue text.                                                                                                       |
| P2       | Thai workflow status        | Fulfillment and Transfers render raw workflow enum codes in badges, choices, and cards.                                                                                                                                  | Add localized status catalogues and reserve raw codes for expandable troubleshooting details.                                                                                                                                     |
| P2       | Dates and numbers           | Production and Factory Packets use browser-default `toLocaleDateString`/`toLocaleString`, bypassing the application's locale, calendar, and warehouse timezone formatter.                                                | Route all operational dates, times, and counts through the shared application formatters and add Thai/Bangkok boundary tests.                                                                                                     |
| P2       | Test reliability            | The full parallel Vitest run timed out in ten unrelated tests; all 137 affected tests passed serially.                                                                                                                   | Tune worker/project concurrency, isolate axe runs, and make `pnpm test` reliably green under the documented local hardware profile.                                                                                               |

## Recommended replacement copy

### Master-data safety notice

Current:

> Every create and edit is authorized on the server. Each request carries an idempotency key and is written to the audit trail.

Replace with:

> Changes are recorded in the audit history. Retrying a failed save will not create a duplicate.

### Generic permission denial

Current:

> Access denied. The server refused this request. Request reference: …

Replace with:

> You do not have permission to use Fulfillment. Ask an organization administrator for access.
>
> Technical reference: … [Copy]

### Export delivery limitation

Current:

> Short-lived signed download links need a file-storage provider that is not configured yet…

Replace with:

> Download files from this browser session. They cannot currently be shared as links.

### Purchase-order import

Current:

> File reference — Half of every row's idempotency key…

Replace with:

> Choose a CSV file. You can review and fix errors before anything is imported.

## Delivery order

1. Remove/fix the Dashboard setup block and remove **What works today**.
2. Fix authenticated deep-link readiness and permission-aware navigation.
3. Remove typed/displayed internal IDs from operational workflows.
4. Replace developer language with task-oriented copy.
5. Break up Engineering and other long forms; compact repeated workflow explainers.
6. Build real import/upload, label-preview, reporting, and handheld task experiences.
7. Stabilize the full verification command and add role-based authenticated E2E journeys.

## Evidence index

- Dashboard: [`qa-screenshots/01-dashboard-desktop.png`](./qa-screenshots/01-dashboard-desktop.png)
- Auth race: [`qa-screenshots/auth-race-organization-access.png`](./qa-screenshots/auth-race-organization-access.png)
- Customer orders: [`qa-screenshots/08-sales--orders.png`](./qa-screenshots/08-sales--orders.png)
- Engineering: [`qa-screenshots/09-engineering--designs.png`](./qa-screenshots/09-engineering--designs.png)
- Factory packets: [`qa-screenshots/10-production--packets.png`](./qa-screenshots/10-production--packets.png)
- Purchase import: [`qa-screenshots/16-purchasing--import.png`](./qa-screenshots/16-purchasing--import.png)
- Opening stock: [`qa-screenshots/22-inventory--opening-stock.png`](./qa-screenshots/22-inventory--opening-stock.png)
- Reports: [`qa-screenshots/24-reports.png`](./qa-screenshots/24-reports.png)
- Mobile launcher: [`qa-screenshots/30-handheld-launcher-mobile.png`](./qa-screenshots/30-handheld-launcher-mobile.png)
- Thai launcher: [`qa-screenshots/43-handheld-launcher-thai-mobile.png`](./qa-screenshots/43-handheld-launcher-thai-mobile.png)

Additional source evidence:

- Multi-query error attribution: [`src/features/fulfillment/FulfillmentBoard.tsx`](./src/features/fulfillment/FulfillmentBoard.tsx#L121), [`src/features/production/ProductionBoard.tsx`](./src/features/production/ProductionBoard.tsx#L76), [`src/features/transfers/TransferBoard.tsx`](./src/features/transfers/TransferBoard.tsx#L70)
- Engineering delimiter editor and placeholder verification: [`src/features/orderToShip/MasterCardDraftForm.tsx`](./src/features/orderToShip/MasterCardDraftForm.tsx#L93)
- Production route omitted from desktop navigation: [`src/lib/navigation.ts`](./src/lib/navigation.ts#L42)
- Organization-scoped empty-state mismatch: [`src/features/masterData/MasterDataPanel.tsx`](./src/features/masterData/MasterDataPanel.tsx#L203)
- Raw workflow statuses: [`src/features/fulfillment/FulfillmentBoard.tsx`](./src/features/fulfillment/FulfillmentBoard.tsx#L193), [`src/features/transfers/TransferBoard.tsx`](./src/features/transfers/TransferBoard.tsx#L111)
- Browser-default date formatting: [`src/features/production/ProductionBoard.tsx`](./src/features/production/ProductionBoard.tsx#L531), [`src/features/orderToShip/OrderToShipWorkspace.tsx`](./src/features/orderToShip/OrderToShipWorkspace.tsx#L583)
