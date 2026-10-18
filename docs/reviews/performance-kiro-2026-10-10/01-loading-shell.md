# Performance audit 01: initial load, app shell, and route transitions (October 10, 2026)

Reviewer: Kiro. Scope: `src/app`, `src/components/providers`, `src/components/shell`,
`src/i18n`, `next.config.ts`, plus the modules they pull into first-load JavaScript.
The audit was read-only. No application code, configuration, git state, or data was
changed, and no build, dev server, test suite, seed, or deployment was run.

## Evidence base and limits

- **No runtime performance numbers were measured.** There are no TTFB, LCP, INP, CLS,
  or network timings in this report. All latency claims are inferred from code and are
  labelled as inferred.
- Byte counts come from the existing production build artifact
  `.next-build/` (Next 16.3.8 Turbopack, `BUILD_ID` `vgw2wU5OKNwdvHjIy4vtz`, built
  Oct 10 02:47), specifically `.next-build/diagnostics/route-bundle-stats.json`
  (`firstLoadUncompressedJsBytes`, `firstLoadChunkPaths`). I computed gzip sizes
  read-only with Node `zlib.gzipSync` over those chunk files. These are static sizes,
  not transfer or execution measurements. The older `.next/` build (Oct 9 22:27) was
  used as a cross-check.
- Some sources changed after that build, including `src/components/examples/c-sidebar-2.tsx`
  (14:10) and `FinishedGoodsCatalogue.tsx`. Every finding below was also confirmed
  against the current source. Re-measure on a fresh build before quoting savings.
- Installed docs read: `node_modules/next/dist/docs/01-app/02-guides/{prefetching,lazy-loading,package-bundling}.md`,
  `03-api-reference/02-components/link.md`, and the `next-config-js/{partialPrefetching,staleTimes,optimizePackageImports}.md` references.
- Related: `docs/reviews/codebase-optimization-2026-10-08.md` (ProductScreens split
  precedent) and `05-measurement-and-ux.md` in this folder (baseline protocol).

### Baseline from the artifact (first-load JS per route)

| Route                                                                       |                            Raw bytes | Gzip bytes (computed) |
| --------------------------------------------------------------------------- | -----------------------------------: | --------------------: |
| `/[locale]` (redirect only; root layout and providers)                      |                            1,019,270 |               305,784 |
| `/[locale]/sign-in`                                                         |                            1,037,618 |               312,761 |
| `/[locale]/hr/profile` (smallest desktop page; shell baseline)              |                            1,307,925 |               401,914 |
| `/[locale]/finished-goods`                                                  |                            1,383,820 |               427,233 |
| **`/[locale]/master-data/storage-layouts`** (default landing after sign-in) |                        **1,859,024** |           **548,459** |
| `…/storage-layouts/[buildingId]`, `/review`, `/new`                         | identical 1,859,024 (same 29 chunks) |               548,459 |

The desktop shell adds 96,130 B gzip over the root (7 chunks). The storage-layouts
catalogue adds another 151,122 B gzip over the shell baseline (4 chunks).

### Existing mitigations (already in place; not recommended again)

- Per-route message scoping: `src/i18n/clientMessages.ts:6–39` and `src/i18n/RouteMessages.tsx:30–44`.
- Camera decoder is lazy-loaded: `src/features/finishedGoods/useBarcodeCamera.ts:82`.
- The ProductScreens split (from the 2026-10-08 review) keeps scene code out of the finished-goods catalogue.
- Instant navigation feedback:
  - `src/app/[locale]/(desktop)/loading.tsx` with `RouteLoading`
  - `src/components/shell/NavigationPendingIndicator.tsx:6` (`useLinkStatus`)
