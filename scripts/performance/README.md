# Local performance evidence

Use an isolated worktree and a fresh local Convex backend with test Clerk
credentials. Never point these scripts at production. Run the repository's
existing local setup and `pnpm dev:seed --pagination --storage-ui`; the scripts
read its ignored `output/local-test-data.json`. `.env.local` needs the loopback
app/backend URLs, test `CLERK_SECRET_KEY`, and local seed opt-in. Identity defaults
match the local seed; `LOCAL_TEST_CLERK_USER_ID`/`LOCAL_TEST_CLERK_ORG_ID` override
them. Do not save tickets, JWTs, browser storage state, or business records in
the evidence report.

Build with `pnpm build`, run `pnpm exec next start --port 3235`, then run:

```sh
PERFORMANCE_BASE_URL=http://localhost:3235 node scripts/performance/measure.mjs after
PERFORMANCE_BASE_URL=http://localhost:3235 node scripts/performance/verify-local.mjs
```

`measure.mjs` records numeric lab evidence for cold/warm catalogue loading,
product navigation/detail loading, storage loading, initial decoded/transfer
JavaScript, long tasks and bounded Convex catalogue query timings. Three runs
per locale/viewport use a new browser context for cold loading and reload the
same context for warm loading. Browser/OS caches and local backend caches are
not cleared: these are browser-context lab comparisons, not field percentiles.
Product details are route-warm because shared assets were already loaded.
Navigation ends when the product form is usable; storage ends at the first
actual map zone. Two animation frames flush buffered long-task observations.
Queries include the continuation requests needed for a sparse complete-result
search. No rows or query payload contents are written to results.

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
node scripts/performance/measure-fixtures.mjs after
```

Optional `PERFORMANCE_WORKSPACE_URL`/`PERFORMANCE_SCANNING_URL` select other
loopback ports. This measures 198 map positions, the already paginated 25-row
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
