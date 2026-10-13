# CI/CD speed: tested implementation on free runners

Date: 2026-10-13. Target: **3–4 minutes from a main push to verified production**, using existing free GitHub runners and the current Vercel plan. This supersedes the earlier under-two-minute proposal. Staging is temporarily disabled for the pre-user phase. No paid capacity or credential relocation is selected.

## Baseline and selected changes

The last inspected main run, [38350247746](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38350247746), took 747 seconds: quality completed after 170 seconds, staging took 322 seconds, and production took 244 seconds. An earlier run took 620 seconds. Removing staging alone would leave approximately seven minutes in the newer sample; it would not meet the revised target.

The production deployment's largest avoidable serial phase was Next's TypeScript check: **45.657 seconds** after compilation. Browser installation added another **30 seconds** before the release controller even started. Provider-ready detection lagged by **7.695 seconds** with ten-second polling. Full phase evidence is in [production-remote-phases.md](../reviews/ci-speed-2026-10-13/production-remote-phases.md).

| Change                                | Implementation                                                                                                                      | Evidence and boundary                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Temporarily skip staging              | Set the existing repository variable `STAGING_ENABLED=false`; retain the staging job and policy                                     | Both enabled/disabled policy branches remain covered; the setting was read back after the change                            |
| Parallelize validation                | Separate style, types, lint and audit matrix lanes                                                                                  | Required aggregate still joins all lanes and every existing test/browser/codegen suite                                      |
| Check frontend types once per release | Required types lane runs both the pinned Bun checker and `next typegen && tsc --noEmit`; gated builds set `CI_EXTERNAL_TYPECHECK=1` | Pinned TS6, project options, application scope and generated route validators are tested; ordinary builds keep Next's check |
| Overlap quality browser setup         | Build the smoke/navigation app while downloading its browsers; join both before clean-tree and browser tests                        | Either failure blocks the quality gate; release browser setup still succeeds before the controller starts                   |
| Avoid unused browser payload          | Install Chromium's headless shell with `--only-shell`                                                                               | All existing smoke/workspace tests retained; navigation still installs and tests Chromium, Firefox and WebKit               |
| Detect provider readiness sooner      | Poll every three seconds instead of ten                                                                                             | Same provider state, deadlines, promotion conditions and release outcomes                                                   |

The release path remains: **all quality gates → protected production job → backup → coupled Vercel/Convex build → candidate smoke → promotion → live smoke**. Only credential-free quality preparation overlaps builds and browser installation; production installs its browser before the release controller can mutate anything. Production backend credentials remain at Vercel; the release job keeps its existing backup credential, lock, source checks, recovery records and fresh dependency installation.

## Experiments and decisions

- [Hosted PR run 38354107441](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38354107441) passed the full quality gate in **141 seconds**, before the final quality preparation overlap change. This is a PR quality measurement, not push-to-live proof.
- [Paired standard-runner probe 38355028866](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38355028866): the same workspace shard took 73 seconds with two workers and 71 seconds with four; smoke took 33 versus 39 seconds. Installation varied from 17 to 42 seconds. Retain two workers: whole-job differences do not establish a benefit from four.
- The official Playwright container cost 27–39 seconds to start. It also needed `unzip`, and its navigation trial stopped at Git's ownership guard before tests. It has not demonstrated an improvement. Remove the temporary probe and image helper from the merged workflow.
- A secret-free prebuilt Vercel experiment passed on hosted Linux: [run 38353981209](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38353981209), 131-second job, 92-second build. Local output/runtime experiments also passed, but a production design would require artifact provenance, runtime configuration and backend-release changes. Remove that prototype; it is not needed for the selected first implementation. See [prebuilt-spike.md](../reviews/ci-speed-2026-10-13/prebuilt-spike.md).
- Custom images/paid runners were investigated and rejected under the user's free-runner constraint. No account upgrade or runner purchase occurred.
- A release-browser overlap prototype passed 17 focused process/failure tests, but review showed that an install failure could occur after a backend push. Joining before deployment leaves only about three seconds of backup/preflight overlap. Reject the prototype, preserve the existing no-deployment-on-install-failure boundary, and parallelize only credential-free quality preparation. Native-cancellation behavior was also tested and fixed in the discarded prototype.
- Sol 6.1 agents handled workflow, timing/typecheck and release preparation work. Kiro reviewed architecture and the implementation. Review findings are resolved before merge; experiments are distinguished from selected changes.

## Why the TypeScript change preserves validation

The installed Next 16.3.8 documentation explicitly requires a separate type check when `ignoreBuildErrors` is enabled. The selected required command uses the same pinned TypeScript 6.0.3 and repository config, regenerates route validators, and checks a broader scope than Next's filtered build check. Tests run the actual config loader and compiler, reject bad application/generated route types, and verify default builds do not skip validation. The Bun check remains too.

Workflow policy requires the exact types commands and matrix conditions, rejects a skipped/softened required gate, and protects command execution from shell overrides. The quality aggregate must pass for the exact source before release. `CI_EXTERNAL_TYPECHECK=1` is an explicit gate-controlled opt-in, not proof on its own. See [external-typecheck-proof.md](../reviews/ci-speed-2026-10-13/external-typecheck-proof.md). Convex's own production typecheck remains unchanged.

## Verification and rollout

Before merging, require the latest-head full GitHub quality and CodeQL checks, relevant release/workflow regression suites, formatting, ESLint, both typecheck commands, and an independent review. Focused quality preparation tests must prove both child commands are joined, either failure blocks tests, and cancellation cleans up owned children. Production candidate/live smoke continues to use its single successful pre-controller installation.

After merging, observe the normal main workflow through verified live. Record workflow creation, quality completion, release start, deployment READY, promotion, live smoke and workflow completion. Report both verified-live elapsed and complete workflow elapsed. Do not use a successful PR run, a skipped/superseded release, or estimated subtraction as a production result.

The revised target remains **3–4 minutes**, with limited margin. Removing the repeated TypeScript check and overlapping quality preparation should reduce the critical path; the rejected release-browser overlap cannot count as a saving. Complete hosted production timing is still required. The previous uncached dependency install took 68 seconds in one sample versus an assumed normal setup around 20 seconds; free-runner/network variance can therefore miss the target. One successful rollout does not establish p95. Collect representative subsequent runs, including dependency/cold-cache changes, before promising a sustained percentile.

## Rollback and restoring staging

Revert the optimization PR to restore serial quality preparation, original validation grouping and ten-second polling. Keep the workflow command/config/policy changes together when reverting the external typecheck flag. A source-code revert does not change the repository variable.

Restore staging before first user onboarding or a customer pilot, then require a successful enabled-staging release:

```sh
gh variable set STAGING_ENABLED --repo Rugby-Thailand/industrial-sas --body true
```

The temporary staging switch is independent of the implementation and remains available immediately. Restoring the staging gate adds its duration back to the critical path and requires a new latency budget.