- Search queries nothing until the dialog opens: `SearchDialog.tsx:114` mounts `SearchBody` only while open, and the contract is stated at `GlobalSearchProvider.tsx:56`.
- The theme toggle reserves its space before hydration: `src/components/ui/theme-toggle.tsx:24–26`.
- Clerk already emits an async `clerk-js` `<script>` plus a `preload` for the UI bundle during SSR (`node_modules/@clerk/nextjs/dist/esm/utils/clerk-script-tags.js`). No manual Clerk preload is needed.
- Fonts:
  - `next/font` Geist / Geist Mono, latin subset, `display: "swap"` (`[locale]/layout.tsx:19–28`).
  - The artifact has one preloaded woff2 (`static/media/797e…-s.p.*.woff2`, 23,108 B).
  - Thai falls back to system fonts (`globals.css:9`). No Thai webfont download.
- `lucide-react` is auto-optimized by Next. `radix-ui`, `motion`, `lucide-react`, and `convex` all declare `sideEffects: false`, so `optimizePackageImports` would add nothing in production.
- Images: there are no large static images. The only `<img>` elements are user photo previews (`JobScanPhotoPreview.tsx:36,47`), where `next/image` would not help.
- Web Vitals reporting exists (`src/components/system/WebVitals.tsx`), but it only writes to the console sink.

---

## Findings

### F1. Both full message catalogues ship in the default landing route's JavaScript

- **Files:**
  - `src/features/storageLayouts/BuildingAreaDetails.tsx:28` (`import { messagesFor } from "@/i18n/messages"`), used at `:347`
  - `src/components/storageLayouts/FloorLocationTable.tsx:38`, used at `:91` (`...messagesFor(locale).StorageLayouts.locationTable`)
  - `src/i18n/messages.ts:1–2` statically imports `messages/en.json` **and** `messages/th.json`
- **Evidence (measured artifact):**
  - Chunk `.next-build/static/chunks/2172jw2we9z6h.js` is 372,147 B raw / 94,357 B gzip and contains exactly one copy of each catalogue: two `JSON.parse('…')` calls, plus sentinels `เหตุผลที่แก้การบรรจุไม่ได้` and `Why packing is locked` from `FinishedGoods`.
  - It loads on all 5 storage-layout routes. The older `.next/` build shows the same pattern (`0xbox-nvbn91g.js`).
  - Minified catalogues: th 191,463 B (39,373 gzip), en 106,288 B (33,721 gzip).
  - The catalogue reaches it through `BuildingCatalogueOccupancy` → `BuildingAreaDetails` (`StorageLayoutScreens.tsx:260,287–303`).
- **Journey and why it is slow:** The landing page after sign-in (`SignInScreen.tsx:36`, `[locale]/page.tsx:16–20`) and every building page download HR, finished-goods, and both locales' text, then `JSON.parse` about 300 kB on the main thread. The `StorageLayouts` namespace is already delivered by `(desktop)/master-data/layout.tsx` through `RouteMessages`.
- **Fix:**
  - In `FloorLocationTable`, replace `messagesFor(locale)` with `const t = useTranslations("StorageLayouts")` and `t.raw("locationTable")` (same object shape as today).
  - In `BuildingAreaDetails`, use `t(placementStatusKey(p))`.
  - Leave the type-only import in `FloorWorkspaceLocationList.tsx:17` as is.
  - Add an ESLint `no-restricted-imports` entry (`eslint.config.mjs:70`) banning `@/i18n/messages` and `**/messages/*.json` everywhere except `src/i18n/request.ts`, `src/i18n/messages.ts`, and tests.
- **Priority / effort:** P0 / S (two components, two test mocks, one lint rule).
- **Expected:** about 298 kB raw and roughly 60–73 kB gzip less on 5 routes, plus less parse/JSON work (inferred).
- **Risks and safeguards:**
  - Visible labels must stay byte-identical in Thai and English.
  - `FloorLocationTable.test.tsx:14` mocks `next-intl` with only `useLocale`. Switch those tests to a real `NextIntlClientProvider` loaded with the master-data scope, so missing keys fail loudly.
  - Both components render only under master-data (`FloorMap` → storage screens and the demo), which already provides `StorageLayouts`.
