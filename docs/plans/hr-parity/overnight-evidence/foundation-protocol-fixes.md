# Foundation protocol corrections P1 and P2

Implementation lane, 2026-11-01 Bangkok. This is implementation evidence, not an
independent review. Coordinator must commission cross-check and real browser/backend
verification. No subagents, production deployment, shared-demo writes, push, or PR.

## Checkout and dependencies

Only `/Users/macbook/.t3/worktrees/industrial-sas/t3-bc5a163b` was modified. The
T3-prepared branch is `t3/employee-logo-protocol-fixes`. Executed exactly:

```sh
git cherry-pick 92fe30f0 857d9f8e eb5542ac
```

Local equivalent foundation commits are `a7651db4`, `d351d0c3`, `92af42fd`, in that
order. P3 is inherited unchanged from the third commit. Its partial-upload+remove
regressions remain registered-mutation tests; this lane did not reimplement P3.

Read the complete independent review at the requested `t3-e98679ab` path (report
`75377d68`), overnight authorization plan, AGENTS.md, Back contract and relevant
inventory, backend compatibility policy, and installed Next 16.3.8 `use-client` and
App Router `use-search-params` guides. No route or URL state was added.

## Interfaces for integration

P1: `hr/setup:saveEmployee` adds **`replaceOrgFields?: true`**. The current
EmployeeForm sends `replaceOrgFields: true` beside `requestId`. Its complete replacement
group is exactly `branchId`, `departmentId`, `positionId`, `levelId`, `employmentType`,
and `probationEndDate`:

- Marker present: omitted members clear; supplied members replace.
- Marker absent: each omitted member retains its stored value; each supplied member
  updates independently. Create has no saved fields to inherit.
- Validate the effective merged group, including retained probation dates and
  tenant/current-inactive reference rules. ACTIVE required-assignment constraints,
  optimistic employee version, request replay, and audit remain enforced.
- Existing old fields retain their previous replacement semantics. No profile/lifecycle
  fields from the other lane are added or altered here. The provisional legacy ACTIVE
  unassigned exception is unchanged and remains a product-policy limitation.

P2: `hr/org:getCompanyLogo` still returns `null` when absent; a present image adds
**`revision: { id: Id<"hrCompanyLogos">, version: number }`** beside `mimeType` and
`base64`. `saveCompanyLogo` adds **`expectedRevision?: null | { id, version }`**:

- `null` observes absence. Present tokens must match row ID and positive safe integer
  version for either replacement or removal. Row identity fences delete/recreate ABA.
- No token is legacy; it is allowed only when no logo currently exists. It cannot
  replace or remove an existing logo. Recovery: retain the file, reload the matching
  frontend, inspect the current logo, explicitly submit against that observation.
- Stale commands return `LOGO_STALE`; invalid numeric revisions return
  `LOGO_REVISION_INVALID`; registered validators reject malformed token objects.
- Successful request replay precedes live revision checks, so replay never resurrects
  an old upload or deletes a later logo. Changed payload/request reuse still refuses.
- Stale/refused commands do not change the logo or profile metadata. The standard
  command envelope may append a denied audit event. Successful audit stores presence
  changes, never base64. Profile and logo commands/version ownership remain independent.
- The typed read flows from the registered return through `hrRefs`; the UI uses
  `RefValue<typeof hrRefs.companyLogo>`. The reviewed API snapshot includes both new
  optional arguments without a breaking-contract override.

UI captures expected revision **before file reading**, blocks departure during reading
and pending mutation, and keeps selected bytes/filename on stale or uncertain outcome.
Query refresh cannot rebase a command. **Apply selected file to current logo** is an
explicit new intent and request ID using the reviewed current observation. Uncertain
retry retains the exact original payload across refresh/remount. Full reload does not
persist image bytes; existing request reconciliation remains available. The logo editor
is keyed by tenant/actor identity so old file reads and selected drafts cannot cross
identity changes. Unsaved profile text is independent.

Incremental fix commit: `cfd6dcdf` (`fix(hr): preserve legacy employee fields and
fence logo revisions`), directly on local dependency `92af42fd`.

Integration locations on this commit:

- `convex/hr/setup.ts:623`: optional marker; `:703`: six-field effective merge;
  `:725`: effective date validation; `:778`: persisted/audited effective fields.
- `src/features/hr/EmployeeForm.tsx:281`: **single added payload line**
  `replaceOrgFields: true,` beside `requestId`. The employee lifecycle lane should
  carry that line into its current form and retain the additive arg + merge in its
  setup mutation while integrating its own new fields. No profile field overlap here.
- `convex/hr/org.ts:121`: logo query adds revision; `:147`: optional expectedRevision;
  `:183`: safe-integer/revision comparison before any domain write.
- `src/features/hr/HrCompanyProfile.tsx:524`: identity-keyed logo editor;
  `:594`: capture revision before async file read; `:610`: capture removal revision.
