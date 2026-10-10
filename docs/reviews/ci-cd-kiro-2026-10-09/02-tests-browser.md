# Test and verification audit: industrial-sas (read-only)

> Coordinator verification (2026-10-09): the consolidated audit is the implementation authority. Installed convex-test 0.0.54 validates both arguments and returns on registered query/mutation/action calls (dist/index.js:1648-1707), confirming T3. Clerk Testing Tokens support both development and production instances; they bypass bot protection and do not establish application authorization. Production helper limitations and candidate-host configuration still apply. Reuse deleted tests only after adapting them to surviving modules. Browser-download caching is optional; install the browsers matching pinned Playwright with system dependencies first. Required smoke tests should start with zero retries; diagnostic retries must fail on flakes (supported by installed Playwright 1.62.1). For production rollback use the rollback command, not a rebuild. The unsigned-webhook probe establishes fail-closed routing/secret presence, not valid-secret correctness or a complete identity-sync flow.

Scope: local HEAD `0e9ea3a` plus the uncommitted HR/search work. I read files, ran `git show`/`grep`, and read the installed Next docs (`01-app/02-guides/testing/{playwright,vitest}.md`, `environment-variables.md`, `06-cli/next.md`). I ran no tests, builds or browsers. I did not verify live GitHub, Vercel, Convex or Clerk settings.

## Main findings

1. **Security tests were deleted but the code still runs.** Commit `983fb5a` (2026-09-19) removed the ERP modules. It also deleted the dedicated tests for code that still ships: the Clerk webhook, identity mirror, tenant functions, tenant index policy, authorization enforcement, permissions and `workspace/current`. Today no test references `clerkWebhook`, `clerkWebhookNormalizer`, `identityWebhook` or `identityMirrorConvex`. The production route is still live (`convex/http.ts:4`). `svix` (`package.json:79`) is now unused, and the `property` project is empty because `tests/properties/identity-webhook.property.test.ts` was deleted too. The dirty work also changes `tenantDb`, `tenantFunctions`, `permissions` and `schemaPolicy`.
2. **A working browser test suite existed and was deleted in the same commit.** It had `playwright.config.ts`, `.github/workflows/e2e.yml`, and route, locale and header specs. Comments still describe coverage that no longer exists: `.gitignore:21,25,40,46`, `vitest.setup.ts:74,90` and `eslint.config.mjs:19`.
3. **Most backend tests skip Convex's argument and return validators.** There are 58 `_handler` calls in the tests and only 3 registered calls (`t.mutation`/`t.action(api…)`). The wrappers declare `args`/`returns` (`convex/lib/tenantFunctions.ts:800,852`), but `_handler` bypasses checking them.

## Practices

### T1 Vitest project split, two shards, single aggregate gate

- **Classification:** KEEP · P0
- **Evidence:** seven projects (`vitest.config.mts:22-90`); shards (`.github/workflows/quality.yml:30-38`); strict `check` job (`:58-73`); no Vitest retries.
- **Discovery (static, confirmed):** 151 test files (132 tracked, 19 untracked HR/search). All of them match a project glob. I did not re-check shard balance.
- **Why it works:** pure Node tests are separated from DOM tests, and a mocked `convex/react` runs only for the jsdom projects (`vitest.setup.ts:8-49`).
- **Caveat:** a test placed outside the globs is silently never run, for example `convex/lib/*.test.ts` or `scripts/**`. T11 adds a guard.

### T2 Restore the security tests that cover surviving code

- **Classification:** ADD NOW · P0 (production auto-release raises the stakes)
- **Evidence:** the subjects of these tests still exist: `convex/lib/clerkWebhook.ts:56-85`, `identityMirrorConvex.ts`, `tenantFunctions.ts`, `tenantIndexPolicy.ts`, `schemaPolicy.ts`, `permissions.ts` and `authorizationLookupsConvex.ts`. Their deleted tests can be recovered from `983fb5a^`:
  - `clerk-webhook-{handler,normalizer,wiring}`
  - `identity-mirror-convex`
  - `identity-webhook`
  - `tests/isolation/clerk-webhook-route`
  - `tests/properties/identity-webhook.property`
  - `tenant-functions`, `tenant-index-policy`, `authorization-enforcement`
  - `permissions`, `schema-contracts`, `workspace-current`
