# Real Next navigation regression app

Run from the repository root, with the pinned Bun on PATH:

```sh
pnpm build:navigation
pnpm exec playwright install chromium firefox webkit
PLAYWRIGHT_REQUIRE_BUILD=1 pnpm test:e2e:navigation
```

Playwright runs on Node. The production Next 16.3.8 build and server run on
Bun, without dotenv loading, at `http://127.0.0.1:3265`. The server always starts
a fresh instance; it cannot reuse a developer's server. Output belongs to this
app's `.next`, independent of the normal application's `.next`.

The app imports the actual `NavigationGuardProvider`, `NavigationProgressProvider`
(and its `trackAppHistory`), `NavigationContent`, locale navigation adapter,
`useFloorWorkspaceView` used by the Floor workspace, and `useHrListCriteria`. It does
not copy or simulate Next's patched history APIs. Turbopack has an explicit
repository root and source alias (relative to the fixture app);
`next-intl/config` aliases the real locale request configuration directly; the local TypeScript alias also resolves real
repository sources. React compiler and StrictMode match the normal application.
The locale provider surrounds progress → guard → content, matching the relevant
shell listener mount order. Normal locale request configuration and messages are
shared. The tests assert both native URL and Next's query reader.

Fixtures are under `scripts/`, outside `src/app`; they cannot become normal app
routes. `/fixture-save` is a synthetic response with no data access. Tests hold
that request to observe pending saves, then release it. The queued-removal case
calls the public draft `settle` handoff and registers B in the same JavaScript
task after the provider queued native Back. It never patches history traversal,
fabricates popstate, or synchronizes the guard using a timer.

Eight critical scenarios run in desktop Chromium, mobile Chromium, Firefox and
WebKit. The CI navigation matrix leg explicitly installs all three engines and
builds this app separately. Shared reporting retains synthetic failure artifacts
and zero retries. Exhaustive continuation races belong to provider unit tests.

This is framework/history integration coverage, not authenticated application
coverage. Clerk, Convex, auth/backend middleware, theme/search/sidebar providers,
real Floor forms and mutations, HR backend lists, Scan, telemetry and production
headers are omitted. Fixture drafts exercise the provider contract and Floor's
true-returning React-clean save pattern; they do not prove two-registration
reachability in the real Floor screen. Authenticated Floor/HR/Scan verification
requires separate test credentials and isolated data.