- **Measure / regression:**
  - Before and after on a fresh build: `route-bundle-stats.json` for `/[locale]/master-data/storage-layouts`, and grep `.next/static/chunks/*.js` for the two sentinels. Expected after: no chunk contains them.
  - Add a CI script asserting that no client chunk contains a sentinel from a namespace outside the route scope.
  - Unit tests: Thai and English label rendering for both components.

### F2. The catalogue route ships the entire storage editor module

- **Files:**
  - `src/app/[locale]/(desktop)/master-data/storage-layouts/page.tsx:6` imports `StorageBuildingCatalogue` from `src/features/storageLayouts/StorageLayoutScreens.tsx`, a 3,024-line `"use client"` module (`:1`).
  - The same module statically imports `FloorMap` (`:73`), `StoragePlacementLayer` / `StorageZoneVisualizer` (`:24–28,74`), isometric geometry (`:113–118`), `StorageZonesPanel` (`:14`), dialogs, and so on.
  - It exports the editor, floor editor, `FloorPlan`, `IsometricBuilding`, and review screens (`:490, 799, 933, 1117, 1796, 2834`).
- **Evidence (measured artifact):**
  - The catalogue, `[buildingId]`, `review`, and `new` routes have the identical 29-chunk set (1,859,024 B). Turbopack did not drop the unused editor exports at this client boundary.
  - Catalogue-only chunks beyond the shell: `2172jw2we9z6h.js` (94,357 gzip, contains `floor-map`), `1lg-mgp1e01wv.js` (33,424 gzip, `StorageBuildingCatalogue`), `3konbbrgxkxko.js` (13,383 gzip), `01l4lq3cd76en.js` (9,958 gzip).
- **Journey:** This is the first page every storage user sees after sign-in. The catalogue renders only a filter row, building rows, `BuildingStatusToggle`, and `BuildingAreaDetails` (`:152–303`), but downloads and evaluates the 2D/3D editor.
- **Fix:**
  - Move `StorageBuildingCatalogue`, `CatalogueContent`, `BuildingCatalogueOccupancy`, `StorageCatalogueFilters`, and their small helpers (`statusLabel`, `LoadingCard`, `QueryFailure`, `Metric`, `metres`, debounced search) into `src/features/storageLayouts/StorageBuildingCatalogue.tsx`.
  - Do the same for `NewStorageBuildingForm` in its own module.
  - Point the `page.tsx` and `new/page.tsx` imports at the new modules.
  - Keep re-exports in `StorageLayoutScreens.tsx` so the existing tests stay unchanged.
  - This mirrors the ProductScreens split. It is a plain static split: no `next/dynamic` and no new loading state.
- **Priority / effort:** P1 / M.
- **Expected (inferred):** after F1, most of the remaining ~80–90 kB gzip catalogue-specific code, to be confirmed with `pnpm exec next experimental-analyze --output` as in the 2026-10-08 review.
- **Risks and safeguards:**
  - Pure move refactor. Compare declarations with an AST diff, as the prior split did.
  - Watch for module-level shared state, such as `useWorkspaceNavigationGuard` (`:37`) and `useCatalogueSync`. They are hooks without module singletons, but verify.
  - The `StorageLayoutScreens.tsx` file is currently unmodified in git, so there is no conflict with pending user work.
- **Measure / regression:**
  - Before and after: `firstLoadUncompressedJsBytes` for catalogue vs `[buildingId]` (expected to diverge), and `experimental-analyze` output parts.
  - Add a budget assertion: the catalogue route must not include any chunk containing `floor-map` / `FloorMap-module`.
  - Existing `StorageLayoutScreens.test.tsx` and `StorageLocationCatalogue.test.tsx` must pass unchanged.

### F3. The `motion` library loads on every desktop route for one theme switch

- **Files:**
  - `src/components/ui/animated-toggle.tsx:4` (`AnimatePresence, motion, useReducedMotion` from `motion/react`) is the only importer of `motion` in `src`.
  - It is used by `src/components/ui/theme-toggle.tsx:8,29`, which the shell renders at `src/components/examples/c-sidebar-2.tsx:38,111` (also in HEAD), and by `BuildingStatusToggle.tsx:10,176`.