- **Coverage today:** only indirect. Feature tests call `_handler`; there is a single isolation file (`tests/isolation/storage-positions.isolation.test.ts`).
- **Placement:** existing `tests/integration`, `tests/isolation` and `tests/properties`; they run in the existing PR shards.
- **Smallest change:** restore only tests whose subject modules still exist. Drop the ERP routes and the UploadThing route assertions. Recreate a minimal `tests/fixtures/identity-mirror-port.ts`.
- **Acceptance (behavioral):**
  - missing signing secret → 503; bad signature or bad `svix-*` metadata → 400;
  - a valid signed event is applied once; a replay returns `REPLAY`; an out-of-order event returns `STALE`;
  - a cross-tenant function call is denied;
  - every tenant table satisfies the index policy, including the new HR tables;
  - a deliberate local mutation (verify always succeeds, or the org check is removed) makes the suite fail.
- **Cost:** about 1–2 days of adaptation, mostly on the test side.

### T3 Test registered Convex functions, not `_handler`

- **Classification:** ADD NEXT · P1
- **Evidence:** `_handler` pattern at `tests/isolation/storage-positions.isolation.test.ts:24,44` and in most integration files. The correct pattern already exists in `tests/integration/global-search.integration.test.ts:686-745` (modules map plus `t.action(api…)`).
- **Placement:** add a `callRegistered` helper to `tests/fixtures/convex-tenant-world.ts`. Migrate one representative query or mutation per public module (storage layouts, finished goods, HR, workspace).
- **Why:** a mismatch between a function's return value and its `returns` validator fails only in a real deployment.
- **Acceptance:** changing a sample return shape makes the registered-call test fail while the `_handler` test still passes.
- **Assumption to verify:** that convex-test 0.0.54 enforces args and returns validators.

### T4 Credential-free Playwright smoke on every PR

- **Classification:** ADD NOW · P1
- **Evidence:** no Playwright config exists today. The deleted config (`983fb5a^:playwright.config.ts`) ran `next start`, desktop plus Pixel 5 Chromium, `forbidOnly`, CI retries, and traces/screenshots only on failure.
- **Hooks that still exist:** the `NEXT_DIST_DIR` hook (`next.config.ts:12-16`), and `@playwright/test` and `@axe-core/playwright` are installed (`package.json:55,57`).
- **Next guidance:** Next recommends E2E tests against a production build. Its Vitest guide says async Server Components are not supported, and the access gate is an async layout (`src/app/[locale]/(desktop)/layout.tsx:10-20`).
- **Placement:**
  - new files: `playwright.config.ts` and `tests/e2e/*.e2e.spec.ts`;
  - steps added to the existing `build` job after `pnpm build` (`quality.yml:55`), so it reuses `.next` with no artifact handoff;
  - cache browsers using the old `e2e.yml` cache-key pattern;
  - if it becomes a separate job instead, add it to `check.needs`.
- **Specs:**
  - each current private route redirects to `/th/sign-in` and `/en/sign-in` (master data, finished goods, setup, HR);
  - `/` redirects to `/th`, and a catch-all route returns not-found;
  - public pages render;
  - the configured security headers are present (this tests the `next.config` wiring, not just `src/lib/securityHeaders.test.ts`);
  - with identity unconfigured, the sign-in page shows no password field;
  - no `pageerror` events;
  - axe reports no serious or critical violations on the sign-in and public pages.
- **Projects:** desktop Chromium and a 360/390 px mobile Chromium.
- **Trust:** no secrets. Fork PRs are safe.
- **Acceptance:** removing the layout redirect or `headers()` fails CI. The added wall time is under ~4 minutes.
- **Caveat:** this only exercises the unconfigured branch of `src/proxy.ts:13-19`; real Clerk middleware is covered by T6. Also fix the stale comments listed in finding 2.

### T5 Turn the storage workspace harness into a CI project

