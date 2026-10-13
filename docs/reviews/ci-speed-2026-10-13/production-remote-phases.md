# Existing production release: phase evidence and the free-runner 3–4 minute target

Measured 2026-10-13 using completed [run 38350247746](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38350247746). Production deployment `dpl_4YSJooUEusYBAmRcL1LX9n5aXfQE` was identified from the controller's `deploy-created` event. Read-only Vercel API metadata independently matched both `githubCommitSha` and `releaseSha` to `c425dd80f70feae6c2a4a75e03e8831daa42b4dc` and `releaseRunId` to this run. Correct owner/project resolved through the existing link: `rugbykritsakorn-9882s-projects/industrial-sas`.

The pinned Vercel CLI 63.1.0 `inspect --logs`, `inspect --format json`, and GET `/v13/deployments/<id>` were used. Raw Vercel/Actions logs stayed in subprocess memory and were reduced to explicit phase labels and timestamps before output; no raw logs, environment files, secrets or business data were saved. No deployment, account setting, credential or source-code change was performed.

## Remote coupled build on current Hobby capacity

Actual deployment metadata reports Basic, fixed plan-default, **two cores and 8 GB RAM**. Creation-to-ready was **98.394 seconds**. The controller's approximately 105-second wait includes polling delay; it is not all compilation.

All timestamps below are UTC on 2026-10-13. Logs use millisecond precision; API events and controller logs use different clocks, so subsecond ordering around READY should not be treated as a synchronized trace.

| Allowlisted phase                                             | Start        | End          |     Elapsed | Interpretation                                                                                                      |
| ------------------------------------------------------------- | ------------ | ------------ | ----------: | ------------------------------------------------------------------------------------------------------------------- |
| Deployment API creation → building                            | 05:23:17.804 | 05:23:19.099 |      1.295s | Combined assignment/initialization, not a separate queue measurement. No concurrency-queue timestamps were present. |
| Deployment API creation → READY                               | 05:23:17.804 | 05:24:56.198 |     98.394s | Full provider readiness interval.                                                                                   |
| Build-container start → READY                                 | 05:23:19.099 | 05:24:56.198 |     97.099s | API `timeToReady`; includes installation and output deployment.                                                     |
| Source-download marker → cache-restored marker                | 05:23:19.768 | 05:23:24.027 |      4.259s | Mixed source/cache initialization window; a standalone source-download end was not logged.                          |
| Dependency install                                            | 05:23:28.079 | 05:23:29.728 |      1.649s | Frozen install on restored provider cache; CLI reported 1.5s.                                                       |
| Next optimized compilation                                    | 05:23:32.934 | 05:23:46.213 |     13.279s | Compiler reported 12.2s.                                                                                            |
| Next TypeScript validation                                    | 05:23:46.216 | 05:24:31.873 | **45.657s** | Largest remote build phase; reported 46s.                                                                           |
| Page collection/static generation/finalization → route output | 05:24:31.873 | 05:24:34.854 |      2.981s | Includes the visible route-generation/finalization window. Distinct tracing duration was not exposed.               |
| Frontend route output → Convex deploy success                 | 05:24:34.854 | 05:24:46.742 |     11.888s | Coupled backend work after the frontend build.                                                                      |
| Convex TypeScript marker → push/check marker                  | 05:24:37.168 | 05:24:46.457 |      9.289s | Approximate backend checking window; not an independently reported CPU duration.                                    |
| Convex success → Vercel build-completed marker                | 05:24:46.742 | 05:24:47.017 |      0.275s | Final adapter/packaging completion window; no separate function tracing markers.                                    |
| Deploy outputs → deployment-completed marker                  | 05:24:47.040 | 05:24:56.707 |      9.667s | Provider provisioning/output deployment.                                                                            |
| API READY → controller `deploy-ready`                         | 05:24:56.198 | 05:25:03.893 |  **7.695s** | Mainly the current ten-second polling interval; API/clock precision caveat applies.                                 |

Convex logs expose upload and generated-code markers around 05:24:36.168–05:24:37.082; they do not expose sufficiently separate begin/end markers to claim individual codegen, upload and schema-push durations. The 11.888-second combined backend window is the reliable practical budget.

The provider continued creating/uploading cache after the deployment was ready. CLI duration metadata reports 148.555 seconds to container exit versus 97.099 seconds to READY; this **51.456-second post-ready difference is not on the release controller's critical path**. Do not add cache-upload completion to the verified-live timer or mistake container/billing duration for readiness.

## GitHub release tail

