# Combined HR integration checkpoint (2026-11-01)

Owner: Claude Opus 5.5, isolated T3 checkout
`/Users/macbook/.t3/worktrees/industrial-sas/t3-7c68a2e0`, branch `t3/7c68a2e0`.
Work window 23:02–23:20 Bangkok. Not pushed, no PR, no deployment, no shared
demo writes. The dirty main checkout and the original Phase 1 worktree were
not touched.

**Status: integration base only.** The employee slice 03 is **not approved**:
its independent review (`dd533481`,
`t3-c1f12690/docs/plans/hr-parity/overnight-evidence/employee-lifecycle-review.md`)
requested changes (F1–F6), and a separate Codex hardening lane owns those fixes.
Those fixes are not in this branch.

## Source commit map

Base `a2e964e2`. Cherry-picked with `-x` in dependency order. Each source
commit is recorded in its trailer.

| Combined   | Source                                     | Lane / content                              |
| ---------- | ------------------------------------------ | ------------------------------------------- |
| `08d6065b` | `92fe30f0`                                 | foundation (t3-bc5a163b lineage)            |
| `75e0c371` | `857d9f8e`                                 | foundation logo object args                 |
| `10da1427` | `eb5542ac`                                 | P3 partial-upload remove fix                |
| `6fcd7131` | `cfd6dcdf294648b16aa2a3796984bc44a4f79030` | protocol fix (replaceOrgFields, logo fence) |
| `d28ab264` | `962b3a6982e11b1816531a8d9f67652283342455` | protocol evidence                           |
| `5cc53de6` | `b747d38b`                                 | Kiro work rules (t3-a8227af8)               |
| `9cf1d1e3` | `bfdb9ec7`                                 | Kiro evidence                               |
| `0a11827f` | `dc26a397`                                 | employee backend (t3-0768cfe9)              |
| `22b474fd` | `e40127a1`                                 | employee omitted-field fix                  |
| `6f8a85e0` | `1a53d2b1`                                 | employee editor sections                    |
| `7b9697f5` | `5c569ae2`                                 | employee spec/evidence                      |
| `fed39093` | new                                        | contract snapshot + cross-lane regression   |
| (this doc) | new                                        | evidence                                    |

The duplicate employee-lane foundation commits `47f36c35`/`81c1cb58` were not
picked. Their trees are byte-identical to `92fe30f0`/`857d9f8e` (`git diff`
is empty), and the protocol lineage `a7651db4…92af42fd` has the same tree as
`92fe30f0…eb5542ac`.

## Conflict resolution

All 11 cherry-picks applied **without textual conflicts**. The overlaps named
in the brief were then checked by hand:

- `EmployeeForm.tsx`: `replaceOrgFields: true` sits beside `requestId`. The
  employee lane's separation hint and the disabled ACTIVE option are kept.
  This is the only `saveEmployee` caller in `src/`.
- `convex/hr/setup.ts` `saveEmployee` keeps the protocol's effective
  six-field merge, effective-draft validation and reference validation. It
  also keeps the employee lane's `separationPreserved` guard (which runs
  before the merge) and its `status` filter `ACTIVE|INACTIVE|PROBATION|FORMER|ALL`
  with `employmentState`/`separation` in registry rows.
- `convex/hr/employeeProfile.ts` `recordEmploymentEvent` patches only
  status, probationConfirmedDate, employmentEndDate, separation and version,
  never the org fields.
- `messages/{en,th}.json`, `docs/contracts/back-navigation.json`,
  `convex/_generated/api.d.ts`, `src/lib/convex/hrApi.ts`: all JSON is valid,
  the navigation gate passes, and codegen matches the pinned CLI output.
- **One real integration defect, fixed in `fed39093`:**
  `tests/fixtures/public-function-contract.json` failed against the
  registered validators. Kiro's `b747d38b` added optional `workRules` to
  `hr/policies:saveDraft` without refreshing the reviewed snapshot (its 681
  HR tests did not include this contract test). I regenerated it with the
  documented `UPDATE_PUBLIC_CONTRACT=1` path, then reviewed the diff: one
  insertion-only hunk (+128/−0) and only `hr/policies:saveDraft` gained
  `workRules`. The snapshot still contains `replaceOrgFields` (saveEmployee),
  `expectedRevision` (saveCompanyLogo) and all six
  `hr/employeeProfile:*` functions, plus the extended `status` filter.

## Independent protocol cross-check

Exact source tested: combined HEAD `fed39093` (protocol code identical to
`cfd6dcdf`). Read in source: `convex/hr/setup.ts` (saveEmployee merge),
`convex/hr/org.ts` (`getCompanyLogo` revision, `saveCompanyLogo` fence),
`convex/hr/shared.ts` `hrCommand` (replay), `src/features/hr/HrCompanyProfile.tsx`
(`CompanyLogoField`/`CompanyLogoEditor`).

