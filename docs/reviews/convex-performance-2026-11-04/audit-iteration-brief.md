# Iteration re-audit brief

You are re-auditing the Convex backend after one optimization iteration. You are one of two independent auditors from different model families; you never see the other's report.

Follow every rule, the scoring rubric and the output format in `audit-brief.md` (same folder), with these additions.

## Inputs (paths in the task message)

- **Code snapshot:** a read-only worktree checked out at the iteration commit. Audit this, not any other checkout.
- **What changed:** `git -C <snapshot> diff 80dc0a93..HEAD -- convex tests scripts/performance` (80dc0a93 is the untouched `main` baseline). Also read `git -C <snapshot> log --oneline 80dc0a93..HEAD`.
- **Measurements:** the iteration profile `evidence/iter<N>.md` (+ JSON). Its `base` exec column is `main@80dc0a93` measured in the same run on identical data; "(was N)" marks read-count changes versus the iteration-0 baseline. Fan-out and contention tables are listed per target, so you can compare candidate against base directly.
- **Your previous report:** `audits/iter<N-1>-<you>.md`. Start from it.

## Tasks

1. Verify each change: does it preserve behavior, ordering, authorization, tenant isolation and data integrity? Look for regressions, including new read paths, missing invalidation and changed reactive dependencies. Check whether the tests added in the diff actually guard the change.
2. Check that the measurements support the claimed improvement. Flag any number that the harness could not have measured correctly.
3. Re-score with the same rubric. Do not raise a score for intent or plans, only for measured or verifiable improvements. Do not lower it for problems that already existed unless you missed them before; say so if you did.
4. Update your findings: mark each previous finding as resolved, partially resolved or open, and add new ones. Keep the ranking by impact.

## Output

Use the `audit-brief.md` format, with one added section placed right after the score bullets:

```
## Changes since last audit
- Per change: verdict (correct / risky / regression), evidence, and the measured effect.
```
