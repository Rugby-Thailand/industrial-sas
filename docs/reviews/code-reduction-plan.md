# Behavior-preserving code reduction

Date: 2026-08-22

## Goal

Keep every feature, route, workflow, and stored-data contract.

| Scope      | Baseline | Current | Target                 |
| ---------- | -------: | ------: | ---------------------- |
| Production |   52,551 |  50,568 | 39,413 (25% reduction) |
| Tests      |   43,745 |  43,392 | 21,872 (50% reduction) |

Production may continue to 36,785 SLOC (30%) only when the result is simpler
and all checks remain green. Generated output is measured separately.

## Roles

- **Orchestrator:** assigns work, enforces file ownership, reviews diffs,
  integrates results, measures progress, and runs full verification.
- **Worker:** executes one task file only. It must not expand scope or edit
  another worker's files.

## Execution

### Wave 1 — parallel

1. [Task 01 — inbound backend](./code-reduction-tasks/01-inbound-backend.md)
2. [Task 02 — extended backend](./code-reduction-tasks/02-extended-backend.md)
3. [Task 03 — frontend](./code-reduction-tasks/03-frontend.md)

### Wave 2

4. [Task 04 — domain and schema](./code-reduction-tasks/04-domain-schema.md)

Start after Wave 1 is integrated so schema work uses the settled interfaces.

### Wave 3

5. [Task 05 — tests and fixtures](./code-reduction-tasks/05-tests.md)

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