Observations:

- **Legacy org fields.** Each of the six fields is
  `args.X ?? (replaceOrgFields ? undefined : before.X)`. The effective
  values are what get validated and persisted. Registered tests
  `protocol: legacy %s name edits preserve all six employment fields`
  (ACTIVE and INACTIVE) assert every field plus version 2, a single replay
  and that no org field appears in the audit. Modern clearing:
  `protocol: modern %s replacement clears only permitted fields…`. Required
  refusal: `protocol: modern ACTIVE replacement cannot clear required
assignments` returns DEPARTMENT_REQUIRED / POSITION_REQUIRED with the store
  snapshot unchanged.
- **Logo fence.** If a row exists, a write is refused unless the token's
  `id` and `version` match. If no row exists, only `null` or no token is
  accepted. A missing token on an existing logo is therefore refused (the
  legacy stale case). Delete/recreate makes a new `_id`, which fences ABA.
  Two creators that both saw `null` serialize: the second sees a row and is
  refused. Replay returns the stored receipt without running `run()`. The
  registered test `protocol: observed logo revisions fence two-tab
replacement, removal, creation races and delete/recreate ABA` covers
  A→B then stale replace/remove/create, the ABA case, and replays of
  create/replace/remove after later writes. It asserts full `storeSnapshot`
  equality after every refusal and replay, and REQUEST_ARGUMENT_CONFLICT on
  a reused id.
- **P3.** `remove` together with any `mimeType`/`base64` returns
  LOGO_FILE_INVALID before the store is read.
- **Mutation (red) checks, run by me and then reverted with `git checkout`:**

  | Temporary source mutation              | Result                                                                      |
  | -------------------------------------- | --------------------------------------------------------------------------- |
  | drop `expected.id !== before._id`      | ABA test fails (1 failed)                                                   |
  | accept missing token on existing logo  | `a legacy stale logo command cannot remove or overwrite a newer logo` fails |
  | drop P3 remove-shape check             | `invalid logos persist no domain change…` fails                             |
  | drop legacy `before.branchId` fallback | new combined test fails on `branchId`                                       |
  | `separationPreserved` always true      | new combined test fails expecting EMPLOYEE_SEPARATED                        |

  Command: `pnpm exec vitest run --maxWorkers=1 tests/integration/hr-parity/01-org-positions.test.ts -t "<title>"`.

- **UI (jsdom component tests with mocked Convex, not a real backend or
  browser).** The revision is captured into `expectedRevision` before
  `read.run(file.arrayBuffer…)`. The test defers `arrayBuffer`, refreshes
  the query to version 2, then asserts the call used version 1. After a
  stale refusal the file stays selected (`useDraftGuard`) and is re-sent
  only through "Apply selected file to current logo", with the current
  revision and a new request id. An uncertain retry resends identical args
  across remount. The editor is keyed by `useHrAccess().identityKey`, and
  the read scope includes the identity: a tenant switch during a read
  neither submits nor carries the selection over. The pending write
  (`usePendingGuard`) and the read (`navigation: "write"`) block
  header/native Back. Discarding the selection restores the
  locale/query/hash origin.
- **No new protocol defect found.** The protocol design leaves one point
  unprotected. A legacy client that sends no token while no logo exists can
  still create one, as documented. Because the row-absent check runs inside
  the same transaction, it cannot overwrite a concurrently created logo.

## Cross-lane validation (employee + rules + foundation)

New registered-reference test
`tests/integration/hr-parity/combined-integration.test.ts`. It calls through
`makeFunctionReference`, so the Convex argument validators run too. Steps:
hire with all six org fields (modern) → profile + payment → confirm
probation (v2) → old-client INACTIVE save with no org or slice-03 fields
(v3, all six fields and the confirmation date retained) → offboard (v4) →
default list empty, FORMER/ALL/INACTIVE list it. An old-client ACTIVE save
is refused EMPLOYEE_SEPARATED with the row unchanged. A modern replacement
without the last working day is refused, row unchanged. A legacy edit that
keeps the separation is accepted with fields retained (v5) → reinstate (v6),
fields retained and the default list includes the employee again. The
registry JSON contains no account number or phone, the private
profile/payment rows are unchanged, and the history `employeeVersion` values
are `[2,4,6]`. A modern replacement then clears the optional fields while
keeping department/position (v7).

The test passed on the first run, and both relevant mutations above turn it
red. I checked it against the employee review findings: it relies on none of
F1–F6 (monotonic dates, valid active assignments at reinstate, no
lifecycle-contradicting main save, no overnight shift, no React keys).
Re-run it after the hardening commits land.