- **Evidence (measured artifact):**
  - `09t1p-08qb1im.js` (134,448 raw / 44,449 gzip) is on all 29 desktop routes, HR included, where `BuildingStatusToggle` is absent.
  - It contains motion internals (`MotionConfig`, `LayoutGroup`, `onViewportEnter`, `BeforeLayoutMeasure`), plus `useWorkspaceNavigationGuard`, so not all 44 kB is motion.
- **Journey:** Every hard load of any authenticated page downloads and evaluates a full animation runtime to animate a 52 px switch thumb and an icon swap.
- **Fix:**
  - Re-implement `AnimatedToggle` with CSS: `transition-transform` on the thumb, an ease close to the current spring (0.25 s, bounce 0.1, `animated-toggle.tsx:28–32`), and `motion-reduce:transition-none`.
  - Render both icons stacked and cross-fade/rotate them with `opacity`/`rotate` transitions instead of `AnimatePresence`.
  - Keep the `role="switch"`, `aria-checked`, and `after:` touch-target markup unchanged. This also benefits `BuildingStatusToggle`.
- **Priority / effort:** P1 / S.
- **Expected:** roughly 30–44 kB gzip less on every desktop route (inferred until analyzed).
- **Risks and safeguards:**
  - Visual parity is the UX contract. Capture light/dark and reduced-motion screenshots before and after.
  - Do not remove the animation for users who allow motion.
  - The `motion` dependency can stay in `package.json` until nothing imports it.
- **Measure / regression:**
  - Shell baseline (`/[locale]/hr/profile`) before and after; grep chunks for `MotionConfig` (expected absent).
  - Existing `animated-toggle.test.tsx` and `BuildingStatusToggle.test.tsx` must pass.
  - Add a test that `prefers-reduced-motion` produces no transition classes, plus a Playwright screenshot of the toggle in both states.

### F4. The Convex socket opens only after Clerk finishes booting (serial auth waterfall)

- **Files:**
  - `src/components/providers/ConvexClientProvider.tsx:17–27`
  - `node_modules/convex/dist/esm/react/client.js:100–112` (sync client and WebSocket are created lazily on first `sync` access)
  - `node_modules/convex/dist/esm/react/ConvexAuthState.js:81–84` (`client.setAuth` runs only once `authProviderAuthenticated`)
  - Consumers: `WorkspaceProvider.tsx:87–93` and `HrAccessProvider.tsx:49–53`, which skip queries until `useConvexAuth` settles
- **Evidence (code, inferred timing):** On a hard load the order is:
  1. HTML and JS arrive.
  2. `clerk-js` loads and initializes.
  3. `setAuth` creates the WebSocket: DNS, TCP, TLS, upgrade.
  4. The Convex token is fetched.
  5. Authenticate is sent.
  6. Workspace and HR queries run.
  7. Page queries run (`QueryGate.tsx:16–24`).

  Socket setup sits on the critical path after Clerk instead of overlapping with it. `WebSocketManager.pause()` keeps an open socket open (`node_modules/convex/dist/esm/browser/sync/web_socket_manager.js:519–533`), so a socket opened early is reused when auth arrives.

- **Journey:** Every hard load and reload of an authenticated page, before the sidebar, warehouse selector, and data appear. The cost is worst on phones and high-latency networks.
- **Fix:**
  - Add a small client component, `ConvexConnectionWarmup`, rendered from `src/app/[locale]/(desktop)/layout.tsx`. That layout runs only after `readAppAccess()` returned `APP` (`:21–31`).
  - In a mount effect it calls `useConvex().connectionState()` once, which opens the socket at hydration.
  - Also emit `<link rel="preconnect" href={convexOrigin} crossOrigin="anonymous">`, or React DOM's `preconnect()`, from the same layout. This is at least a DNS win; whether Chrome reuses the socket for WebSocket is unverified.
  - Keep sign-in and public pages unchanged so they open no extra socket.
