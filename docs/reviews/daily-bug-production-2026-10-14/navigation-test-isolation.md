# Production navigation final audit

Workspace: `/tmp/industrial-daily-prod-20261013`, based on `59fb1d13` (origin/main at audit start).

## Finding

The six reported HR navigation failures were introduced by the durable HR command store interacting with reused test actors. They were test-session isolation failures, not failures of employee Cancel ownership or leave-history traversal. No production navigation code was changed by this audit.

`EmployeesNavigation.test.tsx` intentionally leaves an employee save promise unresolved in `an in-flight employee write disables Cancel and keeps Back guarded`. The new `useHrWrite` owner survives unmount and correctly remains PENDING. Subsequent cases used the same identity and employee scope, so the new editor correctly inherited that pending command, disabled its fieldset/Cancel, and retained `?employee=e7&mode=edit`. Clearing sessionStorage does not cancel a live pending command.

`PolicyLeave.test.tsx` similarly reused `org:user` and a leave-submit scope after preceding uncertain-command cases. The durable owner remained locked, so the fresh fixture's leave draft was not dirty/guarded. Both close-history cases therefore missed the expected next-Back discard prompt.

## Differential reproduction

Command, used without changing its assertions:

```sh
pnpm exec vitest run --project unit src/features/hr/EmployeesNavigation.test.tsx src/features/hr/PolicyLeave.test.tsx --maxWorkers=2
```

| State                                                             | Result                    | Evidence                                  |
| ----------------------------------------------------------------- | ------------------------- | ----------------------------------------- |
| Shared production workspace before isolation fix                  | 6 failed / 26 passed      | `/tmp/prod-navigation-narrow-before.log`  |
| Clean detached `59fb1d13` baseline                                | 32 passed                 | `/tmp/prod-navigation-baseline.log`       |
| Baseline plus current `useOperationLifecycle.ts` only             | 32 passed                 | `/tmp/prod-navigation-base-lifecycle.log` |
| Baseline plus current lifecycle and `useHrWrite.ts`               | Same 6 failed / 26 passed | `/tmp/prod-navigation-base-write.log`     |
| Current workspace, only the reported Cancel/history case patterns | 4 passed / 28 skipped     | `/tmp/prod-navigation-isolated-cases.log` |
| Current workspace after per-case actor isolation                  | 32 passed                 | `/tmp/prod-navigation-narrow-after.log`   |

The detached comparison checkout was `/tmp/industrial-navigation-base-20261014`; shared production files were not reverted or replaced during probes. The baseline comparison vindicates the root-owned scope-visit lifecycle correction for these callers.

## Change

- `src/features/hr/EmployeesNavigation.test.tsx`: move mock identity into fixture state and allocate one actor per `beforeEach`.
- `src/features/hr/PolicyLeave.test.tsx`: allocate one actor per `beforeEach`.

Identity remains unchanged within each case, so remounts still exercise durable ownership. Test names, assertions, navigation steps, query/hash/locale checks, unresolved writes, and recovery behavior were not weakened. No production-state reset, test-only production export, navigation inventory edit, or history cleanup shortcut was added.

## Verification

- Full two-file unit run: 32/32 passed, 2.85 seconds.
- `pnpm exec eslint src/features/hr/EmployeesNavigation.test.tsx src/features/hr/PolicyLeave.test.tsx --max-warnings=0`: passed (`/tmp/prod-navigation-audit-eslint.log`).
- `pnpm exec prettier --check` for the two changed test files: passed.
- `pnpm check:navigation`: passed (`/tmp/prod-navigation-audit-gate.log`).

Read repository AGENTS.md, the Back navigation contract and exact Employees/leave inventory entries, and installed Next server/client components and useRouter guides. Coordinated ownership with the root and HR client agent. No staging, commits, pushes, or deployments.
