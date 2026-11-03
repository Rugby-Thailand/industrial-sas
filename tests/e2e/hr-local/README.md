# Real local HR browser tests

This opt-in suite runs the shipping Next app and Convex handlers with a real
Clerk test session and the designated local test organization. It is separate
from credential-free smoke, the mocked storage workspace and staging/production.
The normal test-discovery gate lists it without credentials or starting services.

## Run

Install dependencies with `pnpm install --frozen-lockfile` and Chromium with
`pnpm exec playwright install chromium` if needed. In **this checkout**, create a
private ignored `.env.local` containing the following settings, using the
designated development Clerk instance's existing test keys privately:

```dotenv
CONVEX_DEPLOYMENT=anonymous:anonymous-agent
NEXT_PUBLIC_APP_URL=http://localhost:3110
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3320
NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3321
ALLOW_LOCAL_TEST_SEED=true
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_REPLACE_PRIVATELY
CLERK_SECRET_KEY=sk_test_REPLACE_PRIVATELY
CLERK_JWT_ISSUER_DOMAIN=https://REPLACE.clerk.accounts.dev
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/th/sign-in
```

The exact test identity is pinned in `scripts/lib/hr-e2e-env.mjs`, matching
`scripts/dev-login.mjs`. Setup verifies the actual Clerk user and organization
membership before seeding or issuing tickets. It does not create external Clerk
users or organizations. Never substitute production keys or a shared backend.
The publishable key's decoded host must match the issuer domain. Remote targets,
ambient selector overrides, missing seed consent, mismatching worktree state, and
occupied service ports fail closed. Do not copy the original checkout's database.

```sh
pnpm test:e2e:hr:local
# Focus one project or case, still using the same real services:
pnpm test:e2e:hr:local --project hr-mobile --grep 'Cancel'
# Discovery only: no environment file, services or authentication required.
pnpm exec playwright test --config playwright.hr-local.config.ts --list
```

The runner starts its own anonymous Convex instance on 3320/3321, configures its
Clerk issuer and seed opt-in, waits for the real functions, and runs Playwright.
Playwright owns a separate `.next-e2e` Next build on localhost:3110. Services are stopped on normal completion. After an abrupt interruption, inspect
the run-specific process journal and revoke only that run's recorded sessions;
Playwright teardown can be interrupted before its separately grouped web server
or session fixture finishes. Stop only those recorded process groups. The runner
refuses to reuse or stop existing services. Overall timeout is 20 minutes.
Do not run multiple suites against the pinned test account/database concurrently.

## Data and coverage

Setup uses the existing guarded bootstrap and HR seed. It seeds a second local
organization with real HR database rows for negative tenant checks; that fixture
actor never authenticates. Only the verified real Clerk account signs in.
Employee codes/reasons are unique per test. Fixture data is retained for review;
the suite does not destructively reset prior clock/correction records.

Desktop and mobile Chromium cover identity/read persistence, employee
create/edit/reload, native/header Back, explicit Cancel followed by next Back,
origin locale/query/hash, dirty Keep/Discard, Forward/refresh, clock persistence,
correction submission with original events retained, holiday persistence,
leave readiness for the retained policy state, foreign-site filtering and anonymous denial. Pending-save
coverage disconnects the browser's network, checks the real queued Convex write
blocks departure, reconnects and verifies the actual committed record.

With foundation source `92fe30f0` + `857d9f8e`, `foundation.spec.ts` adds real
company/bank persistence, PNG logo upload/readback/removal, branch persistence and
completion, pristine Cancel + next Back, nested dirty-dialog Keep/Discard,
department/position/level creation, employment assignments including branch and
workplace, employment type/probation edits, and legacy employee compatibility.
Company header Back uses the real sidebar settings link to establish provenance;
direct settings hubs have no invented parent. These cases run on both projects.

With protocol correction `cfd6dcdf`, `protocols.spec.ts` additionally verifies all
six employment fields survive an actual old-client mutation and UI reload. Two
real pages interleave logo changes while only editor A's genuine file reading is
delayed. The real backend refuses its stale upload/removal; the UI retains bytes
and requires explicit reapplication. Checks also cover pending file-read Back,
request replay after a newer upload, partial-upload/removal refusal without domain
metadata changes, legacy no-token refusal, delete/recreate ABA, and reload readback.
Authentication, Convex transport and backend are never mocked. Reports record the
exact checkout HEAD in metadata.

Clock writes run when a next action is available; cases with no new action are
reported as skipped. The `real-clock-writes` annotation reports the count
for each run. Correction tests choose an unused date and fail explicitly when
their finite pool is exhausted. Holidays use test-only future dates and can be
overwritten by later runs. No policy is automatically activated to enable leave.
Active-leave submission/claim locking and authenticated employee/supervisor role
checks have dedicated specs. Workplace-context checks cover English and Thai,
including storage selection preservation. Real leave approval with a separate
reviewer, full Thai workflow coverage and native device browsers remain outside
this suite. Mobile is Chromium emulation.

Private artifacts stay under ignored `test-results/hr-local/`,
`playwright/.auth/` and `.cache/hr-browser/`. They can include authenticated test
DOM, screenshots and SDK diagnostics; never upload them. Traces, videos and
storage-state exports are disabled. `.cache/hr-browser/processes.jsonl` records
owned process IDs, checkout, exit and cleanup events without credentials.
The fixture revokes only the Clerk session it created for that test, including
on assertion failure. Console reporting omits SDK output and raw errors, which
can contain token URLs; detailed reports remain private. Successful employee
persistence cases capture a desktop/mobile screenshot in the private artifacts.