- **Priority / effort:** P1 / S.
- **Risks and safeguards:**
  - No query runs unauthenticated, because providers still skip until `isAuthenticated`.
  - CSP already allows `wss:` (`src/lib/securityHeaders.ts:19`).
  - Verify that `ConvexProviderWithClerk` token refresh and the org-switch flows still reconnect correctly.
  - Verify the warmup is a no-op when `convexUrl` is undefined (`ConvexClientProvider.tsx:21`).
- **Measure / regression:**
  - Playwright trace on a production build with Slow 4G and 4× CPU throttling. Record the WebSocket open timestamp relative to `clerk-js` load end, and time to `[data-testid="warehouse-select"]` visible. Expected: the socket opens before Clerk completes, and the selector appears earlier.
  - Unit test: the warmup calls `connectionState` exactly once and never on sign-in.
  - Existing `WorkspaceProvider.test.tsx` and `AppProviders.test.tsx` must pass.

### F5. The header flashes "No organization context" while the workspace loads

- **Files:**
  - `src/components/shell/WorkspaceContextBar.tsx:16–23` returns `t("unavailable")` / `t("unavailableHint")` whenever `!workspace.selectable`.
  - During loading, `WorkspaceProvider.tsx:104–111` and `:127–133` return `EMPTY_WORKSPACE` with `selectable: false`.
  - It is rendered on both top-level pages (`c-sidebar-2.tsx:66–69,73,101–104`).
- **Evidence (code):** On every hard load of `/storage-layouts` and `/finished-goods`, through the F4 waterfall, the header shows "No organization context — Organization and warehouse access comes from your verified account." (`messages/en.json`, `Workspace`). It then swaps to a compact select of a different width. That is a wrong status message, slower-feeling perceived load, and a horizontal layout shift.
- **Fix:**
  - When `workspace.loading`, render a fixed-size placeholder matching the compact select (`w-full sm:w-56`, compact height) with `aria-busy` and an sr-only loading label.
  - Show "unavailable" only for settled `SIGN_IN_REQUIRED`, `BACKEND_MISSING`, or denied states.
- **Priority / effort:** P1 / XS.
- **Risks and safeguards:**
  - Denied, failed, and backend-missing states must keep their current text.
  - Do not mask a hung load indefinitely. `QueryGate` and `LedgerPanelStatus` already show page-level status.
- **Measure / regression:**
  - CLS from the existing WebVitals console sink, before and after.
  - Unit test: in LOADING the bar has no "No organization context" text and the same box size. In READY the select renders. In SIGN_IN_REQUIRED the unavailable text renders.

### F6. The installed PWA starts on a 404 page

- **Files:**
  - `public/manifest.webmanifest:7` has `"start_url": "/th/dashboard"`, linked from `src/app/[locale]/layout.tsx:55`.
  - No `dashboard` route exists. `src/app/[locale]/[...rest]/page.tsx:3–5` calls `notFound()`, and nothing in `next.config.ts:71–80` or `src/proxy.ts` redirects it.
- **Evidence (code; not requested at runtime):** Every home-screen launch renders the not-found page, and the user must navigate again (inferred).
- **Fix:**
  - Set `start_url` to `/th/master-data/storage-layouts`, the current post-sign-in default (`SignInScreen.tsx:36`). Signed-out users are redirected to sign-in by `(desktop)/layout.tsx:22–29`.
  - If F9 lands, use `/th` instead so the landing decision has a single owner.
- **Priority / effort:** P0 (correctness) / XS.
- **Risks and safeguards:** Installed PWAs pick up manifest changes lazily. Keep `scope` unchanged.
- **Measure / regression:**
  - Add a unit test that parses the manifest and asserts `start_url` maps to an entry in the build's `app-path-routes-manifest.json`, or extend `tests/e2e/smoke/headers.spec.ts:49` to request `start_url` and expect a non-404 response.

### F7. Search intent parsing and AI code load eagerly on every desktop route