| Allowlisted phase             | Start        | End          |     Elapsed |
| ----------------------------- | ------------ | ------------ | ----------: |
| Production job                | 05:21:13     | 05:25:17     |        244s |
| Shared full-app setup step    | 05:21:23     | 05:22:40     |         77s |
| Its frozen dependency install | 05:21:30.843 | 05:22:39.119 | **68.276s** |
| Release-tools install         | 05:22:40     | 05:22:42     |          2s |
| Release Chromium installation | 05:22:42     | 05:23:12     |     **30s** |
| Controller step               | 05:23:12     | 05:25:15     |        123s |
| Backup                        | 05:23:13.058 | 05:23:15.297 |      2.239s |
| Deploy-start → created event  | 05:23:15.536 | 05:23:18.990 |  **3.454s** |
| Candidate smoke               | 05:25:04.384 | 05:25:10.788 |      6.404s |
| Promote request → serving     | 05:25:11.281 | 05:25:11.801 |      0.520s |
| Live smoke                    | 05:25:11.801 | 05:25:15.121 |      3.320s |

The setup's Node tool-cache hit does not mean dependencies were cached: the release workflow deliberately disables the shared pnpm dependency cache. That install is the source of the 68-second setup loss. Using a reviewed smaller release dependency closure could reduce it, but its imports and tools must be proved; simply enabling an arbitrary PR-restored executable cache is not equivalent.

Excluding documentation/tests from source upload is useful housekeeping, but the **entire source-upload/create interval was only 3.454s**. Even eliminating that interval cannot deliver a material minute-scale gain. Provider source-download/cache initialization also measured only a few seconds in this warm run. Cold cases may differ and must be measured.

## Arithmetic for minimal changes

These are counterfactual estimates, not successful optimized runs. `Q` below means push/run creation through the successful aggregate quality gate, including its scheduling. Approximately five seconds are retained for the historical gate-to-production-job delay; lock contention could add more.

1. Skip staging, reduce quality to `Q=100–120s`, but retain this production job: `Q + 5 + 244 = 349–369s`, about **5:49–6:09**.
2. Restore normal full-app release setup to an assumed 20s instead of 77s, overlap the 30s release Chromium installation with remote work, and reduce polling to 3s: `244 − 57 − 30 − ~5 = ~152s` release tail. Then `Q + 5 + 152 = 257–277s`, about **4:17–4:37**.
3. If a verified smaller release setup took an assumed 8s, that saves a further 12s: approximately **4:05–4:25**. This duration has not been benchmarked. A three-second poll can save roughly five seconds on this sample, not a guaranteed seven on every run; request duration and phase alignment remain counted.

Thus quality at 100–120s plus browser overlap and faster polling **does not establish the four-minute target with the unchanged coupled remote build**. It approaches the target, but has little or negative margin.

The most valuable small additional investigation is the 45.657-second **duplicate Next TypeScript check**. The repository already has `typecheck:ts6` (`next typegen && tsc --noEmit`), while the current regular quality `typecheck` uses the Bun checker. Retaining TypeScript 6 as an independently required same-SHA quality lane and disabling only the duplicated Next build check for the gated remote path could remove roughly 46 seconds from the release tail while keeping production Convex credentials at Vercel. If that lane fits inside `Q`, the arithmetic becomes approximately **3:31–3:51** with the assumed 20-second setup, or **3:19–3:39** with the assumed 8-second setup.

This is a candidate to test, **not permission to drop validation**. The installed Next 16.3.8 guides say the current build uses project-local `tsc` by default and that `ignoreBuildErrors` bypasses the check entirely. Prove matching TypeScript/config/generated route-type coverage, exact-SHA gate provenance and failure behavior before selecting a narrowly scoped duplicate-check bypass. Keep ordinary/direct builds checked unless equivalent evidence is present. The Bun checker alone does not replace the existing TypeScript 6 production gate. Relevant local guides: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/02-typescript.md` and `.../01-next-config-js/typescript.md`.

An explicit prebuilt design would move frontend compilation/validation into preparation alongside quality and remove this remote frontend work from the gated tail. It additionally needs production configuration equivalence, artifact provenance/transfer, runtime environment compatibility and a mechanism for the existing Vercel-held Convex deployment key. The previous local prebuilt experiment's duration and this warm provider build are not interchangeable. Under the revised goal, first test the smaller dependency/setup/polling and equivalent TypeScript-gate changes; they can preserve the current backend-key boundary. Keep full prebuilt/backend-release separation as a fallback if measured free-runner complete runs still miss the target.
