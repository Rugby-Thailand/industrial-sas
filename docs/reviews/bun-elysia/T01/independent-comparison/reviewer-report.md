# T01 independent comparison — accepted locally

Exact candidate: `f7d197dc886c3e79f79bb656b91613ded761cace`. Independent detached worktree: `<independent-worktree>`.

The predefined correctness and local timing acceptance both pass. This result supports adopting the standalone Bun checker on this candidate; it does not establish Linux CI, application/browser/provider/build/runtime improvements or release success.

## Preparation and execution

- Original candidate benchmark bytes preserved at `original-candidate-evidence/` before installation or rerun. Complete replacement raw output preserved at `benchmark/`; measured worktree output remains intact.
- `pnpm install --frozen-lockfile`: exit 0, 7.1375s wrapper elapsed; clean dependency tree, warm pnpm store. This is preparation, not an install comparison.
- `node scripts/ci/install-bun-checker.mjs`: exit 0; official archive SHA-256 `80afd4c069b46a6fa8f3ec520bebc750a7843e4a8d5b9583d29ad436c00a3403`, binary SHA-256 `28c7dd0a06916aba284d570ef44a2d70e9c538eaf2ba58dfe0910525563b3f79`.
- Focused installer/workflow tests: 2 files / 59 tests passed, exit 0, serially before timing.
- Foreground `node scripts/benchmark-typecheck.mjs --samples=10`: external captured exit **0**, 607.788115s, 2026-10-11 06:06:08.504856–06:16:16.295739 UTC. No overlapping tests/builds/benchmarks initiated by this agent; coordinator held its runs until completion.
- Node v24.19.0; pnpm 10.33.2; TS6 6.0.3; Next 16.3.8; Bun 1.4.3+c6da4a4d3 / embedded TS7.0.2; macOS arm64. Versions, host and commands are in `benchmark/environment.json`.

## Independent correctness verification

Both checkers select identical **775** project inputs (4 generated `.next/types` files plus `next-env.d.ts` included), no scope problems or checker-only inputs. Both checker-only and whole commands reject deliberate TS2322 errors in source, tests, Convex and generated route types; generated guards survive typegen. TS6 negative exit is **2** and Bun negative exit is **1**. Both reject an edit under a primed TS6 incremental cache and pass after byte-for-byte restoration. Bare `bun check` dispatches the package script and accepts the error in the collision probe; `bun --check` rejects it.

All **90 timed observations** have exit 0/no signal: ten observations for each of nine profiles. All ten raw order blocks match the prescribed forward-on-odd / reversed-on-even ordering. All paired full-command, cached-command and edited-checker observations favor Bun, including all five forward and all five reversed blocks in each comparison. Paired differences are in `independent-analysis.json`.

## Measurements

| Profile            | Observations | Median seconds |     Min–max seconds |
| ------------------ | -----------: | -------------: | ------------------: |
| command-ts6-full   |           10 |      16.199550 | 15.453690–17.104454 |
| command-ts6-cached |           10 |       4.116207 |   3.920450–4.931450 |
| command-bun        |           10 |       2.043833 |   1.957480–2.316920 |
| checker-ts6-edited |           10 |       6.050737 |   5.918496–6.191271 |
| checker-bun-edited |           10 |       0.959281 |   0.859966–1.074754 |

Whole-command median TS6/Bun ratio is **7.926× full** and **2.014× primed-cache**. Edited checker comparison is **6.308×**. These comparisons include equivalent warm filesystem/dependency conditions. Full TS6 disables incremental reads/writes; cached commands use a separately primed default build-info file; edited checker observations use a separate primed TS6 cache and one fresh valid export per observation, restored outside the timed process. Bun checks the full project without build-info caching. Type generation is included in whole-command observations and measured separately (median 1.183794s).

Distributions are disjoint for the accepted comparisons; every paired observation improves in both orders. There is chronological variability and uncontrolled workstation activity (sampled one-minute load average 3.301–14.763); this does not reverse any paired result. Measurements are local warm-filesystem tooling wall times, not cold-machine or field percentiles.

## Freeze and telemetry conditions

All **1,291 non-benchmark tracked files** are byte-identical before/after; no new unrelated unignored files. Harness fingerprints cover **4,237 files**, including selected installed declarations and generated route types, and before/after maps match exactly. Bun binary digest also remains unchanged. Completion marker has `allAssertionsPassed:true`, 90 samples / ten per profile, candidate SHA above, harness SHA-256 `415fd6f36cef2c9a9c6c7e060abf6ceb45202afc51692258c12089497bafcbd3`, input-map SHA-256 `33815b9a506db2f705dbabee3b27ba4d35bde2544c330a87715affa07baf99db`.

No env files are present; NODE_ENV and CI are absent, NO_COLOR is present, no initial `.next/cache`. I did **not** explicitly set NEXT_TELEMETRY_DISABLED before launch. Inherited approved flags NEXT_TELEMETRY_DISABLED, NEXT_PUBLIC_OBSERVABILITY_SINK, NEXT_PUBLIC_SENTRY_ENABLED, NEXT_PUBLIC_SPEED_INSIGHTS_ENABLED and SENTRY_ENABLED are absent; provenance is in `telemetry-conditions.json`. No environment mutation occurred during comparison. No env-file contents, DSNs, credentials or providers were read/called.

A reviewer-only post-analysis assertion initially assumed every negative probe used exit1; TS6 correctly uses exit2. The corrected external analysis requires nonzero exit and exact expected diagnostics and passes. This did not affect the harness, source or samples; metadata records the correction.

## Remaining gates

The coordinator's full local gates are reported separately. Linux protected CI, final PR head-match verification and automatic staging/production release remain required. Adding evidence-only artifacts can be checked without changing measured implementation; integrating source/lock/config/generated-input changes invalidates this exact candidate comparison and needs affected reruns. Rollback follows the T01 plan's scoped checker/CI revert while retaining accepted fixture corrections.

## Portable repository delivery

Complete untouched original evidence, preparation logs, source-hash maps and replacement benchmark maps are in the sibling `../industrial-sas-delivery-preserved-20261011/T01/independent-comparison/` bundle. Delivered JSON retains measurement values, with formatting and portable path normalization recorded in `delivery-preservation.json`. The identical complete before/after input map is delivered once as `benchmark/input-fingerprint.json.gz`, with original/compressed hashes in `benchmark/fingerprint-receipt.json`. Source hashes are also covered by that complete map. The original candidate benchmark is the unchanged T01 `../benchmark/` directory. Final PR-head approval requires the declared repeat on the subsequent evidence-only commit.