- **Classification:** ADD NEXT · P2
- **Evidence:** the harness is run by hand against a server started by hand (`scripts/storage-workspace-preview/README.md:3-24`). It uses fixed sleeps (`verify.mjs:21,29`) and always records video (`verify.mjs:11`). `responsive.mjs:77` already runs axe across 16 viewport/locale/theme combinations.
- **Placement:** `tests/e2e/workspace/` as a second Playwright project. Its `webServer` runs `pnpm preview:storage-workspace` on 127.0.0.1:3190, in the same PR job.
- **Change:** replace sleeps with web-first assertions, turn video off, and keep geometry assertions instead of pixel snapshots. Keep camera.mjs's "one React update per 50-move drag" check as a fixed-count performance budget.
- **Acceptance:** it passes three consecutive CI runs with no retries and does not need the ignored `output/workspace-qa/f1-f2-fixture.json`.

### T6 Authenticated smoke on trusted staging before production

- **Classification:** ADD NOW (a prerequisite for the auto-release cutover) · P0
- **Placement:** a release workflow job `staging-smoke` that runs only for pushes to `main` after `check` passes on the same SHA, in GitHub environment `staging` with no reviewers. It must finish before the production `convex deploy`.
- **Targets:** a persistent staging Convex deployment, a Clerk development instance, and a staging frontend built with the test keys.
- **Flows (1 worker):**
  - sign in; check the organization and warehouse context;
  - create and edit a layout, then read it back;
  - place and move a finished-goods pallet, then read it back;
  - a warehouse-scoped user is denied another warehouse;
  - a cross-tenant URL is denied.
- **Trust:** PR code never receives these credentials.
- **Prerequisites:** verified preview/staging isolation (the README warns the old Preview variables point at a different backend), plus a scoped staging deploy key.
- **Acceptance:** a seeded authorization regression fails the job and blocks production. The job finishes in under 10 minutes.

### T7 Clerk test-auth fixture

- **Classification:** ADD NOW · P1 (with T6)
- **Evidence:** `scripts/dev-login.mjs` already refuses non-test keys (`:75`) and mints a 300-second sign-in token passed as `__clerk_ticket` in the URL (`:123-129`).
- **Placement:** a Playwright setup project, `tests/e2e/auth.setup.ts`. It writes storage state to an ignored `tests/e2e/.auth/` folder (add it to `.gitignore`), deletes it in teardown, and never uploads it.
- **Change:** generalize the `sk_test`/`pk_test` guard into a shared module that refuses live keys. Prefer `@clerk/testing` (pinned exactly) or the existing sign-in token pattern.
- **Assumptions to verify:** that Clerk Testing Tokens work only on development instances, and that `@clerk/testing` is compatible with `@clerk/nextjs` 7.7.4.
- **Caveat:** ticket URLs and session cookies end up in traces (see T10).

### T8 Staging test-data lifecycle

- **Classification:** ADD NOW · P1
- **Evidence:** every seed refuses non-loopback targets (`convex/staging/annexDemo.ts:211-228`, plus the HR, pagination and UI demo seeds), and the refusals are tested (`hr-demo-seed:33`, `pagination-seed:58`). Keep those guards.
- **Placement:** a new `convex/staging/e2eFixture.ts` with internal functions:
  - it refuses unless the Convex environment variable `E2E_FIXTURE_DEPLOYMENT` matches the staging deployment, and a confirmation string is supplied;
  - it sets up a fixed test org and membership mirror;
  - it uses run-namespaced codes (`E2E-<run_id>`);
  - it processes at most 25 records per call;
  - it provides cleanup plus a sweep of records older than 24 hours.
- **Run with:** `convex run` and the staging deploy key.
- **Why a persistent deployment:** Clerk webhooks need a stable endpoint, and per-branch Convex previews have different URLs. This is an assumption to verify.
- **Acceptance:** a unit test shows the fixture throws when the variable is absent; this matters because the function is deployed to production too. Concurrent runs do not collide. Zero `E2E-*` records remain after cleanup.

### T9 Read-only smoke on the production candidate and after release