- **Files:**
  - `src/components/shell/search/GlobalSearchProvider.tsx:27,124–137` statically imports `SearchDialog`.
  - `SearchDialog.tsx:44` imports `useAiSearch`, and `:37–43` imports `results.tsx`. `results.tsx:27–36` imports `matchDestinations`, `recordQuery`, `resolveIntent`, and `convex/model/search/text`.
  - The provider wraps the whole shell (`c-sidebar-2.tsx:77`).
- **Evidence (measured artifact):**
  - `2ipgtng0cd-3c.js` (40,158 raw / 14,348 gzip, all 29 desktop routes) contains the Thai month and relative-day vocabulary and destination synonyms (`เมื่อวานซืน`, `"time correction"`, `taskReviewDay`).
  - `35wv1alx-fs4u.js` (17,826 gzip) combines sidebar and search (`global-search-input`, `interpretSearch`).
- **Journey:** Every desktop hard load pays for code that runs only after ⌘K or a click on Search.
- **Fix:**
  - Keep the provider, shortcut handler, triggers, and the `Dialog` shell eager.
  - Load `SearchBody` with `next/dynamic` (client component, `ssr: false` is allowed).
  - Lift `query` state into `SearchDialog`, so the loading fallback is the same input and keystrokes are never lost.
  - Preload the chunk with `requestIdleCallback` after hydration, and on `pointerenter`/`focus` of the triggers and on the first ⌘K keydown.
- **Priority / effort:** P2 / M.
- **Expected:** roughly 15–25 kB gzip less on all desktop routes (inferred).
- **Risks and safeguards:**
  - Opening on a cold cache must show the input immediately with focus (`SearchDialog.tsx:97–112` focus logic), and results within the preload window.
  - Preserve IME composition handling (`useSettledText`, `:49–58`).
  - `GlobalSearchProvider.tsx` and `SearchDialog.tsx` are untracked user work. Coordinate with the owner.
- **Measure / regression:**
  - Shell baseline bytes before and after.
  - Playwright: press ⌘K immediately after `load` on a cold cache, type Thai text, and assert focus and the exact text.
  - Existing `GlobalSearch.test.tsx` (920 lines) and `SearchDialogFocus.test.tsx` must pass.

### F8. Sidebar navigation shows a skeleton and then waits for the server and route JS

- **Files:**
  - Sidebar links use next-intl `Link` with the default prefetch (`c-sidebar-2.tsx:296–318`).
  - Every desktop route is dynamic: `(desktop)/layout.tsx:21` calls `auth()`, and the artifact's `.next-build/prerender-manifest.json` lists no `[locale]` routes.
  - The first loading boundary is `(desktop)/loading.tsx`.
  - Per the installed docs (`02-guides/prefetching.md:31–36,59–62`), dynamic routes with `loading.js` prefetch only "layout to first loading boundary", with no client cache TTL. Section layouts with messages (`master-data/layout.tsx`, `finished-goods/layout.tsx`, `hr/layout.tsx`), the page payload, and the page's JS chunks are all fetched after the click.
- **Evidence (code and docs; inferred timing):** Each click goes RouteLoading skeleton → proxy plus RSC render → client chunk download → client hydrate → Convex queries (socket already warm).
- **Fix:**
  - Use an intent-based full prefetch for sidebar items only: a `NavLink` wrapper that sets `prefetch={true}` after `pointerenter`, `focus`, or `touchstart`, and `prefetch={null}` otherwise. This is the docs' hover pattern (`prefetching.md:125–154`) with `true`.
  - Pages are thin server wrappers whose data comes from Convex, so the prefetched payload holds no business data. Full prefetches are cached under `staleTimes.static` (5 min).
