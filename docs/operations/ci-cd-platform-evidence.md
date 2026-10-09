# Verified CI/CD platform resources

Verified through authenticated GitHub, Vercel CLI/API/dashboard, and Convex CLI access on 2026-10-09. This file records public resource metadata only. The connected Vercel MCP account returned no teams; the saved native CLI and collaborative dashboard are authenticated to the correct team.

| Resource           | Production                                                         | Isolated CI staging                                                                         |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Vercel team        | `rugbykritsakorn-9882s-projects` (`team_HIg4nXozZ4oXYYhIMETF8E6r`) | Same team, separate project                                                                 |
| Vercel project     | `industrial-sas` (`prj_XQbt4f38BNrAvf593UstPk76rRik`)              | `industrial-sas-staging` (`prj_qrzHbzKt7oIKziO8wzI8GP00KAUA`)                               |
| Frontend           | <https://app.thaipropertyai.com>                                   | Intended stable alias <https://industrial-sas-staging.vercel.app>; deployment proof pending |
| Convex reference   | `trustera:industrial-sas:prod`                                     | `trustera:industrial-sas:preview/ci-staging`                                                |
| Convex cloud       | <https://greedy-cardinal-537.convex.cloud>                         | <https://befitting-stoat-208.convex.cloud>                                                  |
| Convex site        | <https://greedy-cardinal-537.convex.site>                          | <https://befitting-stoat-208.convex.site>                                                   |
| Clerk issuer       | <https://clerk.thaipropertyai.com> (live public key verified)      | <https://creative-doberman-56.clerk.accounts.dev> (test instance verified)                  |
| GitHub environment | `production-release`                                               | `staging`                                                                                   |

The older `artful-wolf-267` preview is deliberately not used: ownership and isolation were uncertain. Staging Convex and Vercel resources were newly created without changing the production backend, existing live aliases, or original local environment selection.

## Credentials and environment isolation

Both GitHub environments have `VERCEL_TOKEN` configured directly as encrypted secrets. Tokens were newly created with Vercel's project restriction and 90-day expiration (2027-01-07 UTC); each was tested against its intended project, while access to the other project returned HTTP 404. The temporary one-hour bootstrap token was revoked and its private copy removed. Rotate the CI tokens before expiry; no token values belong in this repository or reports.

GitHub staging also has `CONVEX_DEPLOY_KEY` and `CLERK_SECRET_KEY`. Vercel staging Production and Preview targets have the dedicated Convex deploy key, the existing Clerk development secret key, matching public keys/URLs/issuer, and `RELEASE_ENVIRONMENT=staging`. Production credentials remain in the existing Vercel production project. Its Production target now has the public `RELEASE_ENVIRONMENT=production` label, verified by authenticated readback. Both projects have `autoExposeSystemEnvs=true` and Node `24.x`, providing the build identifiers checked by the environment validator. Staging frontend builds use the staging project's Production target, so `VERCEL_ENV=production` alone must never select live Clerk/Convex resources. Validate the declared project and deployment identity instead.

Convex CLI 1.46 creates a deployment-scoped key for this preview with a `dev:befitting-stoat-208` prefix. This is a concrete deployment key, not the project-wide `preview:team:project` key: use normal `convex deploy` and validate the expected deployment name; do not add `--preview-create` or recreate the database.

Both Vercel projects use Node 24.x. Staging is configured with Next.js, frozen pnpm installation, and the coupled Convex/frontend build command. The release PR must reconcile that command with its environment validator before backend mutation. Staging project build-command readback now matches the audited provenance/environment gate, and its ignored-build-step command is unset. The backend `E2E_FIXTURE_TARGET=befitting-stoat-208` marker was configured and read back successfully. No staging application code or fixtures have been deployed yet. See [Clerk evidence](./ci-cd-clerk-evidence.md) for the dedicated webhook, currently disabled until the handler is deployed.

## GitHub enforcement applied

