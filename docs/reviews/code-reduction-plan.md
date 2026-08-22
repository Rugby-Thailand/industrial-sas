# Behavior-preserving code reduction

Date: 2026-08-22

## Goal

Keep every feature, route, workflow, and stored-data contract.

| Scope      | Baseline | Foundation |  Final | Target                 |
| ---------- | -------: | ---------: | -----: | ---------------------- |
| Production |   52,551 |     50,568 | 49,770 | 39,413 (25% reduction) |
| Tests      |   43,745 |     43,392 | 40,596 | 21,872 (50% reduction) |

Production may continue to 36,785 SLOC (30%) only when the result is simpler
and all checks remain green. Generated output is measured separately.

## Roles

- **Orchestrator:** assigns work, enforces file ownership, reviews diffs,
  integrates results, measures progress, and runs full verification.
- **Worker:** executes one task file only. It must not expand scope or edit
  another worker's files.

## Execution

### Wave 1 — parallel

1. [x] [Task 01 — inbound backend](./code-reduction-tasks/01-inbound-backend.md)
2. [x] [Task 02 — extended backend](./code-reduction-tasks/02-extended-backend.md)
3. [x] [Task 03 — frontend](./code-reduction-tasks/03-frontend.md)

### Wave 2

4. [x] [Task 04 — domain and schema](./code-reduction-tasks/04-domain-schema.md)

Start after Wave 1 is integrated so schema work uses the settled interfaces.

### Wave 3

5. [x] [Task 05 — tests and fixtures](./code-reduction-tasks/05-tests.md)

Start after production interfaces are stable. This worker owns all test edits.

## Orchestrator loop

For each wave:

1. Record `pnpm measure:code`.
2. Assign exclusive paths.
3. Review every worker diff before integration.
4. Reject behavior changes, shallow generic wrappers, and moved complexity.
5. Run targeted checks, then measure again.
6. Preserve an independently revertible checkpoint.

Final verification:

```sh
pnpm verify:workflows
pnpm verify:tenant-boundary
pnpm verify:native-select
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm measure:code
```

Run configured end-to-end checks and `pnpm guards` before completion.

## Stop conditions

Stop and report the measured ceiling if another reduction would remove behavior,
weaken security or accessibility evidence, hide authored logic in generated data,
or add more complexity than it deletes.

## Outcome

The preserve-all-behavior target was not safely reachable. Work stopped at the
reviewed ceiling rather than deleting product behavior or unique verification
evidence.

| Slice                    | Production |      Tests | Evidence                                              |
| ------------------------ | ---------: | ---------: | ----------------------------------------------------- |
| Completed foundation     |     -1,983 |       -353 | Generated references, dead code, and verified cleanup |
| Task 01 inbound backend  |       -103 |          0 | Shared bounded list envelopes                         |
| Task 02 extended backend |       -482 |          0 | Generated `Doc` types and existing envelope reuse     |
| Task 03 frontend         |       -157 |          0 | Route-message layout consolidation                    |
| Task 04 domain/schema    |        -56 |          0 | Tuple-preserving literal validator construction       |
| Task 05 tests            |          0 |     -2,796 | Replaced lower-layer overlap only                     |
| **Total from baseline**  | **-2,781** | **-3,149** | **5.29% production / 7.20% tests**                    |

Wave 3 initially reached 31,844 test SLOC, but independent review showed that
the deletion removed unique fail-closed, tenant-isolation, master-data, E2E
runner, UOM, identifier, date, ledger, and workflow evidence. Those suites were
restored. The accepted test reduction leaves only twelve deleted files whose
contracts remain covered by retained property, runtime, integration, and
isolation suites.

The remaining gaps are 10,357 production SLOC to the 25% production target and
18,724 test SLOC to the 50% test target. Closing either gap now would require a
new replacement-first design or a product-scope decision. Phase 5A and the
storage-layout planner remain intact.

## Verification result

Targeted checks passed at every wave. The final integrated tree passed:

- `pnpm guards`, including workflow, tenant-boundary, native-select, environment,
  operator-manual, formatting, lint, typecheck, dependency-audit, and all Vitest
  gates: 161 files and 2,455 tests.
- `pnpm build`: 58 static pages generated successfully.
- `pnpm test:e2e`: 74 Playwright tests across desktop and handheld projects.
- `pnpm measure:code`: 49,770 production, 40,596 tests, and 262 generated SLOC
  excluded from the target.

## Local checkpoints

- `aaf150f` — completed foundation (starting point for these waves)
- `2c1fd7a` — Wave 1 production consolidation
- `c21791b` — Wave 2 validator consolidation
- `4f0c486` — restore exact validator member-tuple precision
- `850319d` — initial Wave 3 reduction checkpoint
- `c706f31` — restore unique contract evidence found in review
- `1858e30` — retain remaining fail-closed contract suites

No checkpoint was pushed.

## Remaining opportunities

Future reductions must add replacement evidence before deleting existing suites.
The most credible candidates are table-driven feature matrices, shared UI render
and accessibility harnesses, and narrower contract suites around existing deep
modules. The research estimate for those test-only opportunities is 4,000–7,000
SLOC, still short of the remaining target and unproven until mutation or seeded-
fault evidence demonstrates parity. Further production compression is not
supported by the current evidence without de-scoping behavior.
