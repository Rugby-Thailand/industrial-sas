# Local performance evidence

Use an isolated worktree and a fresh local Convex backend with test Clerk
credentials. Never point these scripts at production. Run the repository's
existing local setup and `pnpm dev:seed --pagination --storage-ui`; the scripts
read its ignored `output/local-test-data.json`. `.env.local` needs the loopback
app/backend URLs, test `CLERK_SECRET_KEY`, and local seed opt-in. Identity defaults
match the local seed; `LOCAL_TEST_CLERK_USER_ID`/`LOCAL_TEST_CLERK_ORG_ID` override
them. Do not save tickets, JWTs, browser storage state, or business records in
the evidence report.

Use a completed production build and its matching environment. For example:

```sh
NEXT_DIST_DIR=.next-preview pnpm exec next build --webpack
NEXT_DIST_DIR=.next-preview pnpm exec next start --hostname localhost --port 3235
PERFORMANCE_BASE_URL=http://localhost:3235 PERFORMANCE_BUILD_DIR=.next-preview PERFORMANCE_REVISION=$(git rev-parse HEAD) node scripts/performance/measure.mjs after
PERFORMANCE_BASE_URL=http://localhost:3235 node scripts/performance/verify-local.mjs
```

The hostname must match the app URL. `measure.mjs` requires a local production
`BUILD_ID`, loopback Next/Convex URLs, `sk_test_` credentials and
`ALLOW_LOCAL_TEST_SEED=true`. It reads `.env.local` and
`output/local-test-data.json` by default. `PERFORMANCE_ENV_FILE` and
`PERFORMANCE_FIXTURE_FILE` can select the reviewed isolated QA files without
copying credentials into another checkout. `PERFORMANCE_BUILD_DIR` defaults to
`NEXT_DIST_DIR`, then `.next`. The Next public backend URL is compiled into the
build: use the same isolated backend for build and measurement.

The default selected scenarios are `floor,scan`, in English at desktop 1440×900
and mobile 390×844. Each direction and cache condition needs **20 completed
samples**, after two excluded warm-up runs. Use the following parameters to keep
one collection/review cycle bounded:

| Variable                | Values / default                                             |
| ----------------------- | ------------------------------------------------------------ |
| `PERFORMANCE_SAMPLES`   | Integer 20–200; default 20                                   |
| `PERFORMANCE_WARMUPS`   | Integer 1–10; default 2                                      |
| `PERFORMANCE_SCENARIOS` | Comma-separated `floor,scan,hr,legacy`; default `floor,scan` |
| `PERFORMANCE_WIDTHS`    | `1440`, `390`, or both; default both                         |
| `PERFORMANCE_LOCALES`   | `en`, `th`, or both; default `en`                            |
| `PERFORMANCE_NETWORK`   | One of `none` (default) or `latency150`                      |

For a selected HR measurement, seed the isolated fixture with `--hr`. The
script reads an existing list row, opens its real edit control and returns with
the app's Back button; it makes no changes to the employee. No HR delay has
been established by this measurement code. `legacy` retains the existing
catalogue/product/storage document loading, decoded/transfer JavaScript, long
tasks and bounded Convex catalogue queries. Its three-run loops now use the
same sample and warm-up parameters. Legacy and Vite fixture measurements
require the unthrottled profile.

Actual application directions and data-ready endpoints:

| Direction                 | Loaded outcome                                                   |
| ------------------------- | ---------------------------------------------------------------- |
| Storage catalogue → Floor | Visible first actual map zone and loaded Building floors toolbar |
| Floor → storage catalogue | Visible seeded building anchor                                   |
| Finished goods → Scan     | Visible location-step heading and seeded location control        |
| Scan → finished goods     | Visible loaded product link                                      |
| HR list → employee editor | Visible initialized display-name input                           |
| HR editor → list          | Visible loaded edit control and no visible editor                |

`urlObservedMs` measures from immediately before the real app control's
programmatic click until its expected pathname/query is observed at an
animation frame. It is a **URL proxy**, not a React route-shell commit.
`dataReadyMs` uses the same origin and waits for the route's loaded outcome;
retained content under `hidden`, `aria-hidden` or `aria-busy` cannot satisfy
readiness. No history wrappers or synthetic events are installed.

