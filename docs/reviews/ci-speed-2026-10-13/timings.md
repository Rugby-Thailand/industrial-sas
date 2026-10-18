# GitHub Actions timing evidence — 2026-10-13

Read-only research; no workflow changes, dispatches, deployments, or artifact downloads; release logs were parsed in memory into an allowlist of event timestamps only. Source is GitHub's Actions run/jobs metadata API (job/step start and completion timestamps). Seconds are wall time, not CPU time. Step timestamps have one-second precision; skipped steps can have zero/negative duration and are excluded from meaningful duration calculations.

## Which workflow is being measured

Remote `main` at collection: `0bbd285f8b05f36f4ae7bb55fbf9b4aab65184d0`. Local HEAD: `733c6acad348f1c024ef033f9d6ae8300e45e363`; `.github/workflows/quality.yml` is also dirty. The [remote workflow at measured SHA](https://github.com/Rugby-Thailand/industrial-sas/blob/0bbd285f8b05f36f4ae7bb55fbf9b4aab65184d0/.github/workflows/quality.yml) has browser smoke, navigation, workspace-1 and workspace-2 legs, Bun typecheck, and captured `STAGING_ENABLED` policy. The dirty local workflow has smoke/workspace only, tsc typecheck, and always-required staging. Therefore local benchmark results are **not** automatically performance measurements of current main. The source snapshot is `remote-quality.yml`; never copy it over the user's working workflow.

## Ten latest successful main runs

The sample intentionally includes only completed successes, so it cannot quantify failure rate or cancellation waste. Gate = created-to-`check` completion. Total = created-to-run updated time, which may include brief metadata finalization. Latest run is the only sampled run with the navigation browser leg. All sampled runs actually executed staging; none measures disabled staging.

| Run                                                                                      | SHA        | Total s | Gate s | Staging job s | Production job s |
| ---------------------------------------------------------------------------------------- | ---------- | ------: | -----: | ------------: | ---------------: |
| [38347275340](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38347275340) | `0bbd285f` |     620 |    201 |           232 |              179 |
| [38344283142](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38344283142) | `2d164bc3` |     582 |    146 |           250 |              176 |
| [38300478653](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38300478653) | `7491a2f4` |     627 |    160 |           234 |              221 |
| [38295602006](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38295602006) | `b0f9fc65` |     590 |    147 |           228 |              205 |
| [38284133704](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38284133704) | `11c8c2cc` |     705 |    172 |           285 |              239 |
| [38273520757](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38273520757) | `ed01d47f` |     805 |    168 |           299 |              327 |
| [38267776934](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38267776934) | `4850de86` |     558 |    169 |           191 |              189 |
| [38256358069](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38256358069) | `a050a851` |     518 |    141 |           192 |              175 |
| [38165458637](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38165458637) | `cf2952aa` |     419 |    131 |           152 |              127 |
| [38148003195](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38148003195) | `c941cc0d` |     762 |    123 |           199 |              127 |

Median total: 605 seconds (10m05s); median gate: 153.5 seconds. Job medians: validate 100s, smoke 138s, workspace-1 124.5s, workspace-2 123s, staging 230s, production 184s. Medians are independent distributions, not an additive synthetic run. Latest navigation job: 189s (one observation only).

## Latest run critical path

[Run 38347275340](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38347275340) completes quality gate at 201s, staging at 437s, production at 620s. First quality runner starts about 3s after creation. Staging and production begin 4s after their prerequisites complete. Path: **navigation → check → staging → production**.

| Critical job / step               | Seconds |
| --------------------------------- | ------: |
| Navigation total                  |     189 |
| Navigation checkout               |       7 |
| Navigation shared Node/pnpm setup |      35 |
| Navigation harness build          |      16 |
| Navigation browser engine install |      80 |
| Navigation regressions            |      44 |
| check total                       |       6 |
| Staging total                     |     232 |
| Staging Node/pnpm setup           |      15 |
| Staging release tool install      |       3 |
| Staging Chromium install          |      23 |
| Deploy and verify staging         |     177 |
| Production total                  |     179 |
| Production Node/pnpm setup        |      16 |
| Production release tool install   |       7 |
| Production Chromium install       |      21 |
| Release production                |     124 |

Latest smoke job: 147s, including build 42s, Playwright install 25s, smoke 38s. Latest Vitest shard durations 59/76/71s; full jobs 96/108/103s. These finish before navigation, so reducing Vitest time currently improves runner consumption and failure feedback, not this successful run's merge gate.

The jobs API groups deployment operations into one step. A follow-up parsed release-controller event names and timestamps from logs in memory; only those fields were persisted, with deployment IDs and all other log text discarded. No artifacts or smoke reports were downloaded. Events measure controller-observed deploy-start → deploy-ready, including API creation/polling and remote deployment work; they do not isolate Vercel build CPU or Convex deployment time.

## Queue observations and interpretation

Nine samples begin quality jobs roughly 3–4s after creation. Run 38148003195 has `run.startedAt` 10m28s after creation, while its jobs report start timestamps about 3s after creation: metadata reflects rerun/attempt history and should not be called initial runner queue time. That run has an observable 308s gap between staging completion and production start. The gap may include release concurrency or scheduling; the job API alone does not identify the cause. Latest run has only 4s inter-stage gaps. Avoid promising queue elimination from this successful-run sample.

## Priorities supported by measurement

1. **High confidence: inspect release phase timing before optimizing deploy logic.** Staging+production jobs consume 411s of latest 620s; their controller steps consume 301s. Preserving backup, verification, exact-SHA release and locks is mandatory. Existing remote staging-disable policy changes risk/coverage and is not a transparent speed optimization; changing it needs the user's release-policy decision.
2. **High confidence bottleneck / medium confidence saving: reduce navigation engine setup.** Browser engine install 80s versus tests 44s is now the largest quality-path step. Evaluate a pinned image with all required engines and OS libraries, or cache matching engine revisions while still installing required OS dependencies. Benchmark hosted runner cold/warm behavior before estimating savings. Installing engines is not equivalent to caching OS packages. Keep multi-engine navigation coverage.
3. **High confidence: don't first add more Vitest/workspace shards.** Existing 3 Vitest shards and 2 workspace legs already finish before latest navigation. Further sharding adds repeated setup and runner demand; base any changes on file/project timing and total runner minutes.
4. **Medium confidence: optimize repeated release setup after deployment telemetry.** Latest release jobs spend 44s combined on browser install plus 31s on shared setup. Any cache/image change must preserve lockfile integrity and credential boundaries. Remote release jobs explicitly set setup cache false; review why before enabling it.

## Reproduction and primary sources

```sh
gh repo view --json nameWithOwner
gh api repos/Rugby-Thailand/industrial-sas/branches/main
gh run list --workflow quality.yml --branch main --status success --limit 10 --json databaseId,headSha,createdAt,startedAt,updatedAt,url,displayTitle
gh api 'repos/Rugby-Thailand/industrial-sas/actions/runs/38347275340/jobs?per_page=100'
gh api 'repos/Rugby-Thailand/industrial-sas/contents/.github/workflows/quality.yml?ref=0bbd285f8b05f36f4ae7bb55fbf9b4aab65184d0'
```

Primary repository source links are attached to each run above. Sanitized metadata is in `github-run-timings.json`; it contains run IDs, SHAs, job names, step names, statuses, timestamps and GitHub URLs, not logs or tokens. GitHub API definitions: [workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs), [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs). Browser setup behavior: [Playwright CI documentation](https://playwright.dev/docs/ci).

## Sanitized release phase timing (latest three successful runs)

| Run         | Staging deploy→ready s | Staging smoke s | Backup s | Production deploy→ready s | Candidate smoke s | Promote→serving s | Live smoke s |
| ----------- | ---------------------: | --------------: | -------: | ------------------------: | ----------------: | ----------------: | -----------: |
| 38347275340 |                  127.9 |            47.6 |      2.2 |                     107.8 |               6.8 |               0.7 |          4.6 |
| 38344283142 |                   99.0 |            68.9 |      2.5 |                     107.9 |               6.5 |               0.6 |         10.4 |
| 38300478653 |                  143.5 |            39.0 |      2.7 |                     137.6 |               8.2 |               0.4 |          5.3 |

Latest observed deployment spans sum to 235.8s; staging smoke 47.6s versus candidate 6.8s and live 4.6s. All three staging smokes are 39–69s, while candidate/live smokes are roughly 5–10s. This supports investigating staging smoke authentication/server-readiness/wait behavior before reducing coverage. Backup is 2.2–2.7s in this sample and is not a useful speed target. Deployment spans vary 99–143s staging and 108–138s production: investigate remote cache/build/Convex phase telemetry, preserving deployment verification and environment boundaries. Raw allowlisted event metadata: `release-event-timings.json`.

Read-only extraction command: `gh run view RUN_ID --job JOB_ID --log`, consumed by an in-memory parser matching only ISO timestamps, literal `[release:staging]`/`[release:production]`, and an alphanumeric event name. Raw logs were not persisted to the repository.
