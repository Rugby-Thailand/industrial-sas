# Loading and navigation UX

Research brief, 2026-08-31. This note covers page-to-page loading in the
Next.js App Router, especially the requirement that the desktop navigation and
header remain present during ordinary page changes.

Evidence labels used below:

- **Sourced fact** means the statement is directly supported by official
  Next.js, React, or `next-intl` documentation.
- **Repository observation** means it comes from inspecting this codebase.
- **Design inference/recommendation** is the proposed change for this product.

## Executive conclusion

The repository already places the desktop navigation at the correct persistence
boundary. `DesktopShell` and `WorkspaceProvider` are children of the common
`[locale]/(desktop)/layout.tsx`, while each page is rendered only in the shell's
`<main>`. The navigation uses the `next-intl` `Link` wrapper around
`next/link`. Ordinary navigation between desktop pages in the same locale
therefore should be a client transition: the shell stays mounted, its state and
workspace subscription survive, and only the active-link UI and page content
update.

The principal gap is feedback, not a missing shell architecture. There are no
`loading.tsx` files anywhere under `src/app`. Because authenticated desktop
routes perform a request-time access check, a click can wait for a server
response with no immediate route-level loading state. That delay can look like
the application or navigation has reloaded even when the shell has not actually
remounted.

Implement a content-only `loading.tsx` boundary below `DesktopShell`, retain
the current `Link`-based navigation and default prefetching, and add a subtle
delayed pending treatment to the clicked navigation link. Keep Convex query
loading inside the destination page as a separate state. Do not move the shell
or providers into pages, place them under a `template.tsx`, key them by pathname,
or cover them with a higher loading fallback.

## Current repository baseline

### Runtime and router

- **Repository observation:** `package.json` pins Next.js `16.2.12`, React and
  React DOM `19.2.8`, and `next-intl` `4.13.4`. This is an App Router application
  rooted at `src/app`; recommendations should use the current unversioned
  Next.js 16 APIs rather than older Next.js 14/15 examples.
- **Repository observation:** the locale root layout at
  `src/app/[locale]/layout.tsx` owns `NextIntlClientProvider` and
  `AppProviders`. The desktop layout at
  `src/app/[locale]/(desktop)/layout.tsx` owns `WorkspaceProvider` and
  `DesktopShell`.
- **Repository observation:** `DesktopShell` renders the navigation and header
  outside `<main>{children}</main>`. `NavigationTree` reads `usePathname()` to
  update the active item. A small rerender of this client component is expected;
  remounting the shell or clearing its state is not.