- **Classification:** ADD NOW · P0
- **Restrictions:** no writes, no seeds, no production session at first.
- **Checks:**
  - an unauthenticated private route redirects to `/th/sign-in`;
  - the sign-in page HTML does not show the "unavailable" state (`SignInScreen.tsx:25-45`);
  - the security headers are present;
  - an unsigned `POST https://greedy-cardinal-537.convex.site/webhooks/clerk` returns **400**, which proves the signing secret is configured; **503** means it is missing (`clerkWebhook.ts:58-68`). Verification fails before anything is applied, so there are no side effects;
  - the bundled Convex URL equals the expected production deployment.
- **After promotion, on the real domain:** the Clerk sign-in widget mounts.
- **Placement:** tag specs `@prod-safe`. In the release job, run them after the candidate is created and before promotion, then again after promotion.
- **Caveats:**
  - production Clerk will not work on `*.vercel.app`, and how the middleware handshake behaves on a mismatched domain is unverified. Run server-side checks only, or use an owned candidate hostname;
  - pass the deployment-protection bypass through `extraHTTPHeaders`.
- **Authenticated production smoke:** CONDITIONAL. It needs a production Clerk secret with access to real users, or a synthetic account. Defer it.

### T10 Report and trace safety

- **Classification:** ADD NOW · P1
- **Why:** the repository is public, so treat artifacts as public.
- **PR runs:** keep failure-only HTML report and traces with 7-day retention, as the old `e2e.yml` did.
- **Staging and production runs:** trace, video, HAR and storage state off; screenshots off or synthetic-only; upload JUnit and a step summary only.
- **Acceptance:** a test asserts the staging/production config sets `trace: 'off'`, and the artifact listings contain no `.auth` files.

### T11 Machine-readable reports, shard merging and a discovery guard

- **Classification:** ADD NEXT · P2
- **Placement:** in the shard step, use the blob reporter; add a `test-report` job running `vitest --merge-reports --reporter=junit` and upload the result.
- **Assumption to verify:** that Vitest adds GitHub annotations automatically when no reporters are configured. If so, list `github-actions` explicitly once reporters are customized.
- **Discovery guard:** a test that compares `git ls-files '*.test.*' '*.spec.*'` against the project globs plus `tests/e2e`.
- **Cost:** about 30 seconds of extra job time.

### T12 Coverage

- **Classification:** CONDITIONAL · P3
- `@vitest/coverage-v8` is not installed. Use informational coverage merged from the blobs, focused on `convex/lib/**`. Do not set a global threshold. Consider file-level floors for the webhook and tenant files only after T2 sets a baseline.

### T13 Flakes, durations and budgets

- **Classification:** ADD NEXT · P2
- **Playwright:** `forbidOnly`; retries 2 on PRs and 1 on staging and production; report flaky tests as annotations.
- **Vitest:** keep zero retries.
- **Scheduled run:** weekly against `main` for the e2e and harness projects. Scheduled workflows are disabled after 60 days of repository inactivity.
- **Budgets:** use fixed counters only (T5). Lighthouse and bundle budgets are NOT APPLICABLE yet: there is no baseline, and `next experimental-analyze` is experimental.

### T14 i18n, accessibility and device checks

- **KEEP:** `src/i18n/messages.test.ts` (key parity, empty messages, placeholders) and the five jsdom axe tests.
- **ADD NOW (in T4):** browser axe, which catches contrast and layout issues jsdom cannot.
- **ADD NEXT:** a Chromium fake-camera QR test using `--use-file-for-fake-video-capture` for `DestinationScanner`/`useBarcodeCamera`.
- **Physical camera check:** CONDITIONAL. Make it a PR-review checklist item when scanner or `PhotoCapture` files change, not a release gate.
- **WebKit:** CONDITIONAL on iOS devices being in use.

### T15 Existing guard and compatibility tests

- **Classification:** KEEP
- `production-schema-compatibility.integration.test.ts`: refresh the dated fixture after reviewed production schema changes.
- `vercel-ignore-build.integration.test.ts`.
- The seed guard tests.

