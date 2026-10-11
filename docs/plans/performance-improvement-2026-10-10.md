# Performance improvement plan — October 10, 2026

Improve the time it takes to finish real tasks. **When speed conflicts with UX,
choose UX.** Four Kiro CLI agents independently audited loading/shell,
interactions/scanning, warehouse backend, and HR/search. Codex checked shared
evidence and measurement readiness. See the [audit index](../reviews/performance-kiro-2026-10-10/README.md)
for the individual reports.

**User-selected priority: general loading and navigation.** Start with shared
loading costs, access/navigation readiness and route transitions. Feature-specific
interaction, HR, search and scanning work follows when it materially affects
those journeys or is the next measured bottleneck.

This is a plan, with no application implementation or deployment. Findings apply
to the current working tree, including pending HR/search work. No current
authenticated-browser latency baseline was collected. Priorities reflect verified
sources of unnecessary work, likely user reach, and regression risk; reorder
them when measurements or user workflow frequency provide stronger evidence.

## UX requirements

Every retained change must preserve:

- Accurate, current inventory, exact footprint union and collision rules, and
  both source/target holds during moves. Loading or incomplete data stays
  explicit; it never becomes an empty map or zero total.
- Complete results under the existing search, sorting, paging and filter
  contracts, including Thai/English matching, stable URL state and Back/Forward.
- Camera success rate, checksum/identity validation, duplicate prevention,
  manual entry, retake/retry and clear cancellation. Full ticket extraction still
  requires its existing review.
- Keyboard and screen-reader access, focus, responsive layouts, map camera
  position and interaction precision.
- Draft preservation, server clock authority, idempotent retries, period
  fingerprints and frozen exports. A pending write remains pending until the
  server provides a definite answer.
- Organization, warehouse and site isolation, plus prompt permission revocation.
  Server authorization remains authoritative for every operation.

## Start with a baseline

Timebox the first measurement pass to roughly half to one engineering day. Freeze
the intended working-tree state and use an isolated **production build**, fixed
fixtures, device/browser/network conditions and separate cold/warm runs. Run
measurements sequentially, with the Kiro audit processes finished.

For the first pass, prioritize cold sign-in → usable landing page, warm sidebar
navigation between storage/finished-goods/HR, direct deep links, Back/Forward,
and the first search-dialog open. Separate server auth/TTFB, JS hydration,
Convex authentication, workspace/HR grant readiness, and destination data. Track
both click-to-visible-feedback and click-to-usable-content; a skeleton is not
task readiness. Include storage-only, HR-only and mixed-role accounts.

Measure sign-in-to-usable-page, catalogue search/paging, floor open and map
interaction, camera/photo scan-to-review, HR history/period preview/export, and
global search. Record journey latency, initial transferred/executed JS, response
bytes, actual document reads and query count, long tasks and React commits.
Keep capture/upload/provider/lookup timings separate for scanning and AI.

Reuse the existing storage Profiler harness, pagination fixtures, read-count
helpers and regression suites. The isolated workspace harness does not establish
authenticated production performance. Existing Web Vitals reporting supports
only `none`/browser `console`; durable field telemetry is a follow-up, not a
prerequisite for local profiling. Add any journey events through the existing
event/dimension allowlists.

