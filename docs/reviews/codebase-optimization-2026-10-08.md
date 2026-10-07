# Measured optimization review — October 8, 2026

Base: `278292a15c57dd519c4c49534273cb1512051a29`.
Implementation: Kiro CLI `claude-opus-5.5`, high effort, three scoped tasks.
Measurement and verification: Codex, Node 24.19.0 / pnpm 10.33.2, macOS arm64,
10 available CPU threads. Work took place in an isolated checkout with a frozen
lockfile install; the original checkout's existing work was preserved.

## Retained changes and why they are worthwhile

### Pure tests run without browser setup

Move 35 DOM-free unit files to `unit-node`. Keep JSX/component tests, the three
browser-dependent `.test.ts` files, and accessibility tests in jsdom. The
`test:unit` script runs both unit projects. Remove eleven nonexistent entries
from the Convex runtime include list and share the accessibility glob.

Independent discovery comparisons found the same 126 files / 1,064 original
tests, with no missing, added, or duplicated tests. The isolated pure cohort
contains 230 tests. Three alternating before/after pairs, with one worker and
the same patched dependency lockfile, produced these Vitest durations:

| Measurement           |      Before |      After |
| --------------------- | ----------: | ---------: |
| Pure cohort, sample 1 |     24.99 s |     5.56 s |
| Pure cohort, sample 2 |     24.94 s |     5.62 s |
| Pure cohort, sample 3 |     25.19 s |     5.44 s |
| Pure cohort, median   | **24.99 s** | **5.56 s** |
| Whole suite, sample 1 |     25.55 s |    28.21 s |
| Whole suite, sample 2 |     30.48 s |    22.64 s |
| Whole suite, sample 3 |     31.91 s |    29.97 s |
| Whole suite, median   |     30.48 s |    28.21 s |

The pure cohort is **77.8% faster in this controlled one-worker comparison**.
Its setup phase fell from about 5.5 seconds to zero and its environment phase
from about 14 seconds to roughly 2 milliseconds. The full-suite median is 7.4%
lower, but those timings overlap substantially; they do not establish a robust
whole-suite or CI speedup. One initial pair showed a reported-duration versus
monotonic-clock anomaly; the entire pair was excluded and replaced.

Reproduce the cohort comparison by exporting the base `vitest.config.mts` to a
temporary config in this checkout, obtaining the `unit-node` file list with
`vitest list --json`, and passing those same files to each configuration with
`--maxWorkers 1`. Preserve the patched lockfile for both variants. Full-suite
comparisons use `vitest run --config <configuration>` with unchanged worker
settings. Detailed local logs and JSON observations are in
`.cache/optimization-2026-10-08/`.

### Blank location search skips unused text work

After existing search normalization, return `zones.slice()` for a zero-word
query. This retains order, zone object identity, and a fresh mutable result
array. Nonempty search keeps the existing text normalization and word-AND
matching path. The change adds one direct early return and its explanation.

Three regression tests cover blank/Unicode whitespace, avoiding detail reads,
and matching position/placement fields across words. The detail-read test fails
against the old implementation and passes against the new one.

An offline, warmed, alternating comparison used five pairs of batches of 60
calls against an unchanged copy of the original function. Both variants returned
equal results for blank, whitespace, multiword, and missing-item searches.

| Synthetic fixture                                  | Blank search before | Blank search after |
| -------------------------------------------------- | ------------------: | -----------------: |
| 24 locations, 12 positions and 10 placements each  |      0.0827 ms/call |    0.00053 ms/call |
| 300 locations, 50 positions and 30 placements each |      3.5828 ms/call |    0.00049 ms/call |

Nonempty-search timings remained similar: about 0.084 ms for the small fixture
and 3.65–3.73 ms for the large fixture. These synthetic Node timings demonstrate
removed work; they are not browser interaction latency or production usage data.

### Catalogue and product editing have separate client modules

Split the former 961-line `ProductScreens.tsx` into focused catalogue and product
screen modules, plus a four-line compatibility facade. Three route imports now
target the screen they use. Total source grows by 20 lines because each module
has explicit imports; the improvement is a smaller dependency graph and clearer
workflow ownership. No additional loading states or asynchronous import steps
were introduced.

Codex's TypeScript-printer comparison found all eight original function/type
declarations unchanged. The existing catalogue/product and accessibility suites
pass unchanged: two files, 81 tests.

`pnpm exec next experimental-analyze --output` before and after showed:

| Catalogue browser-output analysis |    Before |     After |
| --------------------------------- | --------: | --------: |
| JavaScript output-part bytes      | 1,501,598 | 1,416,817 |
| Application-source part bytes     |   205,832 |   126,656 |

The route graph has **84,781 fewer JavaScript bytes (82.79 KiB, 5.65%)** and 38.5%
fewer application-source part bytes. `ProductBatches`, `BatchManager`,
`PalletScene`, the storage scene components, and their geometric helpers are
absent from the catalogue's analyzed browser output. These are analyzer part
totals across the route graph, including reachable chunks; they do not establish
initial transferred bytes, gzip savings, Web Vitals, or authenticated page latency.

### Required dependency audit passes

The baseline production audit reported one high-severity advisory in `sharp`
0.35.4. Raise the existing Next-specific override to `^0.35.5` and update only
the corresponding lockfile/native-image dependency entries. The package
maintainer identifies 0.35.5 as the patched version.
[Sharp advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w)

The installed native dependency reports sharp 0.35.5 / librsvg 2.63.2. A create,
resize, PNG encode/decode smoke check passed. The final production audit reports
no known vulnerabilities, and the production Next build passes.

## Final local verification

- `pnpm check`: typecheck, zero-warning lint, **126 files / 1,067 tests passed**.
- `pnpm build`: passed.
- `pnpm audit:prod`: passed, no known vulnerabilities.
- Targeted catalogue/product accessibility and selector checks: passed.
- Test discovery and AST comparisons: passed.
- Scoped formatting and diff whitespace checks: passed.
- Independent read-only Codex review of imports, client boundaries, test
  discovery, dependency override, and measurement claims: no blocking findings.

No authenticated production-browser performance claim is made. GitHub's PR
checks and merge state provide the delivery result after local verification.

## Remaining evidence-gated work

Keep the research backlog for real subscription/database bandwidth measurement,
production browser smoke coverage with synthetic tenants, field Web Vitals,
profiled map interactions, compiler adoption, and human-checked ticket extraction
evaluation. Camera lazy loading, translation scoping, and query-local read reuse
already existed. None warrants a broad rewrite without measurements.

The finish target remains October 9 at 07:00 Bangkok. Successful, verified work
may finish earlier; no unattended scheduler has been created by this patch.
See the [plan](../plans/codebase-optimization-2026-10-08.md) and
[primary-source research](../plans/codebase-optimization-research-2026-10-08.md).