- **Priority / effort:** P2 / S.
- **Risks and safeguards:**
  - Server cost is bounded to links the user shows intent for.
  - Authorization stays in Convex and in `(desktop)/layout.tsx`.
  - Clerk org/session changes call router refresh.
  - In dev, Next shows a non-blocking "dynamic data during prefetching" insight for `prefetch={true}` without Partial Prefetching (`adopting-partial-prefetching.md:48,262`). Accept it or document it.
  - Keep `NavigationPendingIndicator` for slow cases.
  - `c-sidebar-2.tsx` has pending user edits. Apply the change on top of them.
- **Measure / regression:**
  - Playwright on a production build with Slow 4G: time from click to the destination `h1`, with and without a 200 ms hover. Count skeleton frames (`[role=status][aria-busy=true]` from `RouteLoading`).
  - Unit test: the wrapper switches `prefetch` on pointer and keyboard intent.

### F9. HR-only members download the storage landing page first and are then redirected

- **Files:**
  - Post-sign-in fallback is storage layouts (`SignInScreen.tsx:36`). The root redirect goes to storage too (`[locale]/page.tsx:16–20`).
  - `src/components/shell/HrLandingRedirect.tsx:24–35` calls `router.replace` only after `workspace.denied` **and** `hr.status === "READY"`, which is after the full F4 waterfall.
- **Evidence (code plus artifact):** An HR-only member downloads the 548 kB gzip storage route (F1/F2), waits for both Convex queries, then client-navigates to `/hr/...` and loads HR chunks. They see storage loading states followed by a redirect.
- **Fix:**
  - When `HrLandingRedirect` redirects, set a non-authoritative cookie hint (for example `industrial-sas.landing=hr`, `SameSite=Lax`, scoped to `/`).
  - Clear it when `WorkspaceProvider` reaches `READY_TO_QUERY`.
  - `SignInScreen` (a server component) and `LocaleRootPage` read it to pick the first HR destination for `fallbackRedirectUrl` / `redirect`.
  - Keep `HrLandingRedirect` as the authoritative correction.
- **Priority / effort:** P2 / M. Impact depends on the HR-only population (unknown).
- **Risks and safeguards:**
  - The hint never grants access: destinations authorize in Convex.
  - A stale hint costs at most one client redirect, the same as today.
  - Explicit `returnTo` always wins (`SignInScreen.tsx:37`).
- **Measure / regression:**
  - E2E with an HR-only fixture (`convex/staging/hrDemo.ts` exists): the second sign-in lands on `/hr/...` with no request for storage-route chunks.
  - Unit tests for the cookie read/clear rules.

### F10. On phones the header gains a search button after hydration (layout shift)

- **Files:**
  - `c-sidebar-2.tsx:130–133` (`HeaderSearch` returns `MobileSearchButton` only when `isMobile`)
  - `src/hooks/use-mobile.ts:13` (server snapshot `false`)
- **Evidence (code, inferred):** SSR renders no button below 1024 px. After hydration a 40–44 px icon appears before the workspace bar or task context and pushes it right. The desktop rail is already CSS-hidden below `lg` (`src/components/ui/sidebar.tsx`, `hidden … lg:block`), so only this button shifts.
- **Fix:** Always render `MobileSearchButton` wrapped in `lg:hidden`. Its `useSearchControls()` is available inside the provider.
- **Priority / effort:** P3 / XS.
- **Risks and safeguards:**
  - Breakpoints match (`MOBILE_BREAKPOINT` 1024 = Tailwind `lg`).
  - Make sure the hidden desktop button cannot be focused: `display: none` already removes it from the tab order.
- **Measure / regression:** Field or lab CLS on a 390 px viewport, before and after. Add a test that server-rendered markup contains `data-testid="mobile-search"` inside an `lg:hidden` wrapper.

### F11. Nothing guards route bundle size, so these regressions are invisible in CI