- Active [main ruleset](https://github.com/Rugby-Thailand/industrial-sas/rules/24799747), no bypass actors: deletion/non-fast-forward restrictions; one PR approval; stale-review dismissal; code-owner review; latest-push approval; resolved conversations; strict required `check` from GitHub Actions (integration 15368).
- Secret scanning, push protection, vulnerability alerts, and automated security fixes enabled. Initial open secret-alert inventory was empty.
- Actions SHA pinning enforced. Selected actions allow GitHub-owned actions plus `pnpm/action-setup@*` and `github/codeql-action/*@*`. Additional third-party actions require a reviewed allowlist update.
- `production-release` and `staging` have a main-only branch policy, zero reviewers, and no wait timer. The user's release policy is automatic after CI passes.

## Validation and cutover still to perform

The reserved production candidate host is <https://ci-candidate.thaipropertyai.com>. It was added to the existing production Vercel project, verified with correctly configured DNS, and recorded as `PRODUCTION_CANDIDATE_URL` in GitHub. Existing `app.thaipropertyai.com` and `industrial-sas.vercel.app` assignments were verified unchanged. This host shares the production Clerk root domain; that provides a suitable candidate hostname for verifying future artifacts. The release controller must explicitly bind this candidate alias to the staged production deployment ID before checking it, then promote that same ID.

Read-only browser verification on the currently serving production artifact returned HTTP 200 on the candidate host. Clerk loaded from `clerk.thaipropertyai.com`, the existing browser session was authenticated with an active organization, and navigation reached `/th/master-data/storage-layouts` with no alert elements. No session credentials or user/organization details were extracted, and no business writes were performed. This confirms the reserved host works with current production authentication; it does not verify the future PR artifact or provide a CI service identity. The isolated staging alias currently returns HTTP 404 because its first deployment is still pending.

Kiro implementation and independent Codex fixes are complete. Local focused tests, typecheck, lint, formatting, production build, generated-code freshness, workflow validation and credential-free browser suites have passed; the final full shards passed all 2139 tests across 189 files with zero retries, failures or skips, and the exact two-shard JUnit/coverage merge passed. Live staging rehearsal is being completed separately. GitHub execution of the new workflows, GitHub-issued staging OIDC, authentication of a new production candidate artifact and the coordinated production cutover require subsequent execution. Resource configuration alone does not establish those proofs. This task prepares a PR; merging it and deploying changed production application/backend code are separate actions.

## Production backup gap independently verified

Authenticated metadata checks on 2026-10-09 found no periodic backup configuration and zero stored cloud snapshots for `greedy-cardinal-537`. Current team entitlement has `periodicBackupsEnabled=false` and `maxCloudBackups=2`; no purchase or upgrade has been authorized. This was the initial observation; the snapshot, disposable data restore, and native export protocol were subsequently verified below. The repository now wires the verified native protocol into the automatic pre-release gate and protected daily refresh; their first GitHub execution follows merge. Periodic cloud scheduling remains unavailable under this entitlement. Personal Convex login credentials must not be copied into GitHub. See the independent platform audit for exact API evidence and least-privilege feasibility.

## Scoped automated recovery credential

`CONVEX_BACKUP_ADMIN_KEY` is configured directly in GitHub environment `production-release`. It is newly created for `greedy-cardinal-537` with exactly `deployment:backups:create` and `deployment:backups:view`, expiring 2027-01-07 UTC. It has no deploy, data-read, import, delete, or backup-download permission. An authenticated `_system/cli/exports:getLatest` query succeeded with this key and returned no previous native snapshot. No existing production deploy secret or personal account token was transferred to GitHub.

This enables automatic metadata-only native snapshot creation/polling before backend mutation, plus a protected daily refresh. The controller must validate production URL/name, include Convex file storage, require a new completed snapshot, and verify returned expiry exceeds the release/recovery window; logs and artifacts contain only sanitized metadata. Native snapshots have source-default fourteen-day expiry, checked through actual `expiration_ts`, and are distinct from seven-day dashboard cloud snapshots. Exact protocol is documented in the independent platform audit.

The coordinator created and verified one completed production cloud snapshot with `includeStorage=true` (ID `1708272`), requested 2026-10-09 16:27:24 UTC and expiring 2026-10-16 16:27:24 UTC. The saved account was used only for this one-time recovery rehearsal; no application/backend code or business data was changed by this request. No snapshot deletion, production restore, paid plan upgrade, or public data archive was performed.

## Completed disposable cloud restore rehearsal

Snapshot `1708272` was restored server-side into a newly created, non-default preview `trustera:industrial-sas:preview/ci-restore-20261009`, deployment `precise-rabbit-956` (ID `6049010`). Source/target project, deployment type, reference, non-default status, exact backup source, storage inclusion, and future expiration were checked before restoration. This is neither production (`5519796`) nor staging (`6047777`). The target expires automatically one hour after creation; no code, environment variables, Clerk webhook destination, or scheduled integrations were copied.

The disposable target credential has only `deployment:backups:import` and `deployment:backups:view`, expires in one hour, and was retained only in a private temporary file. The server-side import reached `completed`, reporting **3296 documents**. Measured request-to-verification wall time was **94.9 seconds**, including the explicit confirmation step. Only aggregate import metadata was inspected; no production records, identities, files, or ZIP contents were downloaded or printed. Production data was not restored or edited.

This proves the current snapshot can be imported to a disposable target and supplies a measured data-restore rehearsal. It does not establish full application recovery, semantic business validation, UploadThing byte coverage, or a future migration's compatibility. Native export recovery and long-term/private external-file archival remain distinct procedures.

## Native snapshot protocol verified live

The backup-only credential successfully created a native production snapshot including Convex storage, then polled `_system/cli/exports:getLatest` to `completed`. Returned metadata had `requestor= snapshotExport`, `format={format:zip, include_storage:true}`, and nanosecond `start_ts`, `complete_ts`, and `expiration_ts`; completion, new-request freshness, and at least a 24-hour remaining recovery window were verified. No archive was downloaded. An explicit download attempt with that same credential was refused (HTTP 403), proving it lacks backup-download permission. The key also lacks import/deploy/data-read/delete permissions by its explicit creation policy.

The independently implemented `scripts/release/lib/convex-backup.mjs` gate was also executed live with the backup-only credential: it returned `BACKUP_COMPLETED`, exact production selection, `includeStorage=true`, fresh start/completion, 275089 bytes, and verified future expiry. Verification took approximately 3.5 seconds at 17:26 UTC. No archive was downloaded, and no raw provider response was published. Its 55 focused regressions passed before this live run.

The verified live result is the protocol for the new controller's automatic pre-release and daily metadata-only backup gate. Source-default fourteen-day retention is still checked through returned expiry, rather than treated as a fixed hosted guarantee. Snapshot contents remain inside authenticated Convex storage; CI publishes only metadata.

## Protected staging access configured

Staging retains Vercel Authentication (`all_except_custom_domains`). Its Trusted Sources configuration now accepts GitHub Actions OIDC from `https://token.actions.githubusercontent.com` with all of these exact claims: audience `https://github.com/Rugby-Thailand`, repository `Rugby-Thailand/industrial-sas`, repository ID `1320219321`, repository owner ID `307631341`, ref `refs/heads/main`, environment `staging`, and workflow ref `Rugby-Thailand/industrial-sas/.github/workflows/quality.yml@refs/heads/main`. The destination is only the staging project's `production` Vercel target. The trusted workflow filename now matches the quality workflow release jobs; exact claim readback passed. A token must be obtained in the environment-scoped job with `id-token: write` and sent as `x-vercel-trusted-oidc-idp-token` only to the exact protected staging origin; never attach it to Clerk, Convex, or arbitrary redirects.

For local verification, only staging's self-project rule adds `development` to `production` access. The existing production-to-production, preview-to-preview, development-to-preview, and development-to-development mappings were preserved. A project-restricted credential successfully minted a short-lived development OIDC token for `prj_qrzHbzKt7oIKziO8wzI8GP00KAUA`; its value stays in a private temporary file and is absent from GitHub and this document. No permanent automation bypass secret or public protection exception was created. Configuration readback passed; access to a real staging application and GitHub-issued OIDC still need execution after deployment/merge respectively. Production project trust and protection were not changed.

See [Vercel Trusted Sources](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources) and [project update API](https://vercel.com/docs/rest-api/projects/update-an-existing-project). The guided form's workflow field serialized a `workflow` claim; it was tightened to an explicit `workflow_ref` so access is bound to a file and branch instead of depending on a display name.

## External-file provider inventory

Authenticated UploadThing sign-in succeeded with the saved GitHub session. The `industrial` team has app `jfnry4acl6`, named `industrial`, showing 0 bytes in its dashboard. An existing local provider credential belongs to a different app, `8fnloww31u`; the supported metadata API reported five files and 1,859,070 app bytes, with default ACL `public-read`. The local app is not independently established as the production app. No file names, file keys, URLs, contents, or signed access links were inspected or downloaded, and neither app was changed.

The production Vercel project has a `sensitive` `UPLOADTHING_TOKEN` scoped to Production and a separate sensitive Preview entry. Its production value is not readable through the authenticated environment API; the attempted private inspection could not decode an available provider token and published no value. Do not substitute the local app or the empty industrial app, overwrite production provider credentials, or claim Convex snapshots cover either provider's files. Production association, external-file backup retention/restoration, and alert delivery remain explicit operational proof gaps. [UploadThing metadata API](https://docs.uploadthing.com/api-reference/ut-api) documents aggregate usage; [Convex backups](https://docs.convex.dev/database/backup-restore) cover Convex storage only.

## Backend issuer readback

Private, deployment-explicit `convex env get CLERK_JWT_ISSUER_DOMAIN` checks returned the reviewed issuer for both `trustera:industrial-sas:prod` and `trustera:industrial-sas:preview/ci-staging`. Only match booleans and command exit codes were published. This confirms the current backend JWT issuer configuration; it does not establish webhook delivery, authenticated application access, fixture cleanup, or the future build validator's issuer enforcement.

## Frozen-main public API comparison

The public-contract inventory was independently regenerated against a detached checkout of frozen main `cc42063335f1355b053a4544c5ed658dd0b6d1f2`: all nine contract tests passed. All 87 registered public argument/return validator contracts match exactly. New staging handlers are internal-only. This inventory proves validator compatibility; it does not strengthen existing broad `v.any()` payload schemas or imply successful invocation coverage for every public function.

## Credential-free generated-code verification

The final freshness helper uses the fixed Convex local-backend release `precompiled-2026-10-06-a3538c6`, with official platform-specific SHA-256 digests checked before extraction. It creates a fresh local instance/admin key, binds loopback only, disables the beacon, verifies instance identity and stops its owned backend before deleting private state. All ambient `CONVEX_*` variables and existing runtime environment/state are refused before setup. The private loopback selector is synthesized by the helper; it cannot select a cloud deployment. A real fresh run exited zero and matched committed generated output; 26 isolation/lifecycle/checksum regressions passed. This avoids CLI 1.46 anonymous initialization fetching an unpinned latest binary and leaving an unmanaged daemon.

## Credentialed browser privacy verification

The sensitive Chromium suites intercept each request and redirect hop through CDP, applying refreshed OIDC only to the exact reviewed staging origin. API requests follow redirects one hop at a time under the same origin policy. Real two-origin browser/API regressions passed. The custom reporter emits only fixed check labels/counts and static failure codes; an actual failing child suite confirmed no sentinel, raw errors, call logs, attachments, screenshots, traces, video or error-context artifacts were retained or printed. The anonymous production-mode suite passed all 70 checks with zero retries. All 16 workspace width/locale/theme combinations passed, and the default harness passed three consecutive zero-retry runs. These local checks are independent of the still-pending live staging rehearsal.
