# Codebase consolidation plan

Status: consolidation implemented for shared access/routes, operation execution, browser storage/history, location selectors, and extracted location management. Further screen decomposition can proceed incrementally through these modules.

## Objective

Reduce duplicated behavior and independent sources of truth. Reuse small interfaces over substantial implementations. Do not introduce an application-wide store for every state variable, or reduce line counts by combining unrelated workflows.

## Evidence and priorities

1. StorageLayoutScreens.tsx (~4,200 lines) combines catalogue, building settings, workspace URL handling, floor draft geometry, reserved areas, location management, mutation outcomes and inventory presentation. Extract building catalogue/settings, floor workspace/controller, floor draft, reserved-area editor and location manager into feature modules. This improves locality; extraction alone does not reduce total code. Preserve current redirects, URL intents, permissions, optimistic versions and dirty navigation handling.
2. finishedGoods/shared.tsx mixes text helpers, permission checks, draft key construction, UI, status mapping, error translation, request persistence and operation execution. Storage layouts and map code import useCanManage from this feature. Move genuinely application-wide access hooks to an authorization module, routes to navigation, persistence helpers to storage, and request execution to an operation module. Keep finished-goods status and terminology feature-owned. Backend authorization remains authoritative.
3. localStorage/sessionStorage handling is repeated in ProductScreens, PackingScreen, PalletScreens, StorageLocationCatalogue, useCatalogueState, catalogueViewState, usePreviewState and FloorMap. Introduce separate preference and draft interfaces over a shared validated storage adapter. Handle unavailable storage, malformed payloads, schema versions, identity scope and migration centrally. Preserve each existing key/default until a tested migration exists. Never treat persisted preferences and unsaved inventory drafts as interchangeable.
4. useCatalogueState, useWorkspaceQuery, ProductBatches and cursor pagination independently interact with browser history. Share a URL state adapter that preserves unrelated query parameters and history metadata, offers stable subscriptions and distinguishes push from replace. Keep feature codecs and the workspace dirty-navigation policy separate. Add back/forward, reload and guard-interaction tests before migrating this higher-risk seam.
5. FloorMap floorZoneUnitCount, FloorLocationTable unitCounts and StorageZonesPanel inventory summaries calculate related totals differently. Extract pure location-inventory selectors: unique units, stored, reserved, unmeasured, incomplete/unknown status and measured footprint. Share normalized location search over names, codes, positions, QR and unit identifiers. Keep explicit distinctions between placements and unique units and between zero and unknown. Evaluate existing storagePlacementGeometry and backend occupancy modules before introducing a new formula.
6. finished-goods useOperation already handles busy/error/request identity, while storage handlers repeat pending/message/try-finally and outcome inspection. First separate reusable execution mechanics from feature error translations. Adopt per-operation execution state with distinct denied, rejected, thrown and success results; preserve idempotency keys across uncertain retries. Do not use one global busy flag, reuse a request key after payload changes, or automatically retry writes.
7. Shared UI now exists (SelectControl, CollectionToolbar, IconButton, PaginationFooter, FormField, DetailsPanel, StatusBadge, StatusReason, Notice, EmptyState). Audit remaining duplicated markup and migrate where semantics match. Keep inline inspection separate from modal interaction: shared detail content must not force a drawer. Move repeated page-local bilingual labels into existing translation catalogs in small groups.

## State ownership

- Application/session: authenticated organization, selected warehouse, permission readiness, theme and locale. Extend existing providers only where ownership is genuinely shared.
- Persisted preferences: map labels, preferred collection layout and page size; explicit global or feature scope, validated through shared storage utilities.
- URL: active floor/tab/view and shareable search/filter/sort state; retain current documented URL contracts.
- Floor/workflow workspace: selected location/unit, current draft, baseline version, edit mode and dirty state. One controller feeds map, list, inspector and editor. Use scoped context only when it removes substantial prop plumbing.
- Local: expanded sections, hover, transient dialogs and individual operation progress/errors.
- Server-owned: inventory, reservations, building state and authoritative access. Keep Convex subscriptions authoritative rather than mirroring query data in a global client store.

## Delivery sequence

A. Record current state ownership and regressions; extract access/navigation helpers from finishedGoods/shared and consolidate pure inventory/search selectors. Delete replaced implementations.
B. Split storage orchestration and introduce a floor workspace controller. Preserve public exports during migration, then remove compatibility exports with no consumers.
C. Share validated preference/draft storage; migrate preferences first, draft persistence separately with saved-key fixtures.
D. Consolidate operation execution and error-result handling; migrate one create/update workflow before broader adoption.
E. Consolidate URL/history mechanics last, after dedicated dirty-navigation and back/forward tests pass.
F. Complete remaining UI and translation migrations alongside the owning workflows, avoiding a mass cosmetic rewrite.

## Acceptance

Map, list and inspector agree on selection, matching locations and totals. No draft or selection leaks across warehouses/buildings/floors/users. Reload, invalid saved state, unavailable storage, back/forward and concurrent server updates remain correct. Failed saves preserve drafts and retry identity. Permission checks are not weakened. All migrated workflows pass relevant interaction tests plus typecheck/lint and the full suite; verify both locales/themes, mobile, keyboard and focus in the running app. Track removed duplicate implementations and consumers migrated; do not promise a line-count or runtime improvement without measuring it.


## Implemented modules and boundaries

- `hooks/useCanManage`, `useDraftKey`, `useUnsavedWarning`, `useAsyncOperation`, `useRequestIdentity`: shared access, identity, dirty-page and execution mechanics. Finished-goods translations remain in `operationErrors`; the old shared exports remain as compatibility adapters for existing feature consumers.
- `lib/navigation` owns encoded finished-goods routes as well as storage routes; `lib/convex/mutationOutcome` owns write-result interpretation.
- `lib/browser/storage` owns safe read/write mechanics; preferences, drafts and session preferences expose separate intent while feature decoders preserve schema and migration behavior. Existing JSON formats and storage keys remain compatible.
- `lib/browser/history` owns query and metadata writes. Catalogue, cursor and batch workflows reuse it. The workspace dirty-history policy remains explicit rather than being hidden in a generic hook.
- `lib/storageLayouts/locationSelectors` owns search, unique inventory counts and measured footprint. Map, list and location management share it.
- `StorageZonesPanel` and `storageLayoutShared` extracted from the large storage screen. `useFloorSelection` owns scoped selection and validates it against current locations; `useWorkspaceQuery` owns committed-query subscription.

Measured file sizes after extraction: StorageLayoutScreens ~3,030 lines (from ~4,200), finishedGoods/shared 282 (from ~640). These are orchestration reductions, not equivalent total-code savings: the extracted behavior now has dedicated homes, and replaced repeated implementations have been removed. Existing UI primitives remain reused; no new global application store was added.

Final verification: typecheck and lint passed; 103 test files / 934 tests passed. Browser checks passed for legacy floor redirects, dirty Keep/Discard, browser Back guards, populated floor editing, accessibility, inline selection and explicit Add/Edit, finished-goods search/filter focus return, and mobile overflow. No page errors were observed. Latest storage screen size is 3,023 lines; finished-goods shared facade is 282 lines. The create-building workflow now uses the shared executor with a regression test for stable retry identity on unchanged payloads. Shared location selectors preserve explicit incomplete/summary-only inventory semantics rather than inventing unit status details.