Navigation timers finish on readiness, timeout, a superseding URL/link,
page errors or unmount, and remove their listeners/frame. Page closure or an
unusable setup becomes a fixed status/reason without logging exception text.
Cancelled/error rows retain elapsed time when the timer was armed; they are
reported separately and excluded from latency
percentiles; warm-up failures are reported, too. A flow stops after three
errors or ten extra attempts, writes its available evidence and exits nonzero
if it did not complete the requested samples. Errors in initial authentication
or fixture setup stop the run and are reported as setup failure; they are not
passing timing samples.

Cold navigation means a fresh authenticated browser context with the source
already loaded; its shared assets and automatic Next prefetch may be present.
Warm navigation retains the same context and uses actual controls to revisit
routes after warm-up. OS, Clerk and backend caches are retained in both cases.
These are controlled context/cache protocols, not claims of fully cold backend
or disabled prefetch. Legacy warm loading reloads in the same context.
`latency150` applies Chromium CDP HTTP latency 150 ms, download 200000 B/s and
upload 93750 B/s. It does not establish shaping of Convex's persistent WebSocket
messages; report that limit when reviewing the controlled-network results.

The ignored JSON records source revision (when supplied), build/browser
versions, machine, protocol, numeric rows and nearest-rank descriptive p50/p95.
Source provenance includes actual Git HEAD, the dirty-worktree flag and the
current navigation-provider blob hash. A dirty source is labelled as a working
implementation, never as baseline HEAD. Build only the frozen source measured
in that cycle; retain the build ID alongside the source provenance.
Neither raw query text, entity IDs, URLs, draft contents nor personal data are
written. Labels must be simple filenames. No production telemetry is enabled.
Twenty local samples remain descriptive; this is not deployed field evidence
or a before/after optimization claim.

`verify-local.mjs` creates one synthetic product on the loopback backend. It
verifies the actual optimistic updater with the installed Convex client's
confirmation, server normalization and business rejection rollback, then checks
server-result searching/paging/sorting and form draft recovery/confirmed saves
in Thai/English at desktop/mobile widths. It retains only numeric/status output
and screenshots of synthetic fixtures in ignored `output/performance`.

For production builds of the existing UI fixture harnesses:

```sh
pnpm exec vite build --config scripts/storage-workspace-preview/vite.config.mjs --outDir ../../out/performance/workspace
pnpm exec vite build --config scripts/barcode-scanning-preview/vite.config.mjs --outDir ../../out/performance/scanning
```

Serve the built workspace and scanning fixtures with Vite preview on ports
3236 and 3237. The scanning build also needs the repository's
`public/barcode/zxing_reader.wasm` at its `/barcode/` path. Then:

```sh
PERFORMANCE_SAMPLES=20 node scripts/performance/measure-fixtures.mjs after
```

Optional `PERFORMANCE_WORKSPACE_URL`/`PERFORMANCE_SCANNING_URL` select other
loopback ports. The fixture script reuses the same validated sample, warm-up, viewport and
locale options and records numeric p50/p95 summaries. Its fixed scenarios stay
separate from authenticated Scan navigation. This measures 198 map positions, the already paginated 25-row
list, page/map switching, and six real barcode photos through the current
worker-backed image picker. It does not measure a physical camera. The older
`runBarcodePhotoRegression` function exercises a legacy direct decoder and is
not representative of current image-picker UI responsiveness.

Run benchmarks sequentially, without simultaneous builds or test suites. Keep
machine, fixture data, viewport, locale, browser revision and cache protocol
constant. Freeze baseline source with `git archive` from the named main commit
inside the isolated worktree. For the compiler control, copy the candidate's
tracked/untracked source into an ignored lab directory, use the same installed
dependencies/fixtures and change only `reactCompiler: true` to `false`. Never
mix another checkout's unfinished source into a comparison.

Results are ignored numeric JSON files in `output/performance`. Persist the
selected summaries and measurement conditions in the evidence report; report
increases, inconclusive timings and limitations as well as improvements.

The maintained helper checks run with:

```sh
pnpm exec vitest run --project integration tests/integration/performance-measurement.integration.test.ts
```

They cover timer invalidation, retained hidden content, percentile inclusion
and evidence option bounds; real authenticated application QA remains a
separate gate.
