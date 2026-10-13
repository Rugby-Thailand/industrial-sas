# Pure prebuilt feasibility spike — 2026-10-13

Latest target: free hosted runners, 3–4 minutes acceptable. Sub-two-minute assumptions in earlier research are superseded; this spike proves an artifact option, not a claim of total hosted latency.

Source clean integration worktree `/Users/macbook/Development/industrial-sas-ci-under2-20261013`, base `c425dd80f70feae6c2a4a75e03e8831daa42b4dc`. Original dirty checkout preserved. Toolchain Node 24.19.0, pnpm 10.33.2, exactly pinned Bun 1.4.3, Vercel 63.1.0, Next 16.3.8. Platform macOS arm64.

Read-only project GET using scoped Vercel CLI selected **only** public build metadata (Next framework, Node 24, frozen pnpm install command, output/root directory). Provider dashboard's build command still couples Convex deploy; we did not execute it or retrieve secret values. Connector 403 fell back to same scoped CLI GET successfully.

Ignored temporary local project settings select reviewed project/team and replace build command with `pnpm build`. Temporary local config has pure build, frozen install, Bun 1.4.x and Git deployments disabled. Empty `.vercel/.env.production.local` prevents pull. Fresh clean worktree has no local dotenv files. Build environment allows only HOME/PATH/TMPDIR, CI/telemetry/no-env control, full SHA, unique NEXT_DEPLOYMENT_ID and reviewed public Clerk/Convex/application inputs. No Convex mutation key, Clerk secret, Uploadthing token, Sentry upload token, GitHub token or Vercel token was passed to build process.

Actual command (absolute CLI uses original existing dependency installation read-only):

```sh
/Users/macbook/Development/industrial-sas/tools/release/node_modules/.bin/vercel build \
  --prod --standalone \
  --local-config .cache/prebuilt-spike/pure-vercel.json
```

Measured once after dependency install, Next cache initially empty: **40.66s** overall local pure build; compilation 12.1s; TypeScript 18.6s. Frozen pnpm no-change install 614ms. Success exit 0, all 70 static pages built, no deployment/upload/backend command. A preceding setup attempt failed because a Bun symlink mistakenly pointed to the directory instead of its binary; it was corrected and excluded from timing.

Output `.vercel/output`: 1,862 physical files, 39,880,576 bytes, 212 symlinks; **all link targets inside output**. All four physical function configurations have runtime `bun1.4.x`, architecture `arm64`, empty baked environment. Build Output config version 3 and deploymentId `ci-local-spike-1`. Output is copied to `/tmp/industrial-sas-prebuilt-portable-spike` with links preserved and runs outside source checkout. Cross-platform Linux portability is not established by macOS output; hosted Linux probe must build fresh Linux artifacts.

Packaged middleware launcher test used synthetic runtime credentials, never real secrets, and replaced `global.fetch` with a throwing stub. It called the exported `.vercel/output/functions/_middleware.func/___next_launcher.cjs` with a GET Request for the app's `/api/runtime` path:

| Runtime environment          | Result                                                                      | Network fetches |
| ---------------------------- | --------------------------------------------------------------------------- | --------------: |
| No Clerk secret              | HTTP 200, no Clerk auth status/reason                                       |               0 |
| Synthetic `CLERK_SECRET_KEY` | HTTP 200, Clerk status `signed-out`, reason `session-token-and-uat-missing` |               0 |

The secret-free build preserves runtime authentication evaluation. `process.env.CLERK_SECRET_KEY` remains in 9 output JS modules, and `process.env.RELEASE_SHA` remains in 1; provider runtime environment must still attach correct secrets and SHA. This is not authenticated end-to-end proof: no real session, Uploadthing or production backend request occurred. Next deploymentId is supplied through the documented NEXT_DEPLOYMENT_ID environment; no app config edit required. Vercel builder moves that ID into Build Output config and clears runtime Next config ID, relying on provider skew support. Hosted client-navigation skew testing remains necessary.

Experimental, unwired helper in integration worktree:

```sh
node scripts/release/build-prebuilt.mjs
```

Required environment: RELEASE_ENVIRONMENT (`production` or `staging`), RELEASE_SHA equal HEAD, RELEASE_RUN_ID, RELEASE_RUN_ATTEMPT; reviewed NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_CONVEX_URL, NEXT_PUBLIC_CONVEX_SITE_URL, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, NEXT_PUBLIC_CLERK_SIGN_IN_URL. Optional explicitly reviewed telemetry public inputs are allowlisted; unknown NEXT_PUBLIC names fail. Wrapper requires clean checkout and pinned Bun/Node/Vercel. No provider pull/read/deploy occurs. Produces output and `.vercel/prebuilt-receipt.json` with exact-SHA/run/project/team/output/public-config/lockfile/generated-code provenance, timing and toolchain.

Receipt helper verifies contents and symlink containment, catches wrong target/SHA/run/config and tampered output. Upload output as a **tar preserving symlinks** plus receipt; never upload whole `.vercel` directory, project settings or env files. Direct upload-artifact traversal can expand links and alter digest, so extract and verify receipt before any candidate deployment.

Public config binds production versus staging project, Clerk instance and Convex deployment; secret-bearing build environment fails before invoking compiler. Unit integration tests cover rejection and tampering. Wrapper has intentionally not been wired into quality/releases; current changes must be committed before its clean-checkout requirement allows full wrapper execution. Underlying pinned CLI build and portable middleware proof above passed independently.

Remaining decisions/tests: hosted Linux build timing/output packaging; isolated **staging** frontend-only prebuilt candidate readiness; provider runtime secret/SHA binding; candidate auth and skew; standalone backend deployment timing; existing release environment guards and partial-mutation inventory. Parent chooses architecture after free-runner measurements. These blockers preclude claiming new production release behavior is ready or a 3–4 minute latency proven.

## Final experiment outcome

The hosted Linux pure-build probe passed in [run 38353981209](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38353981209): 131-second job and 92-second build. No prebuilt artifact was deployed. The wrapper/workflow described above existed in experiment commit `e25ae4f7` and was removed in `c4b68624`; those commands are historical evidence, not current release instructions. The selected implementation keeps the coupled provider build and backend credentials at Vercel, so runtime deployment/provenance questions for prebuilt output remain outside its scope.
