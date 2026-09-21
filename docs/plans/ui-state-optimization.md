# UI and state optimization rollout

This plan builds on the existing uncommitted consolidation work. Keep its storage,
history, request identity, and location selector contracts intact.

## First rollout implemented

- Migrated production feature buttons; retained native buttons in test harnesses.
- Added PageHeader `helpText` with the deprecated `description` shim, localized
  page-help controls, preserved destination locales in guarded navigation, and
  removed the unused floating-alert provider.
- Added 627 FinishedGoods copy entries per locale and migrated static consumers.
  Dynamic text and pure helper tuple APIs retain the compatibility shim. Test
  providers now use the real catalogues where migrated components require them.
- Added EmptyState icons, screen-reader-only field labels, dialog/sheet sizes,
  table empty/sort/sticky-action options, and canonical table rendering with a
  single scroll owner in DataTable and FinishedGoodsTable.
- Added generic DataGate presentation and a location-detail consumer; preserved
  product/resume denial request IDs, guarded edit actions on permission readiness,
  and keyed catalogue reset attempts to request criteria.
- Moved workspace mounting into AppProviders with both backend and identity
  configuration guards. Workspace query boundaries reset on warehouse/route
  changes and record failures through the existing observability port.

Post-migration syntax counts: feature raw buttons **12 → 3** (all three remaining
are test controls; production count is zero), feature literal bilingual calls
**807 → 173**. This is not a measured bundle-size or runtime improvement.

First-rollout verification: production build and `pnpm check` passed, including
107 files / 946 tests. The catalogue recovery regression failed against the old
`viewKey` implementation and passed after restoring `requestKey`.

## Subsequent phases implemented

- Added Panel, PageContainer, measured StickyActionBar, CheckboxControl and
  FormSelect; migrated packing, moving and scanning consumers. Fixed bars reserve
  their measured height, including changes after render and safe-area padding.
- QueryGate consumes workspace readiness once. Missing configuration, sign-in,
  loading, denied outcomes with request IDs, and missing warehouse remain distinct.
  Permission checks share `useCan`; loading compatibility UI uses LedgerPanelStatus.
- Shared catalogue synchronization handles scan continuation, criteria-keyed cursor
  recovery, and empty final pages across FinishedGoods and storage catalogues.
- Scoped async execution now supplies stable write identities to storage building,
  floor and zone commands. Failed commands retain identity for uncertain retries;
  successful commands clear it. Stale completions cannot unlock a newer scope's
  pending operation. Reserved-block entity IDs remain separate from command IDs.
- Added encoded persistence scope keys and actor-switch regressions for catalogue
  preferences and preview state. Existing draft recovery keys remain compatible.
- Consolidated QR rendering while retaining inline and dialog presentations;
  shared placement status semantics, units and inventory selectors.
- Moved all 60 FinishedGoods operational error messages into English/Thai WriteError
  catalogues and removed the legacy error tuple module. Shared error resolution
  preserves domain-specific instructions and box/storage-unit wording. Packing
  validation and FormSelect descriptions use the shared foundations.

Validation: `pnpm check` passed with **115 files / 971 tests**, and production build
passed. Follow-up async/error regressions passed (7 tests). Browser smoke checks
covered authenticated Thai storage and FinishedGoods catalogues and the scanning
screen at 390px. Switching Thai to English reached `/en/finished-goods/scan` with
“Scan Packages”; no horizontal overflow, and measured action height and reserved
padding both equalled 109px. Camera denial displayed recovery text/manual input;
actual camera hardware scanning was not tested. Bundle savings were not measured.

Remaining: broad storage/dynamic translation migration and enforcement, remaining
panel/filter/form consumers, LocationCard/PlacementList/InventorySummary UI
extraction, a unified StorageScene and drag interaction contract, the storage
screen monolith split, and complete workspace layout/test-fixture consolidation.
The ring/pie presentations are not yet a single component. These larger
migrations are not marked complete.