- **Files:** No script under `scripts/` or `.github/` reads `.next/diagnostics/route-bundle-stats.json`. A grep for `route-bundle-stats`, `firstLoad`, and `experimental-analyze` found nothing. F1 and F2 shipped unnoticed.
- **Fix:**
  - Add `scripts/ci/check-route-bundles.mjs` to run after `pnpm build` in the existing build job.
  - Per-route gzip budgets for: `/[locale]`, the shell baseline (`/[locale]/hr/profile`), `/[locale]/master-data/storage-layouts`, and `/[locale]/finished-goods`.
  - Forbidden-content sentinels:
    - out-of-scope message strings (F1)
    - `FloorMap-module` on the catalogue (F2)
    - `MotionConfig` on the shell (F3)
  - Set budgets about 5% above post-fix values. Print a per-chunk diff on failure.
- **Priority / effort:** P1 / S. Land it with F1.
- **Risks:**
  - It must read only build output and stay credential-free.
  - `route-bundle-stats.json` is a 16.3 Turbopack diagnostic. Fail clearly if the format changes.

---

## Ranked top 3

1. **F1 – remove client imports of the full message catalogues.** It has the largest measured byte reduction (~60–73 kB gzip, ~300 kB of JSON parse) on the default landing route, the smallest effort, and no UX change.
2. **F3 – replace `motion` in the shell toggle with CSS.** It saves up to ~44 kB gzip on every authenticated route, with visual parity and reduced-motion support kept.
3. **F2 – split the storage catalogue from the editor module.** It removes editor and scene code from the landing route using the same proven static-split method as ProductScreens.

Do F6 and F5 immediately alongside them. They are XS-effort correctness and perceived-speed fixes. F4 is the highest-value latency item but is inferred, so measure it first with the F4 trace.

## Dependencies and order

- Land F11 with F1 so every later change has a budget and sentinel check.
- Measure F2 after F1. Their savings overlap in chunk `2172jw2we9z6h.js`, and the post-F1 analyzer output is the honest baseline for F2.
- F3 is independent. F7 and F10 both touch `c-sidebar-2.tsx` and search files that carry pending user edits, so coordinate them and land them after that work merges.
- F9 depends on F6's choice of `start_url` (`/th` if F9 lands). F8 benefits from F2 (smaller route chunks to prefetch).
- All latency claims (F4, F5, F8, F9) need the comparable production-build baseline described in `05-measurement-and-ux.md`: fixed revision, cold and warm runs, desktop plus a physical phone, Thai and English.

## Recommendations to reject (they trade away UX)

- **Removing `(desktop)/loading.tsx` or disabling `<Link>` prefetch** to cut requests. This loses instant navigation feedback.
- **Moving Clerk/Convex providers out of the root layout** to slim sign-in JavaScript. The root-mounted client keeps its socket across the soft sign-in → app navigation. Moving it would add a reconnect and an auth waterfall right after sign-in.
- **Lazy-loading the sidebar, navigation, `AccountButton`/`UserButton`, or setting Clerk `prefetchUI={false}`.** This causes visible pop-in and slower account menus on every page.
- **Loading search purely on demand without idle and intent preloading**, or rendering the input only after the chunk arrives. This produces a first-⌘K lag and lost keystrokes. F7 keeps the input eager.
- **Dropping the toggle animation instead of reimplementing it in CSS** (F3), or removing `display: "swap"` fonts.
- **Server-preloading Convex workspace data in SSR** (`fetchQuery` with a server token) to skip the client waterfall. It adds TTFB for every user and couples HTML delivery to Convex availability. Reconsider only if F4 measurements prove the waterfall still dominates.
- **App-wide `cacheComponents` + `partialPrefetching` or `experimental.staleTimes.dynamic` now.** These are a large semantic migration of an authenticated, session-dependent app for unmeasured gain. F8 gets most of the transition benefit locally.
- **Splitting `FinishedGoods` messages per page** (about 72 kB raw Thai sent once per section entry). The runtime missing-key risk outweighs the small gzip gain. Translation scoping already exists.

Out of scope but noted: `SidebarProvider` writes a `sidebar_state` cookie (`src/components/ui/sidebar.tsx:78`), but the shell hard-codes `defaultOpen={false}` (`c-sidebar-2.tsx:79`). The user's expanded or collapsed choice is therefore lost on every reload. This is a UX consistency issue, not a speed issue.