- `tests/fixtures/public-function-contract.json`: only two optional argument additions;
  no schema/generated-file changes or breaking-contract override.

## Diagnosing feedback loop and red-to-green evidence

Permanent tests were added before either production correction. The shared slice-01
helper was changed from direct `_handler` invocation to real registered Convex query /
mutation calls, with all four modules registered in `createConvexTenantWorld`. The
all-endpoint authorization loop now also supplies valid args through registration.
These exercise argument/result validators and schema-backed persistence in convex-test.
They are not deployed-backend or production OCC scheduling evidence.

Original tight command:

```sh
pnpm exec vitest run tests/integration/hr-parity/01-org-positions.test.ts --maxWorkers=2 -t 'protocol:'
```

Red before fixes: **3 failed, 18 not selected** (662 ms). ACTIVE old name edit returned
`DEPARTMENT_REQUIRED`; INACTIVE edit erased all six fields; fresh no-token logo removal
returned `written: true` instead of `LOGO_STALE`. Log `/tmp/hr-protocol-red.log`.
Green immediately after fixes: **3 passed, 18 not selected** (536 ms), same command.
Log `/tmp/hr-protocol-green-initial.log`. Not-selected cases are not credited.

Ranked hypotheses stated before fixing: raw request rather than effective employee
values drives both validation/persistence; no observed logo revision is compared; a
version-only token would still have ABA after row recreation. The fixes test those
predictions by merging once for persistence/validation and comparing row ID + version.

The pre-fix UI file-read reproduction also went red: native Back left settings while
`arrayBuffer()` was unresolved. The permanent final case verifies pending protection,
old revision capture despite live refresh, retained stale upload, explicit reapplication,
and subsequent Back to the actual origin. The initial uncertain-retry UI run additionally
had a test-label mismatch (`Retry safely` versus actual `Try again safely`); that was a
harness mistake, not a production defect. Another new nested-history assertion initially
raced asynchronous explicit Cancel traversal; the final case waits for the captured
history index to be consumed before the next Back. No timeouts or gates were loosened.

Registered coverage includes all six fields for ACTIVE/INACTIVE old unrelated-name
edits, modern permitted clears, refused required ACTIVE clears, individual legacy
supplied updates, stale/missing employee versions, current inactive reference retention,
new inactive/foreign reference refusal, effective retained-date validation, replay and
audit. Logo cases cover two observers, replace/remove, absent create races, delete/recreate
ABA, replay after later writes, changed replay payload, malformed token and upload shapes
including P3, tenant/auth denial, site-denied employee changes, and domain metadata
nonmutation. UI covers revision pinning, pending header/native Back, stale file retention,
explicit new intent, uncertain retry/remount, identity/unmount read cancellation, nested
branch Cancel, discarded selected draft + next Back, locale/query/hash and Forward.
The exact selected-file inline presentation owner is audited in the Back inventory.

## Final verification

Environment: Node 24.19.0, pnpm 10.33.2, Next 16.3.8, Convex 1.46.0, Vitest 4.1.11.
Installed with unchanged lockfile via `pnpm install --prefer-offline` (exit 0).
Worker limit was **2** on every Vitest invocation. No test timeout was raised and
no assertion, test, or CI gate was removed/disabled.

| Command / scope                                                      | Exit | Actual outcome                                                                                                                                                            |
| -------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final targeted eight-file Vitest command below                       | 0    | **8 files / 348 passed**, 9.01 s. Includes **31 registered slice-01 integration cases**, **25 settings UI cases**, employee caller suites and API contract gates.         |
| Broader HR command below                                             | 1    | **45 files / 742 passed; 1 file / 1 failed** (743 tests total), 81.69 s. `HrPagination.test.tsx` first case exceeded its existing 5 s timeout. This remains a failed run. |
| Bounded `HrPagination.test.tsx` recheck, same workers and timeout    | 0    | **9 passed**, 6.99 s; the failure did not reproduce in isolation. This does not establish the cause or prove it unrelated.                                                |
| Strengthened exact review-logo repro at inherited org implementation | 1    | **1 failed / 30 not selected**, 1.04 s: A -> B -> stale removal incorrectly returned written:true.                                                                        |
| Same strengthened logo repro with correction restored                | 0    | **1 passed / 30 not selected**, 1.45 s.                                                                                                                                   |
| `pnpm lint`                                                          | 0    | Normal repository ESLint, final run after all production/test changes.                                                                                                    |
| `pnpm check:navigation`                                              | 0    | **68 Node fixture cases passed**; 58 route/error policies, 302 exact owners, 26 action intents.                                                                           |
| `pnpm typecheck:ts6`                                                 | 0    | Next route type generation and TypeScript 6 pass, final source/tests.                                                                                                     |
| `pnpm exec tsc --noEmit -p convex/tsconfig.json`                     | 0    | Convex TypeScript project passes.                                                                                                                                         |
| `pnpm ci:codegen`                                                    | 0    | Credential-free throwaway loopback backend; committed generated bindings exactly match pinned CLI output.                                                                 |
| `pnpm typecheck`                                                     | 1    | **Blocked: Bun 1.4.3 not on PATH**. Full Bun checker did not run; TS6 is separate evidence.                                                                               |
| `pnpm ci:test-discovery`                                             | 0    | **378 Vitest files / 17 Playwright specs**. Discovery is not browser execution.                                                                                           |
| Scoped `pnpm exec prettier --check`                                  | 0    | All 13 changed source/test/docs files including this evidence match formatting.                                                                                           |
| `git diff --check`                                                   | 0    | No whitespace errors.                                                                                                                                                     |
| Reviewed public API snapshot refresh (command below)                 | 0    | **10 passed**; only additive optional args, no breaking override.                                                                                                         |