The [measurement review](../reviews/performance-kiro-2026-10-10/05-measurement-and-ux.md)
defines the fixture matrix and evidence limits. Field goals are p75 LCP ≤2.5 s,
INP ≤200 ms and CLS ≤0.1, separated by device class; lab traces support diagnosis
but do not establish these field percentiles. [Web Vitals guidance](https://web.dev/articles/vitals).

## Prioritized implementation backlog

Effort is a rough estimate for implementation and focused verification: S = up
to one day, M = one to three days, L = several patches including migration work.
These are not deadlines. Each item first gets a recorded baseline and acceptance
criteria; its timing benefit remains a hypothesis until measured.

### 1. Remove complete translation catalogues from client modules — P1 / S

**Evidence:** `FloorLocationTable.tsx:38,91` and
`BuildingAreaDetails.tsx:28,347` import `messagesFor`; `src/i18n/messages.ts`
statically imports both complete locales. This bypasses the existing
`SHELL_NAMESPACES`/`ROUTE_NAMESPACES` selection.

Use the active next-intl provider for those strings or pass the exact presentation
labels. Keep full catalogue access on the server. Check nested provider behavior
against the installed next-intl version; do not lose common messages.

**Accept when:** the two full catalogues are absent from the affected client
dependency graph, actual transfer/execution decreases, and both locales display
identical labels and accessible names. Measure route loading, not JSON source
file size. Use existing translation and storage component checks.

### 2. Replace the toggle's animation runtime only with equivalent UX — P1 / S

**Evidence:** `src/components/ui/animated-toggle.tsx:4` imports `motion/react`
for a thumb and icon transition. It is used by the theme toggle on every desktop
route and by building status. The loading audit found motion internals in an
existing shared build chunk, but that chunk also contains unrelated code.

Prototype CSS transform/opacity/shape transitions that retain the existing motion
character, touch target, switch semantics, controlled/uncontrolled behavior and
reduced-motion treatment. Compare recordings as well as static states. Keep the
current component if the substitute visibly degrades the interaction. Remove a
dependency only after confirming all application/tooling consumers.

**Accept when:** a fresh route analysis and network trace show reduced shared
loading/execution cost and toggle behavior remains equivalent across all variants,
sizes, themes, keyboard/touch use and reduced-motion settings. Reuse the toggle
and building-status tests; verify motion behavior in a real browser. Do not count
the entire historical chunk as a guaranteed saving.

### 3. Batch navigation and HR permission discovery — P1 / S–M

**Evidence:** `convex/lib/navigationGrants.ts` fetches roles serially, then does
an exact query for each permission/role pair. Both `workspace/current` and HR
access use this shared helper. HR additionally repeats small grant checks through
`heldHrPermissions`/`holds`.

Resolve active roles once and load their permission rows in bounded batches
through the existing role-prefix index, intersecting with requested codes. Reuse
facts only within a single request/transaction. Keep narrow server operation
checks, validation of foreign rows and conservative overflow handling.

**Accept when:** startup/query count and access readiness improve across members
with one/multiple roles, without losing grants or widening access. Test inactive
roles, removed grants, foreign tenant rows and request-to-request revocation.
Avoid turning small exact reads into unbounded role collections.

Profile the adjacent tenant-context chain too. Reuse already validated user,
membership and warehouse facts within the transaction; overlap independent reads
only where validation and denial precedence stay identical. This is a follow-up
to permission batching, not a persistent authorization cache. Leave request IDs
and diagnostic behavior unchanged unless traces establish a separate problem.

### 4. Reduce route dependency overlap and tune navigation from traces — P1 / M

**Evidence:** `StorageLayoutScreens.tsx` contains catalogue, building creation,
building editor, settings, isometric workspace and floor editing with shared
imports of maps, placement layers and editing UI. The sidebar already uses
`Link`, `NavigationPendingIndicator` and a desktop `loading.tsx` boundary.
General route feedback exists; do not count adding it again as an improvement.
`public/manifest.webmanifest` also still starts at `/th/dashboard`, which has no
application page. Normal sign-in defaults to storage and `HrLandingRedirect`
then sends HR-only members to HR after access settles.

First correct the installed-app launch path to a valid entry. Measure the HR-only
landing detour; use a lightweight access-aware entry if it avoids downloading a
storage screen before redirecting. Preserve explicit permitted return/deep-link
destinations, locale, no-access states and existing server authorization.

Also correct the loading presentation: `WorkspaceContextBar` currently labels
the loading state as unavailable before replacing it with a differently sized
selector. Reserve the selector's footprint and distinguish loading from settled
denial. Render the mobile search trigger with responsive CSS so hydration does
not insert a new header button. Keep actual errors and unavailable states clear.

Analyze client dependency reachability per route. Split the storage screens by
their actual route/workflow, with eager imports of the needed screen, as the
earlier product/catalogue split did. Lazy-load only costly optional features.
File size alone is not evidence of transferred bytes.

Trace default production prefetching and shared-layout reuse before changing
link behavior. Keep defaults where they help. If visible-link downloads contend
with first load, selectively defer unlikely expensive destinations and warm
them on pointer, keyboard or touch intent. If a common destination remains cold,
test narrowly targeted warming. Preserve feedback and current accessibility.
Do not enable Cache Components/Partial Prefetching as a speculative shortcut:
the installed Next version requires a separate adoption review and changes
prefetch semantics.

**Accept when:** cold loading and warm click-to-usable-content improve with no
first-use penalty, redirect loop, extra blank state or broken deep link. Compare
transferred JS/RSC, execution, prefetch traffic and access readiness. Verify
mobile menus, active route, Back/Forward, locale/account switches, navigation
guards, full page reloads and failed-request recovery. Distinguish route chunk
readiness from the subsequent Convex data wait.

For storage catalogue readiness, measure the two per-building subscriptions for
occupancy and status blocking. A single authorized response can supply both,
including revision information, while mutations retain their own authoritative
checks. Compare cold readiness and reactive fanout at realistic page sizes;
fewer subscriptions alone does not prove a faster page.

### 5. Make local search navigation immediate without stale-result mistakes — P1 / S

**Evidence:** `SearchDialog.tsx` supplies debounced text to both local destination
matching and record queries. While the current text is unsettled, all results
are disabled; a quick Enter in ordinary search mode can do nothing. The local
matcher needs no server request.

Compute local page destinations from live committed text; keep record lookups
debounced and preserve IME handling. Allow immediate Enter only when the chosen
local result is valid for the current query and cannot be displaced by a
higher-ranked pending result. For record-dependent results, flush the debounce
and keep a cancellable Enter intent keyed to that exact query/context, rather
than opening a previous record. Clear it on typing, mode/identity/scope changes,
Escape or closing. Preserve draft/pending guards and announcements.

**Accept when:** quick ⌘K → type → Enter reliably navigates to the intended page,
Thai IME never submits during composition, and late records cannot send the user
to the wrong destination. Verify keyboard focus, ranking, repeated Enter, errors,
dirty drafts and stale-result suppression. Keep immediate local matching eager
if search results are split into optional chunks. Reuse the search/focus and
Thai/English intent tests and add the quick-Enter regression.

### 6. Experiment with overlapping connection setup and auth — P1 / S, measured

**Evidence:** the installed Convex client lazily creates its socket; current
providers skip data queries until Convex authentication settles. Its public
`connectionState()` method accesses the lazy sync client. This suggests socket
setup could overlap with Clerk boot rather than follow it. It does not establish
the actual critical-path delay on the current application.

First trace Clerk readiness, socket connection, Convex authentication, grant
queries and usable page content. If connection setup contributes material delay,
test a one-time connection warmup only on a server-authorized, backend-configured
desktop route. Keep data query/auth gates and root provider lifetimes unchanged.
Evaluate an origin preconnect separately; socket reuse is browser-dependent.

The HR audit also found access → screen-query serialization in `HrGate`.
Profile it separately. Where a screen query authorizes itself and its arguments
are available, test subscribing after Convex authentication while retaining the
display gate. Resolve default date ranges on the server where necessary. Keep
denied outcomes contained, avoid premature business-data rendering, and compare
the extra requests from no-access accounts against the latency benefit.

**Accept when:** cold usable-page latency improves beyond variation without extra
connections, premature queries, reconnect loops, token-refresh/org-switch issues
or a slower sign-in/public page. Verify backend-missing, expired sessions,
offline recovery and denied accounts. If the trace shows no material delay or
the supported API lifecycle is unsuitable, discard the experiment.

### 7. Separate optional UI from first-load dependencies — P2 / S–M

**Evidence:** the shared `GlobalSearchProvider` statically imports and renders
`SearchDialog` while closed. Large storage screen modules also contain optional
details/edit/review flows. Queries already skip closed search/details, but code
can still be in the route graph.

Split measured optional client subtrees with a client-side lazy boundary. Keep
navigation, trigger handling and a stable accessible loading frame immediately
available. Consider warming on genuine user intent where needed. Follow the
installed Next guide: a dynamic Client Component imported only by a Server
Component does not currently guarantee automatic client splitting.
[Next lazy-loading guidance](https://nextjs.org/docs/app/guides/lazy-loading).

**Accept when:** first-load work decreases **and** cold first-open/⌘K/Ctrl+K
remains acceptable. Test focus trap/return, announcements, rapid open/close,
chunk-load failure/retry and dirty/pending navigation guards. Measure print/QR
readiness separately; do not make ordinary operations feel slower to improve a
bundle score.

### 8. Narrow scene subscriptions and active-move reads — P2 / L

**Evidence:** `useStorageBuilding.ts` subscribes to whole-building layout and
inventory. `getStorageBuildingInventory` loads all held/stored building placements;
`readMoveOccupancy` performs two status queries per distinct supplied pallet.
Geometry and inventory are already split and query-local product/pallet read
reuse already exists.

Introduce a lightweight building/floor selector response and selected-floor
scene reads. Keep full-building data for structural edit warnings and views that
need it. Evaluate move query count and bytes for sparse/dense workloads before
choosing a scoped batch or maintained lookup; never universally replace narrow
reads with a warehouse-wide scan. Add an index/projection only when the measured
query shape warrants it.

Also measure catalogue reloads caused by the shared warehouse generation signal
and repeated header-total scans. Separate backfill readiness from domain change
signals only after mapping every write and its effect on returned fields. Keep
current cursor reset and ordering semantics unless a separately reviewed design
preserves complete results. If header scans dominate, an exact transactional
warehouse summary is a later migration: update it atomically with the existing
ledger, provide bounded backfill/readiness handling, and measure write contention
as well as read savings. See backend audit findings F2–F3 and F7.

**Accept when:** opening/changing one floor reads and transfers less unrelated
data, and changes on unrelated floors produce less scene recomputation. Compare
responses with the current behavior for RESERVED/STORED, location-only and
unmeasured units, stacks, cross-floor moves, removal and capacity limits. Retain
exact summaries and source/target holds. Schema work needs a compatible bounded
backfill, readiness handling and old-client rollout plan.

### 9. Reduce derived scene work and preserve unchanged geometry — P2 / M

**Evidence:** `buildingInventory.ts` recreates every floor/zone/position for each
inventory update and filters a zone's placements once per position. The map and
table then derive views from those objects. Camera panning already uses an
imperative transform with a single React commit; keep that optimization.

Index placements by position once, preserve references where the underlying
geometry and presentation are unchanged, and memoize the expensive static scene
derivation at a clear boundary. Profile before memoizing inexpensive components.
Handle removals and missing inventory explicitly.

For placement dragging, coalesce pointer updates to one animation frame, skip
unchanged snapped coordinates and avoid activating an already selected item on
each event. Flush the final position and draft persistence on completion or
cancellation; scope drafts correctly and preserve keyboard precision and recovery.
Do not impose an interval that makes the pointer visibly lag. Memoize callout
placement and normalized search data only with verified stable dependencies;
retain collision geometry, ordering, tie-breaking and selected-item paint order.

**Accept when:** a one-location inventory change recomputes less unrelated work,
map/search/selection latency improves on large fixtures, and pan still commits
once for the existing 50-move regression. Verify selection, palette/theme,
2D/3D projection, camera center, keyboard actions, footprints and labels.

### 10. Replace HR date-by-date reads with bounded range work — P2 / M

**Evidence:** `convex/hr/shared.ts:388–413` reads attendance and holidays for
each date; `self.ts:391–475` reads days and correction histories sequentially;
`periods.ts` repeats live-row, version and fingerprint work. Existing employee/date,
site/date and period/version indexes provide potential range access.

Start with range reads through the tenant adapter, or bounded concurrency where
a range extension is not yet appropriate. Reuse loaded holidays/correction
facts. Separate lighter preview data from expensive frozen detail only where
UX permits. Keep close/export authoritative and transactional; a fast preview
must never weaken conflict detection or use client-calculated payroll rows.

**Accept when:** history and large period preview/export reduce query count and
completion time with identical rows, totals, ordering, fingerprints and CSV.
Test late edits, employee transfers, correction decisions, clock boundaries,
closed versions, retries and concurrent closes. Preserve bounded pilot limits
and explicit refusal on overflow.

Separate unused time reads from stable access/member metadata and closed period
views. For time-dependent views, define server-derived refresh boundaries and
refresh on those boundaries or returning to the tab; avoid constant polling or
trusting the device clock. Test midnight, shift deadlines and date-aware search.
This protects UX as well as avoiding unnecessary cache invalidations. A retained
view must be explicitly updating, non-actionable where its revision matters,
and cleared on identity, permissions or scope changes.

Period-lock lookup is another candidate: it currently reads the site's full
period history. Use a bounded indexed date lookup only after proving period
non-overlap for existing data and enforcing it for new writes. Keep lock checks
fail-closed. Version lists can use the existing period/version index directly;
lighter preview payloads must retain exact server fingerprints and audited CSV.

See [HR/search audit findings 1–3 and 8](../reviews/performance-kiro-2026-10-10/04-hr-search.md)
for the detailed dependencies and invariants.

### 11. Improve search selectivity without changing matches — P2 / M

**Evidence:** HR record search has bounded scan paths as well as exact-code
lookups; catalogue residual substring searches can need repeated bounded scans.
Global search already debounces and skips queries while closed, and AI is an
explicit mode rather than an automatic replacement for ordinary search.

Measure exact-code, common-name, sparse/no-match and Thai queries separately.
Prefer existing selective index paths; add a search projection/index only after
proving parity with substring/token semantics and permissions. Reduce repeated
authorization/presentation work and unnecessary payload fields. Retain explicit
incomplete/overflow behavior rather than returning a fast misleading result.

For location catalogue searches, evaluate batching several zones per scan step
with bounded position reads, rather than advancing one zone per client/server
round trip. Preserve cross-position substring matching and pagination completeness.
For job records, evaluate a compact search projection that excludes raw AI payloads
but reproduces every existing searchable field and hydrates the selected page.
Any projection needs transactional maintenance and explicit backfill readiness.

Catalogue text should echo immediately while URL/storage persistence settles with
the existing query debounce; flush on Enter, clear, blur and context changes,
and re-sync on Back/Forward. Retaining ready rows can reduce visual disruption
during updates, but only within the same authorized scope, with an explicit busy
state. Clear on identity/grant/scope changes and block actions that depend on a
fresh revision. This improves continuity; it does not make stale rows current.

**Accept when:** settled result time and reads improve without missing/reordered
matches, changed Thai handling or inaccessible destinations. Check rapid typing,
IME composition, account/site switches and obsolete async results. Preserve the
current AI intent evaluation set and refusal behavior.

### 12. Move heavy scan/photo processing off the interaction thread — P2 / M–L

**Evidence:** camera decoding is already imported on demand; photo resize,
canvas and decoding paths warrant per-stage mobile profiling. The separate WASM
barcode experiment is not part of production and has no held-out accuracy rate.

First test lower-risk startup and memory changes: after an explicit camera tap,
overlap decoder import with camera acquisition, show honest startup progress and
clean up both paths on failure or cancellation. For multi-photo input, queue
decode/resize work with bounded concurrency and immediate ordered placeholders.
Retain full-resolution review, existing upload/extraction behavior and retries;
do not reduce photo quality or network concurrency without evidence.

Move measured expensive pixel/decoder work into a cancellable worker with a
compatible fallback. Bound concurrency and memory; release images/camera tracks
on cancellation. Keep image resolution and decoding/review policy unless a
representative held-out corpus proves an equally reliable alternative. Identity
decoding alone cannot replace full job-ticket extraction.

**Accept when:** UI responds during processing, memory remains bounded, and
success/false-positive behavior does not worsen on new images and physical iOS/
Android devices. Verify camera permission failures, torch, mode changes, stale
results, duplicate scans, lookup refusal, manual entry and AI fallback. Preserve
progress and error recovery. Do not claim speed gains from the small historical
desktop experiment.

## Delivery order and decisions

1. Establish the baseline and record each candidate's journey, fixture, cost,
   UX checks and expected improvement.
2. Correct entry/loading states and deliver translation loading, equivalent
   toggle motion and permission batching as separate small patches. Next, split
   measured shared/route dependencies and verify navigation
   and optional first-open latency. Tune prefetch only if traces justify it.
   Run the connection-overlap experiment only when the baseline implicates it.
   Fix immediate local search navigation before splitting the search body.
3. After general loading/navigation improves, compare storage versus HR/search
   bottlenecks using usage and profiling; take
   the highest-impact measured one next. Scene derivation can precede schema
   work. Introduce one query/index/projection at a time.
4. Run scanning experiments after stage timing and a held-out/device corpus
   exist. Keep quality controls fixed while comparing responsiveness.
5. Land lightweight per-route loading budgets with the first bundle fix, based on
   the new measured baseline. Report per-chunk changes and handle diagnostic
   format changes explicitly. Add durable, nonblocking redacted telemetry after
   the first verified improvements. Rebaseline intentional changes.

For each patch, run relevant unit/integration/a11y/browser checks and compare
before/after on the same fixtures. Existing suites cover catalogue pagination,
storage occupancy and summaries, map pan/camera, scanning, HR workflows,
authorization/isolation, search and draft guards. Before delivery run the
repository-required `pnpm check`, `pnpm build` and `pnpm audit:prod`, plus affected
browser/device workflows. Roll out schema changes through the existing release
pipeline. These checks are planned, not claimed as run by this audit.

Retain a patch only when it removes a verified deterministic cost or its journey
improvement exceeds run-to-run variation, with no UX/correctness regression.
Repeated paired measurements matter more than a single score; collect enough
samples before claiming p95. A 20% hot-path improvement is a proposed experiment
target, not a guarantee or a reason to trade away UX.

Reject stale persistent inventory/permission caches, reduced scan validation,
automatic acceptance of extraction, silent truncation, delayed input echo,
removed draft guards, blanket disabled prefetching, reduced map accuracy and
broad framework rewrites. React Compiler, full table virtualization and new
decoder adoption remain evidence-gated experiments. Existing pagination,
lazy camera imports, geometry/inventory separation, document read reuse, and
prior test/module optimizations are not new work.

The query strategy follows [Convex's best practices](https://docs.convex.dev/understanding/best-practices):
keep result sets bounded and selective, and consider both read cost and reactive
invalidations. Any index change must also account for write cost and ordering.
