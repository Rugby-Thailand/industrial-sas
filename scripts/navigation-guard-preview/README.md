# Real Next navigation regression app

Run from the repository root, with the pinned Bun on PATH:

```sh
pnpm build:navigation
pnpm exec playwright install chromium firefox webkit
PLAYWRIGHT_REQUIRE_BUILD=1 pnpm test:e2e:navigation
```

Playwright runs on Node. The production Next.js build and server run on
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

After a document reload, native traversal waits for the shell's explicit
`navigation-ready` marker, published in a commit after the initial passive
effects attach history listeners. A visible server-rendered heading does not
prove hydration has finished. Traversing before hydration can let Next's
initial canonical-URL replacement overwrite the newly visited entry; these
regressions cover the hydrated application's history behavior.

Fixtures are under `scripts/`, outside `src/app`; they cannot become normal app
routes. `/fixture-save` is a synthetic response with no data access. Tests hold
that request to observe pending saves, then release it. The queued-removal case
calls the public draft `settle` handoff and registers B in the same JavaScript
task after the provider queued native Back. It never patches history traversal,
fabricates popstate, or synchronizes the guard using a timer.

Navigation scenarios run in desktop Chromium, mobile Chromium, Firefox and
WebKit. Axe runs in the two Chromium projects. The CI navigation matrix leg
installs all three engines and builds this app separately. Shared reporting
retains synthetic failure artifacts and uses zero retries. Exhaustive
continuation races belong to provider unit tests.

The Home scenarios mount the production dashboard route and its desktop shell,
theme, sidebar, search, and history providers. The Storage round trip mounts the
existing building workspace with synthetic records. Both use the production CSS
and PostCSS configuration. Legacy navigation-fixture styling is scoped to the
older generic routes and their portal dialogs.

The preview aliases Clerk identity and Convex hooks to credential-free
substitutes. Only the Home preference mutation accepts a write. It posts to
the synthetic response and updates tab-local fixture data so a reload can
verify readback. This browser suite tests application behavior with those
boundaries. Trusted staging tests exercise Clerk and Convex directly.