Final targeted command (log `/tmp/hr-protocol-targeted-final.log`):

```sh
pnpm exec vitest run \
  tests/integration/hr-parity/01-org-positions.test.ts \
  convex/model/hr/org.test.ts \
  src/features/hr/HrOrgSettings.test.tsx \
  src/features/hr/EmployeeForm.employment.test.tsx \
  src/features/hr/EmployeesNavigation.test.tsx \
  src/features/hr/Payslips.test.tsx \
  tests/integration/public-api-registered-coverage.integration.test.ts \
  tests/integration/public-function-contract.integration.test.ts --maxWorkers=2
```

Broader command (log `/tmp/hr-protocol-hr-suite.log`):

```sh
pnpm exec vitest run tests/integration/hr-parity convex/model/hr src/features/hr \
  tests/integration/public-api-registered-coverage.integration.test.ts \
  tests/integration/public-function-contract.integration.test.ts --maxWorkers=2
```

Bounded failure recheck:

```sh
pnpm exec vitest run src/features/hr/HrPagination.test.tsx --maxWorkers=2
```

Snapshot refresh:

```sh
UPDATE_PUBLIC_CONTRACT=1 pnpm exec vitest run --project integration \
  tests/integration/public-function-contract.integration.test.ts --maxWorkers=2
```

The strengthened logo repro uses `-t 'legacy stale logo command'` in the slice-01
file. A temporary, `finally`-restored swap of **only this checkout's** `convex/hr/org.ts`
to `git show 92af42fd:convex/hr/org.ts` established the old registered behavior.
No checkout or branch switch was made; the fixed production source was restored before
all final checks. The permanent test uploads B through registration using a revision
when the read supplies one; this lets the exact A -> B -> stale command scenario run
against both protocols without a validator-only false reproduction.
Logs: `/tmp/hr-protocol-logo-review-{red,green}.log`.

All counts above overlap; do not add them into a coverage total. Additional development
runs exposed/fixed test harness mistakes (syntax, actual refusal code, provider-preserving
rerender, anonymous denial throws, modal-hidden controls, and consumed-history timing).
They are not credited as passing acceptance or used to erase any failed broader run.
Initial navigation/lint correctly refused the undeclared selected-file state; its exact
inline semantic targets and literal caller cases were then reviewed into the inventory.

## Limits and cleanup

No actual browser, Clerk-authenticated deployed/local app workflow, physical navigation,
real upload against a deployed backend, or production build is claimed. All UI checks
are React/jsdom with mocked queries/mutations; persistence checks are registered
convex-test. Local codegen uses the repository's credential-free, checksum-verified
throwaway loopback backend and cleans up its owned process/state. No other checkout was
changed. No full-repository Vitest rerun is claimed; the independent review's earlier
full-suite failures remain unresolved, not established baseline or proven unrelated.

All commands ran in this checkout. Owned asynchronous sessions were `45073`
(install), `82806`, `2049`, `81458`, `98518`, `1222`, `83455`, `27807`, `36477`
(slice-01 / protocol development and differential checks), `27730`, `56671`, `54037`,
`18250` (UI feedback loops), `93961` (broader HR), `36639` (pagination recheck),
`4444` (final targeted), `36398`, `2366`, `67926`, `64361` (navigation), `62544`,
`61490`, `39368` (normal ESLint), `96324`, `65377`, `73665` (TS6), `93028`
(Convex TS), `13256` (snapshot refresh), `36551` (Bun blocker), `19104` (discovery),
`15499`, `90218` (formatting), and `2486` (local codegen and its internally owned
backend). Every session completed and its outcome was read before handback. Synchronous
commands also completed. No application/browser server or detached job was started.
The codegen script stopped its private backend and removed temporary local state;
no `.convex` or generated deployment env file remains in this checkout. No owned
process remains. Other lanes/main/source processes were not touched.

The fix commit above and this evidence commit are local only. The coordinator should
cherry-pick the fix onto its already-carried foundation, then independently cross-check
and integrate the employee lane's broader form/setup additions.