- **Repository observation:** desktop navigation links import `Link` from
  `src/i18n/navigation.ts`, which is created with
  `createNavigation(routing)`. `next-intl` documents this as a thin wrapper
  around `next/link` that inherits its normal prefetch behavior. [next-intl:
  Navigation APIs](https://next-intl.dev/docs/routing/navigation)
- **Repository observation:** the only plain anchors found in the desktop and
  handheld shells are same-document skip links (`#main-content`), which should
  remain anchors. Inspected internal page links use the locale-aware `Link`;
  two post-mutation flows use the locale-aware `router.push`. There is no broad
  hard-navigation problem visible in the inspected source.

### Why a wait can still occur

- **Repository observation:** the desktop layout calls `readAppAccess()`, which
  calls Clerk's request-time `auth()`. Authenticated desktop rendering is
  therefore not equivalent to a wholly static route.
- **Repository observation:** there are 35 layout files and 53 page files, but
  no `loading.tsx` and no `template.tsx` under `src/app`.
- **Repository observation:** route-specific layouts load translated message
  scopes through `RouteMessages`. Most business data then loads in client
  components through Convex `useQuery`, with `QueryGate` and
  `LedgerPanelStatus` already providing data-level loading and failure states.

**Design inference:** route-transition loading and business-query loading are
two different phases:

1. Route/RSC/code phase: the click has happened, but the destination route and
   client bundle are not yet ready. `loading.tsx`, prefetching, and link pending
   feedback address this phase.
2. Live-data phase: the destination page has mounted, but Convex authentication,
   workspace scope, or a query result is pending. `QueryGate`, panel skeletons,
   and local empty/error states address this phase.

One global spinner cannot represent both phases accurately.

## What the primary sources establish

### Shared layouts are the persistence mechanism

- **Sourced fact:** App Router layouts share UI between pages and, on client
  navigation, preserve state, remain interactive, and do not rerender. [Next.js:
  Layouts and Pages](https://nextjs.org/docs/app/getting-started/layouts-and-pages)
- **Sourced fact:** layouts are cached and reused during navigation. URL-aware
  UI such as an active navigation item should read the pathname in a Client
  Component because that component can rerender with the latest pathname even
  while the layout remains reused. [Next.js: `layout.js`](https://nextjs.org/docs/app/api-reference/file-conventions/layout)
- **Sourced fact:** client transitions made by `Link` keep shared layouts and
  replace the current page with either prefetched content or its loading state;
  a traditional full-page load instead clears state and blocks interactivity.
  [Next.js: Linking and Navigating](https://nextjs.org/docs/app/getting-started/linking-and-navigating)
- **Sourced fact:** React preserves component state while the same component
  remains at the same position in the render tree. Changing its type or `key`
  resets that subtree. [React: Preserving and Resetting State](https://react.dev/learn/preserving-and-resetting-state)
- **Sourced fact:** unlike layouts, Next.js templates are given a unique key and
  remount affected children during navigation, resetting state, effects, and
  DOM. [Next.js: `template.js`](https://nextjs.org/docs/app/api-reference/file-conventions/template)

**Design inference/recommendation:** keep `AppProviders`, `WorkspaceProvider`,
`DesktopShell`, `SidebarProvider`, and the navigation outside page-specific
subtrees. Do not add a pathname key or a `template.tsx` above them. A navigation
between the desktop and handheld route groups intentionally changes shells and
is not expected to preserve desktop-shell state; the target guarantee is
sibling desktop routes in the same locale.

### Use `Link` for internal routes

- **Sourced fact:** `Link` is Next.js's primary internal navigation primitive.
  It extends an anchor with client-side navigation and prefetching. [Next.js:
  `Link`](https://nextjs.org/docs/app/api-reference/components/link)
- **Sourced fact:** Next.js recommends `Link` unless there is a specific need
  for programmatic navigation. `router.push` and `router.replace` from the App
  Router still perform client navigation for imperative flows. [Next.js:
  `useRouter`](https://nextjs.org/docs/app/api-reference/functions/use-router)
- **Sourced fact:** the repository's `next-intl` navigation API wraps the
  corresponding Next.js `Link` and router APIs while adding locale handling.
  Its `Link` keeps the Next.js default prefetch behavior, except when an explicit
  locale prop is used. [next-intl: Navigation APIs](https://next-intl.dev/docs/routing/navigation)

**Design inference/recommendation:** retain the existing locale-aware `Link` for
all ordinary internal links. Keep auditing new code for internal `<a href>`,
`window.location`, and pathname-keyed wrappers. Use `router.push` only after
actions or for interactions that cannot be expressed as links.

### `loading.tsx` makes a dynamic transition immediate without hiding the shell

- **Sourced fact:** a segment `loading.tsx` is nested inside its layout and
  automatically wraps the page and descendants in a Suspense boundary. Its
  fallback is prefetched, navigation is interruptible, and shared layouts stay
  interactive while the new route loads. [Next.js: `loading.js`](https://nextjs.org/docs/app/api-reference/file-conventions/loading)
- **Sourced fact:** for a dynamic route without `loading.tsx`, the browser can
  need to wait for a server response before showing a result. Adding the
  boundary enables partial prefetching and immediate visual feedback. [Next.js:
  Linking and Navigating](https://nextjs.org/docs/app/getting-started/linking-and-navigating)
- **Sourced fact:** a Suspense fallback replaces the entire child tree of its
  nearest boundary. React recommends placing boundaries to match the intended
  reveal sequence, and transitions avoid hiding already revealed outer UI.
  [React: `<Suspense>`](https://react.dev/reference/react/Suspense)
- **Sourced fact:** Suspense does not detect data fetching started only in an
  Effect or event handler. It responds to Suspense-enabled framework data,
  promises read with `use`, lazy code, and streamed Server Components. [React:
  `<Suspense>`](https://react.dev/reference/react/Suspense)

**Design inference/recommendation:** the first boundary should be
`src/app/[locale]/(desktop)/loading.tsx`. Because it is inside the desktop
layout, the fallback replaces only `DesktopShell`'s page child and leaves the
navigation, workspace selector, locale control, and account button interactive.
Do not start with `src/app/[locale]/loading.tsx`: that broader boundary can
replace the whole desktop-layout subtree, including the shell the user expects
to persist.

The shared desktop fallback should be lightweight and geometry-stable: a page
heading placeholder followed by card/table placeholders within the normal main
content width. It needs a localized, screen-reader-visible status. Since this
boundary renders outside the lower route-specific `RouteMessages` layouts, add
any loading copy to a shell-level message namespace rather than depending on a
feature namespace such as `Panel`.

Use nested route or component boundaries only where independent Server
Component or lazy-code regions can reveal separately. Continue using the
existing Convex query gates for post-mount live-data loading; merely wrapping a
Convex `useQuery` component in Suspense should not be assumed to activate the
fallback.

### Prefetching should remain automatic, then be tuned with evidence

- **Sourced fact:** in production, visible `Link` destinations are prefetched
  automatically. Static routes can be fully prefetched; dynamic routes use a
  partial prefetch down to the nearest `loading.tsx` boundary. Prefetching is
  not enabled in development. [Next.js: `Link`](https://nextjs.org/docs/app/api-reference/components/link)
- **Sourced fact:** the Next.js prefetching guide describes dynamic routes
  without a loading boundary as requiring a server round trip on click. Manual
  `router.prefetch()` and hover-triggered prefetch exist, but extending `Link`
  means taking responsibility for cache invalidation and accessibility.
  [Next.js: Prefetching](https://nextjs.org/docs/app/guides/prefetching)

**Design inference/recommendation:** keep `prefetch` at its default for the
desktop navigation. Do not set `prefetch={true}` across every data-heavy route
or `prefetch={false}` globally. After the loading boundary is in place, measure
production navigation before considering intent-prefetch for a small number of
high-value imperative destinations. Table rows with many links are a poor place
for blanket full-route prefetching.

### Pending feedback is secondary to the route boundary

- **Sourced fact:** `useLinkStatus` exposes the pending state of the enclosing
  `Link`. Next.js recommends route-level `loading.tsx` and prefetching first,
  then a subtle inline hint for cases where prefetch has not finished. The hook
  must run in a descendant of `Link`; prefetched navigations may skip the
  pending state. The official example delays its visual treatment by about
  100 ms to avoid a flash. [Next.js: `useLinkStatus`](https://nextjs.org/docs/app/api-reference/functions/use-link-status)
- **Sourced fact:** React transitions are interruptible, avoid replacing
  already visible Suspense content with an unwanted fallback, and expose an
  `isPending` value for local feedback. [React: `useTransition`](https://react.dev/reference/react/useTransition)

**Design inference/recommendation:** add a fixed-size, delayed pending indicator
inside each desktop navigation `Link`, and visually distinguish only the most
recently clicked link. Do not disable the entire navigation: App Router
navigation is intentionally interruptible. Verify `useLinkStatus` in a focused
component test with the `next-intl` wrapper, even though that wrapper documents
that it delegates to `next/link`.

Keep action pending state local to buttons and forms. The locale switcher
already uses `useTransition`; post-mutation `router.push` flows should keep the
submitting action pending until navigation begins rather than introduce a
global router event bus.

## Prioritized implementation plan

### Phase 0 — define and measure the persistence contract

1. Test a production build (`pnpm build`, then `pnpm start`), because automatic
   prefetching is production-only.
2. Record representative same-locale desktop transitions: dashboard to items,
   items to item detail, dashboard to inbound, and inbound to receipt detail.
3. In browser tooling, verify a click requests an RSC/navigation payload rather
   than a new HTML document, and note click-to-feedback and click-to-content.
4. Add a Playwright regression that collapses the sidebar, navigates to a
   sibling desktop route, and asserts that the sidebar remains collapsed, the
   header stays visible, and the active item updates. A second assertion should
   confirm there was no document navigation.

### Phase 1 — add the content-only transition boundary

1. Add a reusable, lightweight route skeleton and a shell-level localized
   loading label.
2. Add `src/app/[locale]/(desktop)/loading.tsx`, rendering only the page-content
   skeleton. Keep `DesktopShell` and `WorkspaceProvider` untouched in the common
   layout.
3. Add the equivalent boundary under `(handheld)` only if handheld navigation
   shows the same measured gap; give it a task-oriented compact fallback rather
   than reusing the desktop geometry.
4. Confirm slow-network navigation keeps the old shell visible and interactive,
   replaces only `<main>`, and allows the user to choose another destination.

### Phase 2 — add precise pending feedback

1. Add a small descendant component inside each navigation `Link` that consumes
   `useLinkStatus`.
2. Reserve its space to prevent layout shift and delay the visible animation by
   about 100 ms so fast prefetched navigations do not flicker.
3. Keep the current active item active until the new route commits; pending and
   active are different states. Do not mark all links busy or disable the nav.
4. Cover the pending/active interaction, rapid second navigation, keyboard
   activation, and reduced-motion presentation in component tests.

### Phase 3 — refine slow pages without conflating loading phases

1. Identify pages whose destination shell appears quickly but whose Convex data
   takes materially longer.
2. Reuse or refine `QueryGate`/`LedgerPanelStatus` skeletons so they match the
   final table, card, or workbench geometry rather than showing a generic block.
3. Add nested `loading.tsx` or Suspense boundaries only for route segments,
   Server Components, or lazy chunks that truly suspend. Do not wrap every
   client query mechanically.
4. Consider manual intent-prefetch only for measured high-value programmatic
   destinations that are not already represented by visible `Link` elements.

### Phase 4 — guard the architecture

1. Add a lightweight source check or review rule: internal app routes use the
   locale-aware `Link`/router; plain anchors are limited to same-document or
   external navigation.
2. Reject `template.tsx`, pathname keys, or page-owned copies of shell providers
   above sibling desktop routes unless resetting state is an explicit feature.
3. Track navigation latency separately from query-ready latency so future work
   optimizes the actual bottleneck.

## Acceptance criteria

- On a same-locale desktop page change, the navigation and header never
  disappear and remain usable while content loads.
- Sidebar collapsed/open state and workspace selection survive sibling desktop
  navigation; the workspace query/subscription is not restarted because of a
  shell remount.
- The destination renders either final content or a content-only fallback
  promptly after activation; a delayed per-link pending hint covers slow or
  incomplete prefetch.
- The browser performs client navigation rather than loading a new document for
  internal links.
- The old active item remains active while a clicked item is pending; the new
  active item changes only after the pathname commits.
- Route loading, Convex query loading, empty data, authorization failure, and
  application error remain visually and semantically distinct.
- Production tests cover desktop sibling routes, dynamic detail routes, rapid
  navigation interruption, keyboard use, and a throttled network.

## Recommended first delivery slice

Ship Phases 0–2 together: one persistent-shell regression test, the shared
desktop `loading.tsx` skeleton, and delayed pending feedback in navigation.
That slice directly addresses the perceived reload without redesigning data
fetching. Use the measurements from it to decide which pages, if any, warrant
route-specific skeletons or manual prefetching.
