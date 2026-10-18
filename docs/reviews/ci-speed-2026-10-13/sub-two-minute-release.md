# Sub-two-minute push-to-live architecture — plan only

Target: less than 120s from main push creation to production live smoke passing. Staging is planned disabled while there are no users. No credentials were moved, builds run, workflow changes made, candidates deployed, or workflows dispatched in this research.

## Evidence and feasibility

Newest completed [main run 38350247746](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38350247746), SHA `c425dd80f70feae6c2a4a75e03e8831daa42b4dc`: push 05:12:51 UTC; gate 05:15:41 (170s); staging 322s; production 244s; run completion 05:25:18 (747s). Smoke is critical quality job 158s, navigation 130s, workspace 140/137s, Vitest 120/102/65s, validate 78s. The prior successful run had navigation 189s and gate 201s. These measured paths exceed 120s **before production release begins**. Disabling staging alone would leave roughly 425s on this latest run (overall 747s − staging job 322s, retaining scheduling/completion overhead). This is a counterfactual arithmetic estimate, not a test.

Pinned latest [remote release configuration](https://github.com/Rugby-Thailand/industrial-sas/blob/c425dd80f70feae6c2a4a75e03e8831daa42b4dc/scripts/release/lib/vercel-config.mjs) still invokes environment verification, then `convex deploy --cmd ...pnpm build`. [Controller](https://github.com/Rugby-Thailand/industrial-sas/blob/c425dd80f70feae6c2a4a75e03e8831daa42b4dc/scripts/release/lib/release.mjs) still backs up after gate, checks latest main, starts deployment, waits, verifies candidate, smokes, promotes, and live-smokes. Therefore simply launching the existing production build earlier can mutate Convex before quality success. `--skip-domain` only avoids frontend domain assignment; it does not prevent build-command backend mutation.

**Recommended architecture: pure production build concurrent with checks, prebuilt production candidate, explicit Convex deployment only after exact-SHA quality success.** This removes serialized remote frontend compilation. Under 120s is a design target, not demonstrated: all quality legs must fall below about 75s, and the gated backend/candidate cutover must fit about 30s. Warm workers with matching browser engines, balanced tests, and fewer scheduling boundaries are prerequisites; cache-only tweaks are insufficient evidence.

## Execution graph

Main push starts concurrently:

- Full quality legs, preserving navigation/workspace/browser/unit/contract coverage; optimize runner preparation and split heavy files using measured timings.
- Pure production frontend artifact build on trusted main, without a Convex deployment key or backend mutation command. Use production frontend values, `RELEASE_SHA`, reviewed runtime, immutable config inputs and a unique skew ID. Do not reuse today's credential-free anonymous `.next` output as production output.
- Release tooling/browser preparation; prepare work can be canceled before mutation. Keep mutation lock duration short by acquiring it only when quality/artifact are ready.

After gate succeeds, acquire the existing shared production lock, verify current-main/provenance/config, take required backup, and deploy the explicit backend. Deploy prepared output with `vercel deploy --prebuilt --prod --skip-domain`; wait for exact candidate readiness, verify project/target/SHA, bind stable candidate, candidate smoke, promote that same production deployment, verify live SHA and live smoke. Candidate creation/readiness can overlap standalone backend deployment only after the backup and gate, because the frontend candidate does not mutate backend; candidate smoke must await both. Maintain ownership of the lock through backend write, smoke, promotion and live verification.

An optional stronger variant uploads the pure production candidate before gate, concurrently with checks, leaving only backend deployment and cutover after gate. It changes current no-production-deployment-before-gate policy, adds pre-gate production serverless exposure and cost, and requires separate frontend-only credentials with no backend deploy key. Restrict endpoints/protection and record this policy change explicitly. Failed quality may discard the candidate but must never promote it. Start with artifact preparation before gate and candidate upload after gate; move candidate readiness earlier only if the measured upload tail prevents 120s.

[Vercel build](https://vercel.com/docs/cli/build) emits `.vercel/output`; `--prod` selects production configuration, and project settings should be pulled first. Output can be deployed using [prebuilt CLI](https://vercel.com/docs/cli/deploy), avoiding provider compilation. Need to verify pinned CLI portability and packaging: plain `.next` is not the deployable contract, and symlinked workspace dependencies must be included or materialized. Prefer same trusted runner/output retention for build and upload; if transferring, private artifact must have digest verification and exclude pulled env files.

[Convex CLI](https://docs.convex.dev/cli/reference/deploy) supports standalone deployment; key selects its deployment. CLI also typechecks, regenerates code, bundles and pushes schema/indexes/functions. Build against committed, freshness-checked generated types; do not silently alter frontend sources after artifact build. Initial implementation should retain deploy typecheck/codegen defaults and assert no unexpected generated difference. Any later bypass needs equivalent exact-SHA gate evidence, not merely a speed flag.

## Choice of build location

| Approach                                                  | Advantages                                                                                                          | Limits for 120s                                                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trusted CI pure build + prebuilt production candidate     | Runner cache/control; removes remote compilation from mutation path; exact output digest; tested output is released | Production build config/secrets may enter trusted CI; upload/readiness unmeasured; system-env/skew/packaging need changes                                         |
| Vercel pure production candidate build concurrent with CI | Production secret runtime stays provider-side; native output/system env; candidate READY can precede gate           | Current remote deploy→ready spans 108–138s already approach/exceed 120 before cutover; cannot assume faster build or queue; build command must lose Convex deploy |
| PR preview promotion                                      | Existing preview availability                                                                                       | Preview config differs production; not an exact production artifact/provenance receipt; do not use as shortcut                                                    |

Provider pure candidate is fallback if production-build secrets cannot be relocated. Remove Convex mutation from Vercel build command, create **production** candidate without domains, and retain backend deployment as gated explicit job/service. [Production promotion](https://vercel.com/docs/deployments/promoting-a-deployment) is the intended no-rebuild cutover. Preview promotion is not interchangeable with production artifact preparation. Production runtime env may be provider-bound while frontend compile inputs are public; first inventory actual build-time secret consumption before deciding all production secrets must move. This plan does not authorize retrieving them.

## 120-second budget — proposed thresholds, not measurements

| Window   | Concurrent work                                                  | Budget |
| -------- | ---------------------------------------------------------------- | -----: |
| 0–5s     | Event→warm prepared runners                                      |     5s |
| 5–75s    | Full checks; pure production build; release tools ready          |    70s |
| 75–80s   | Stable gate, lock acquisition, provenance and backup             |     5s |
| 80–100s  | Explicit backend deploy plus prebuilt candidate upload/readiness |    20s |
| 100–108s | Candidate binding and complete candidate smoke                   |     8s |
| 108–112s | Promotion and serving identity                                   |     4s |
| 112–118s | Live smoke                                                       |     6s |
| 118–120s | Completion/reporting margin                                      |     2s |

The main plan is authoritative: its selected budget is 115s, with the acceptance target of representative full push-to-verified-live p95 under 120s, including cold cases in the observed dataset. The 120s table here is an alternative feasibility envelope, not the selected implementation budget. Warm-path metrics are diagnostic only and do not redefine the target.

This alternative budget has little variance headroom. Earlier observed backup 2.2–2.7s, candidate smoke 6.5–8.2s, live smoke 4.6–10.4s, promotion 0.4–0.7s; these support approximate tails but not cold-p95 guarantees. Backend standalone deployment, prebuilt upload/readiness, production pure build, and warm optimized checks are all unmeasured. Latest remote quality remains 170s. If these thresholds fail, under 120 requires prevalidated exact-main-SHA receipts and/or more runner resources, or a changed check policy approved separately. Do not present 105s as forecast from existing data.

Cold browser dependency install, a lock held by earlier release/backup, a Vercel queue, a schema validation/index build, provider interruption, or changed lockfile can exceed budget. Warm p50 and p95 must be reported separately from cold paths. A blanket hard 120-second deadline would cancel safe deployments mid-write; use phase-safe cancellation, diagnose slow runs, and never cancel an owned mutation just to satisfy reporting.

## Provenance, environment and skew requirements

Build receipt records exact 40-character main SHA, tree/lockfile digests, workflow run/attempt, tool versions, target team/project, public config/version identity, artifact digest and generated-code digest. Any reusable receipt must originate from trusted allowed workflow code, report all required successful checks, and match exact main SHA plus current release-policy/config revision. Never store secret env values in receipts; secret/config rotation needs an opaque revision or key-protected digest. Branch identity alone is insufficient.

Verify production Clerk instance, Convex cloud/site URL, app origin, Bun runtime, and SHA headers before build/deploy. Pull production environment only in trusted isolated context; never publish `.vercel` env files. Keep backup/admin/Convex mutation keys absent from build and browser workers. Revalidate config revision at cutover so artifacts cannot silently use stale production public env. Update existing env assertions rather than spoofing `VERCEL_*` fields to satisfy remote-only assumptions.

[Prebuilt skew protection](https://vercel.com/docs/skew-protection#custom-deployment-id) requires a custom deployment ID matching build/deploy output. Current official constraints: unique per project, maximum 32 characters, allowed alphanumeric/hyphen/underscore, no `dpl_` prefix; requires sufficiently new Next/CLI. Full 40-character SHA is invalid as that ID. Use a unique build/run identifier under 32 characters, retain full SHA separately, and preserve it across candidate→promotion. Retry same deployment by identity; a newly created deployment needs a distinct custom ID and matching output, not blindly the same cached output. Read bundled Next deploymentId guide before implementation, preserve Next version-skew behavior, and test old client navigation against newly promoted frontend. Vercel skew protection does not solve Convex schema/function compatibility.

Backend release must remain backward compatible with currently live frontend until promotion; old client tabs can live longer. Use expand/contract schema/function evolution. Backend success followed by candidate failure leaves frontend old and backend new: record partial mutation and reconcile/forward fix under lock. Frontend rollback is permitted only when backend compatible. No-users today does not remove the need to preserve these recovery semantics for the eventual populated app.

## Exact-SHA receipts / merge queue option

For a candidate already fully validated before main push, a trusted signed/digest-bound receipt could skip repeating identical checks and artifact preparation after push. Reuse requires **exact commit equality**, not PR head, PR merge ref, branch name, or equal-looking source. Squash/rebase/merge commits can change SHA, build provenance and config. Fallback is normal main validation whenever identity does not match.

[GitHub merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) validates temporary merge groups and requires `merge_group` workflow trigger. It is useful to establish candidate checks before integration, but the docs alone do not guarantee the final main SHA equals a chosen temporary artifact SHA for every merge method/group. Verify actual final identities in this repo; do not deploy unmatched artifact or replace `RELEASE_SHA` after build. Merge-queue work can improve **post-main-push** latency while total PR-to-live still includes prior checks; report both clocks. Untrusted merge-group code must not receive production secret-bearing build authority.

## Implementation and acceptance sequence

1. Add phase telemetry, tested pure-build versus backend-mutation contracts, receipt schema and compatibility failures. This research changes no source.
2. Separate build command from Convex deploy; refactor controller preflight, partial-mutation recovery and orphan inventory so a prepared frontend candidate is not falsely labeled possible backend mutation. Keep Git auto-domain assignment disabled and stage policy captured.
3. Prove production Build Output packaging, target/runtime/env identities, artifact digest, skew behavior and failure/cancel/retry cases on nonproduction project. Measure standalone backend deploy and prebuilt readiness there; only subsequent authorized protected runs can establish production timing.
4. Introduce warm prepared workers/engine image and test balance; measure full preserved checks under 75s without benchmark contention. Browser smoke must test the output contract used for release, not only an unrelated anonymous build.
5. Enable the parallel plan only once fail-closed tests pass; collect at least 20 successful main releases plus cold/cache-miss samples. Require representative full push→verified-live p95 under 120s, including cold cases in the observed dataset; publish all failures and cold timings, and verify no quality failure mutated backend or serving frontend. Warm-path distributions are diagnostic only and do not narrow the target. An every-run hard ceiling remains unguaranteed because external queue/provider and schema migration bounds are unresolved.