## Corrections to the prior plan

1. Its claim "no property gap" is incomplete: the security tests deleted in `983fb5a`, including the property test, are the largest gap.
2. "Establish Playwright" should read "restore and adapt the deleted credential-free suite".
3. Step 8 puts locale, viewport and accessibility checks in staging. Run them on PRs without credentials; staging only needs the real-auth flows.
4. "Verify production Clerk auth on the candidate" needs high privilege and an owned hostname. Make it conditional and use the side-effect-free probes in T9.
5. "Production smoke writes if necessary" should be "no production writes". Convex is already deployed when the candidate is tested.
6. The coverage thresholds in step 11 come after T2, not before.
7. Step 12's "performance budgets" should be fixed counters only.
8. Stale fixtures README: `tests/fixtures/README.md` still references the deleted `tenant-storage-port.ts`.

## Cross-domain dependencies

- **Root/GitHub:** the required `check` must include the new e2e results. Create a `staging` environment holding the staging secrets.
- **Root/Vercel:** verify preview isolation, the protection bypass secret, and an owned candidate domain.
- **Root/Convex:** a staging deployment and deploy key, and the `E2E_FIXTURE_DEPLOYMENT` variable set on staging only.
- **Root/Clerk:** a development instance, its webhook pointed at the staging `convex.site`, and a test user and org.
- **Release ordering:** staging smoke runs before the production Convex deploy, then the candidate smoke, then promotion, then the post-release smoke.

## Confirmed vs assumed

- **Confirmed (repository evidence):** findings 1–3, T1 discovery, the harness's sleeps and video, the dev-login token-in-URL behavior, the seed guards, and the webhook's 400/503 behavior.
- **Assumed (needs verification):** convex-test validator enforcement, Clerk Testing Tokens being development-only, middleware behavior on a mismatched domain, Vitest's default annotations, and all live platform settings.

Suggested docs for root to check:

- https://playwright.dev/docs/test-webserver
- https://playwright.dev/docs/auth
- https://clerk.com/docs/testing/playwright/overview
- https://docs.convex.dev/testing/convex-test
- https://vitest.dev/guide/improving-performance#sharding
- https://vitest.dev/guide/reporters

## Summary

| ID  | Practice                                    | Class       | Pri   | Placement                                      |
| --- | ------------------------------------------- | ----------- | ----- | ---------------------------------------------- |
| T1  | Vitest projects, shards, aggregate          | KEEP        | P0    | `quality.yml`, `vitest.config.mts`             |
| T2  | Restore security tests                      | ADD NOW     | P0    | `tests/integration`, `isolation`, `properties` |
| T3  | Registered-function tests                   | ADD NEXT    | P1    | `convex-tenant-world` helper                   |
| T4  | Credential-free PR Playwright               | ADD NOW     | P1    | `build` job, `playwright.config.ts`            |
| T5  | Harness → CI project                        | ADD NEXT    | P2    | `tests/e2e/workspace`                          |
| T6  | Trusted staging auth smoke                  | ADD NOW     | P0    | release job, `staging` env                     |
| T7  | Clerk test-auth fixture                     | ADD NOW     | P1    | `auth.setup.ts`                                |
| T8  | Staging data lifecycle                      | ADD NOW     | P1    | `convex/staging/e2eFixture.ts`                 |
| T9  | Read-only prod candidate/post-release smoke | ADD NOW     | P0    | release job, `@prod-safe`                      |
| T10 | Report/trace safety                         | ADD NOW     | P1    | Playwright configs, uploads                    |
| T11 | Blob/JUnit merge, discovery guard           | ADD NEXT    | P2    | `test-report` job                              |
| T12 | Coverage                                    | CONDITIONAL | P3    | merge job                                      |
| T13 | Flakes, schedule, budgets                   | ADD NEXT    | P2    | Playwright config, schedule                    |
| T14 | i18n/a11y/device                            | KEEP + ADD  | P1–P3 | unit, e2e, PR checklist                        |
| T15 | Schema/ignore/seed guard tests              | KEEP        | P1    | existing tests                                 |