## Deletion-focused pass

Plan: remove unused compatibility paths and speculative exports first, eliminate
manually duplicated message-key registries, and inline the single-use legend.
Keep the shared readiness, retry-identity and layout behavior covered by tests.

Implemented: removed the unused packing error tuple helper and its forwarding
wrapper, four unused storage helpers, the unused storage facade, and the exported
area legend wrapper. Packing consumers call the canonical resolver directly.
The resolver uses the translator's catalogue lookup instead of maintaining a
second list of supported error codes; unknown codes retain domain-specific copy.

Measured against the working tree at the start of this pass (not Git HEAD):
**193 fewer production lines**, two fewer production files, **5 additional test
lines**, and no translation changes. This is a source-maintenance reduction;
it does not establish bundle-size or runtime savings.

Validation: `pnpm check` passed (typecheck, lint, 115 files / 971 tests),
production build passed, and no references to the deleted APIs remain.

## Delivery order

1. **Quick wins:** migrate ordinary native buttons, make PageHeader help copy
   explicit, remove unused pagination/toast APIs, and preserve the destination
   locale when the dirty-navigation guard resumes a link.
2. **Translation foundation:** retain `App` in nested route message scopes;
   migrate FinishedGoods text into matching English/Thai catalogues. Keep
   compatibility adapters for helpers while their consumers migrate.
3. **UI primitives:** extend EmptyState and FormField without breaking callers;
   share dialog/sheet sizes and typography; consolidate DataTable rendering and
   scroll ownership. Follow with Panel, PageContainer, StickyActionBar, status
   tone maps, and feature call-site migrations.
4. **State correctness:** preserve denied request IDs, tie cursor reset attempts
   to query criteria, wait for permission readiness, and reset error boundaries
   when route/workspace identity changes. Migrate query and mutation workflows
   separately, preserving idempotency across uncertain retries.
5. **Storage feature extraction:** extract location/QR/inventory presentation,
   placement status and units first. Then consolidate area summaries, filters,
   scene geometry and workspace layouts in individually reviewable changes.
   Preserve distinctions between placements and unique inventory units, and
   between unknown measurements and zero.
6. **Forms and enforcement:** consolidate validation/error translation and
   checkbox/select controls, migrate test wrappers, then enable narrow lint
   restrictions after the corresponding call sites have migrated.

## Small-model implementation boundaries

Use a smaller model for bounded changes with explicit file ownership. Review
semantic changes centrally: locale routing, auth readiness, cursor invalidation,
and retry identity need regression coverage. Avoid assigning several agents
overlapping screen rewrites. Run the combined checks after their edits settle.

## Baseline for this rollout

Measured from the existing working tree before this rollout's migrations:

| Metric                                                             | Count |
| ------------------------------------------------------------------ | ----: |
| Raw `<button>` in `src/features/**/*.tsx`                          |    12 |
| Raw `<button>` in `src/**/*.tsx`                                   |    27 |
| `<p role="alert">` in feature TSX (including multiline tags)       |     6 |
| Literal `tr("…")` calls in feature TSX (including multiline calls) |   807 |

Typecheck and lint passed at the start. These counts measure syntax, not
equivalent behavior or bundle savings. Domain-specific controls need semantic
review before replacement.

## Acceptance

- Both locales resolve all route messages; nested providers retain common UI
  namespaces. A dirty locale switch reaches the requested locale after discard.
- Loading, denied, missing records and backend errors remain distinguishable;
  denied outcomes retain their request IDs.
- Search/filter changes can independently recover from invalid cursors, and
  permission-dependent actions do not appear before permissions are ready.
- Tables have one horizontal scroll owner, named regions and accessible sorting;
  field hints/errors remain associated with their controls.
- Relevant interaction tests, typecheck, lint and the combined suite pass.
  Report browser verification and bundle measurements only when actually run.
- Keep larger storage-scene and persistence migrations explicitly pending until
  their consumers and regression checks are complete.