Leave policy snapshots: no employee-lane code touches policies. Kiro's
`snapshots work rules on activation while leave requests keep working` and the
legacy-policy cases pass on the combined tree. I added no new leave case.

## Gates (combined tree, exact HEAD `fed39093` unless noted)

| Command                                                                                                                             | Exit | Result                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile --prefer-offline`                                                                                   | 0    | pnpm 10.33.2, Node 24.19.0                                                                          |
| `node scripts/ci/install-bun-checker.mjs`                                                                                           | 0    | Bun 1.4.3 / TS 7.0.2, zip sha256 `80afd4c0…a3403`, into `.cache/bun-checker/` (ignored, task-local) |
| `pnpm typecheck` (pinned Bun first on PATH)                                                                                         | 0    | `No type errors in 1,084 files` — **previously blocked gate now passes**                            |
| `pnpm typecheck:ts6`                                                                                                                | 0    | TS 6.0.3                                                                                            |
| `pnpm ci:codegen`                                                                                                                   | 0    | generated bindings match the pinned CLI (credential-free loopback backend)                          |
| `pnpm lint`                                                                                                                         | 0    | `--max-warnings=0` (run before `fed39093`; new file eslint + prettier clean)                        |
| `pnpm check:navigation`                                                                                                             | 0    | 58 route/error policies, 304 owners, 26 intents                                                     |
| `pnpm ci:test-discovery`                                                                                                            | 0    | 385 Vitest files, 17 Playwright specs (discovery, not execution)                                    |
| `vitest --maxWorkers=2` 19 changed HR files (pre-snapshot fix)                                                                      | 0    | 496/496                                                                                             |
| `vitest --maxWorkers=2` contract set (pre-fix)                                                                                      | 1    | 59/60: public-function snapshot (fixed above)                                                       |
| `vitest --maxWorkers=2 tests/integration/public-function-contract.integration.test.ts` (post-fix)                                   | 0    | 10/10                                                                                               |
| `vitest --maxWorkers=2 tests/integration/hr- tests/integration/hr-parity convex/model/hr src/features/hr` + 4 contract/schema files | 0    | **78 files, 1082/1082**, 47 s, no timeouts                                                          |
| `env -i PATH HOME TMPDIR CI=1 NEXT_TELEMETRY_DISABLED=1 CI_EXTERNAL_TYPECHECK=1 pnpm build` (CI credential-free env)                | 0    | Next production build on Bun 1.4.3; tree clean afterwards                                           |

Not run: the repository-wide full Vitest suite. Earlier lanes reported 5
non-HR full-suite failures and one broad-run timeout. Their cause was not
established, and I did not re-run or attribute them. No test timeouts were
changed and no gates were altered.

## Inherited, unresolved findings (not fixed here)

- Employee review `dd533481`, changes requested: F1 (P1) query-version React
  keys discard drafts and detach pending completion. F2 (P1) reinstatement
  makes the separation gap count as employed for attendance. F3 (P2)
  non-monotonic lifecycle dates and contradictions with the main save. F4
  (P2) reinstate bypasses the department/position invariant. F5 (P2)
  profile/payment/lifecycle recovery operations are unregistered. F6 (P2) a
  past-date offboard after midnight blocks the final overnight clock-out.
  The Codex hardening lane owns these.
- Forged cursor (C1): reproduced on the foundation as well, so it is not a
  new slice regression and not counted here.
- R3 historical receipt replay after site-grant removal: inherited
  `hrCommand` semantics.

## Remaining blockers

- Employee hardening commits must be integrated on top of this branch,
  followed by re-review and a re-run of this checkpoint's gates.
- No browser verification was done here. The real-app browser lane
  (`t3-2a0c98b6`, owning ports 3100/3320) reports separately. All UI
  evidence above is jsdom with mocked Convex.
- Logo upload against a real deployed dev backend has not been exercised.

## Process ownership and cleanup

Everything this lane started was foreground or awaited and has exited:
pnpm install, the Bun installer, two `pnpm typecheck` runs (one in the
background, awaited), `ci:codegen` (its private loopback backend stopped
itself), vitest runs (one in the background, awaited), and `pnpm build`.
Afterwards, `ps` showed no process with this checkout as cwd other than the
agent session itself. The listeners on 3100/3320 belong to the browser lane
checkout `t3-2a0c98b6` (verified by cwd) and were not touched. No servers
were started on those ports.

Branch note: I briefly created `t3/hr-combined-integration` in this checkout
by mistake. The commits were moved back onto the T3-bound `t3/7c68a2e0`
(`git branch -f`) and the temporary branch was deleted. No other checkout or
branch was modified.
