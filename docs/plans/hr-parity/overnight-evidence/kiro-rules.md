# kiro-rules — Slice02 inactive configuration foundation

Status: complete; feature committed, independent checks pass, owned processes exited. Evidence commit follows the recorded feature checkpoint.

## Checkout and scope

- Checkout: `/Users/macbook/.t3/worktrees/industrial-sas/t3-a8227af8`.
- Branch: `t3/kiro-rules-calendar`; base `a2e964e2045269231fc0df429d52cc51f53e2658`.
- Start: 2026-11-01 22:04 Asia/Bangkok (15:04Z). All work remains before the 2026-11-02 06:30 freeze / 07:00 stop.
- Original research and Slice02 test skeletons were read from `/Users/macbook/Development/industrial-sas`; no writes were made there. The HRZoft demo was not accessed.
- Kiro implemented the feature code. Managing Codex inspected it, fixed one small validation finding, added focused regression tests, regenerated Convex declarations with the repository checker, and independently ran the checks below.
- No agents beyond the one authorized Kiro worker. No push, production deployment, production data writes, UI/routes/navigation changes, test exemptions or research-todo activation.

## Result

Optional `PolicyConfig.workRules` persists through the existing LEAVE `current`, `saveDraft` and `activate` handlers, immutable versions and leave snapshots. Existing tenant authorization, org-wide scope, audit, expected-version and request replay paths remain in use. Legacy records/defaults omit the optional field. Non-LEAVE capabilities refuse work rules.

The schema stores attendance thresholds/grace, pre/post-shift OT timing, minimum/optional maximum, observed DOWN rounding and eligibility preferences. All are inactive. Reads explicitly report inactive/unsupported execution; automatic OT `true` is refused. No attendance classification, grace arithmetic, OT entitlement/eligibility calculation or payroll behavior is enabled.

Validation ranges are engineering storage guards, not observed HRZoft limits or statutory defaults. No default demo values are inserted. Excluded group keys remain opaque labels, without employee-group enforcement. Details and exact open decisions: `docs/plans/hr-parity/02-rules-calendar-roles/work-rules-foundation.md`.

Independent review found a truthiness bug in unknown-key validation: an empty string key could evade the domain check. Codex changed each comparison to `!== undefined` and added all five nesting regressions. Codex also added registered-function competing-save and revoked-membership replay/read tests. These exercise production handlers and public argument validation through convex-test, not a mirrored implementation.

## Kiro provenance

- Skill read: `/Users/macbook/.codex/skills/kiro-cli-runner/SKILL.md`; the user-provided executable correction superseded its stale app path.
- Discovery: `/Users/macbook/.local/bin/kiro-cli chat --list-models --format json-pretty`, exit 0; `claude-opus-5.5` explicitly available.
- Exact launch argv: `['/Users/macbook/.local/bin/kiro-cli', 'chat', '--model', 'claude-opus-5.5', '--effort', 'high', '--trust-all-tools', '--no-interactive', Path('/tmp/hr-kiro-rules-20261101/prompt.txt').read_text()]`.
- Full nonsensitive scoped prompt: `/tmp/hr-kiro-rules-20261101/prompt.txt`. Bounded wrapper: `/tmp/hr-kiro-rules-20261101/run.py`. Local log: `/tmp/hr-kiro-rules-20261101/worker.log`. Process metadata: `/tmp/hr-kiro-rules-20261101/process.json`.
- Worker model: Claude Opus 5.5, effort high, no substitution. Wrapper PID 44297; worker PID/PGID 44343; ACP server PID/PGID 44424; exec session 42310. MCP descendants observed: 52653 and 53914. Started `2026-11-01T15:05:27.576420Z`; exited 0 at `2026-11-01T15:16:57.247503Z` (11m30s). Timeout: 3000 seconds, with TERM/KILL on expiry. All listed worker processes had exited when independently checked after completion.
- Kiro self-reported 230 focused passes, lint and both tsc checks. Those claims are supplemental; the independent commands/counts below are authoritative. Kiro's unit-count prose was not used as evidence. Kiro also reported removing/restoring two guards to test sensitivity; supervisor did not repeat that mutation exercise and does not credit it as independent evidence.

## Independent commands and process records

Every supervisor test/check command below ran through `/tmp/hr-kiro-rules-20261101/check.py`: a foreground exec session with PID/PGID, local log, JSON metadata and 600-second timeout. No detached jobs. Logs/metadata use the label as filename under that directory.

Dependency setup: `pnpm install --frozen-lockfile --ignore-scripts`, exec session 54204, exit 0; 900 dependencies installed in this checkout in 21.1 seconds. No package/lockfile edits. Small Prettier runs used exec sessions 61310 and 88944 and exited 0; no persistent process.

| Label              | Exact command                                                                                                       | Wrapper / child PID | Exit |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------- | ---- |
| all-hr-bounded     | `pnpm exec vitest run --maxWorkers 2 convex/model/hr tests/integration/hr src/features/hr`                          | 60040 / 60041       | 0    |
| all-hr             | `pnpm exec vitest run convex/model/hr tests/integration/hr src/features/hr`                                         | 57553 / 57554       | 1    |
| baseline-hr        | `pnpm exec vitest run convex/model/hr tests/integration/hr-policy-leave.integration.test.ts`                        | 60171 / 60172       | 0    |
| baseline-lint      | `pnpm lint`                                                                                                         | 78329 / 78339       | 0    |
| codegen-final      | `pnpm ci:codegen`                                                                                                   | 56744 / 56758       | 0    |
| codegen-first      | `pnpm ci:codegen`                                                                                                   | 56026 / 56027       | 1    |
| final-convex-types | `pnpm exec tsc --noEmit -p convex`                                                                                  | 58564 / 58568       | 0    |
| final-lint         | `pnpm lint`                                                                                                         | 57206 / 57209       | 0    |
| final-types        | `pnpm typecheck:ts6`                                                                                                | 57207 / 57208       | 0    |
| focused-corrected  | `pnpm exec vitest run convex/model/hr/workRules.test.ts tests/integration/hr-work-rules-policy.integration.test.ts` | 56711 / 56735       | 1    |
| focused-final      | `pnpm exec vitest run convex/model/hr/workRules.test.ts tests/integration/hr-work-rules-policy.integration.test.ts` | 56008 / 56010       | 1    |

### Observed results (not summed across reruns)

- Baseline HR domain + leave-policy: **100/100**, 7 files, exit 0.
- Baseline normal ESLint: exit 0.
- First supervisor focused run: **48 passed / 1 failed**, 2 files, exit 1. The new supervisor revocation fixture used unsupported membership status `INACTIVE`; corrected to actual schema value `REVOKED`.
- Second focused run: **48 passed / 1 failed**, exit 1. The same new test then correctly reached the production `MEMBERSHIP_INACTIVE` ConvexError; its assertion was corrected to expect the public exception rather than an outcome object. No production auth code was changed.
- Initial broad HR run: **679 passed / 2 failed**, 65 files, exit 1. The two failures were unchanged 5000-ms timeouts in `HrClientRecovery.test.tsx` — `a fresh clock-in after remount on the next day must record the new day`, and `HrPagination.test.tsx` — `moves through pages, resets on criteria and page size, and shows the page`. This overlapped lint/typecheck on a shared machine. Retried the same complete HR selection with `--maxWorkers 2`; no test timeout/config/expectation changes.
- `pnpm lint`: exit 0, normal repository command, no warning allowance or rule changes.
- `pnpm typecheck:ts6`: exit 0 (`next typegen && tsc --noEmit`).
- `pnpm exec tsc --noEmit -p convex`: exit 0.
- First `pnpm ci:codegen`: exit 1 because the new `model/hr/workRules` module needed two generated API declaration lines. The checker regenerated the file; supervisor reviewed the exact two-line diff.
- Second `pnpm ci:codegen`: exit 0, generated declarations match pinned Convex CLI output. This uses the repository's credential-free, verified loopback-only disposable backend with a fresh local key and private temporary HOME. No production backend was contacted. The checker calls `stopOwnedBackend` and removes its temporary state; exact backend child PIDs are not emitted, but their owning foreground wrapper/CLI PIDs and completion are recorded above. No backend/dev server was left running by these checks.

Final bounded HR rerun: **681/681 passed**, **65/65 files**, **0 skipped/todo**, exit 0, 49.06 seconds (2026-11-01 22:20:53–22:21:42 Asia/Bangkok). It includes **29 domain tests + 20 work-rule integration tests** (49 new cases). Both previously timed-out UI tests passed under the unchanged 5000-ms limit. No production or test behavior was changed to address the load-related timeouts.

## Limitations and open decisions

- These are executable unit, component and in-process Convex integration tests. No authenticated deployed-backend test, Playwright/browser test, or production-readiness claim is made by this lane. The codegen check uploads only to its positively identified disposable loopback backend; it is compilation/codegen evidence, not an authenticated product workflow test.
- No UI was added; exposing controls and real browser navigation/persistence testing remain subsequent work. No navigation caller changed, so the navigation inventory/check was not changed or bypassed.
- Threshold equality/inclusivity, rounding seconds, grace arithmetic, OT order/minimum/cap/rounding and lawful entitlement, eligibility precedence, resolved group identity, probation/tenure sources, automatic-mode conditions and payroll categories remain open. All corresponding behavior stays inactive/unsupported. Calendar metadata, roles, repeat-scan/mobile attestation and employment/profile fields are outside this bounded subset.
- `pnpm typecheck` (the Bun checker variant), the entire repository test suite and browser suites were not run. The maintained TS6 variant and Convex TypeScript check passed. Test skeleton todos/fixmes are not counted.

## Commit and cleanup

- Feature checkpoint: `b747d38b8d07599a6de9919bb16b2161d2574fa0` — `feat(hr): persist inactive work rule policy settings` (7 files, 1213 insertions / 2 deletions). Local branch only.
- Evidence is committed separately immediately after this checkpoint so it can name the exact feature SHA.
- Cleanup audit at `2026-11-01T15:23:16.378733+00:00`: all recorded Kiro/ACP/MCP, test/check wrappers and PID/PGID groups absent; **0 owned processes remaining**. No TERM/KILL was needed because they exited normally. `.env.local` and `.convex` absent after disposable codegen runs. Details: `/tmp/hr-kiro-rules-20261101/cleanup.json`.
- No dev/browser server was started. The only servers were repository-owned disposable loopback codegen children; their check process finished and its `finally` cleanup completed. No outside process was stopped.
- Last changes after the green executable checks were documentation/evidence only. Final formatting commands are recorded below.

## Final formatting and checkpoint commands

- `pnpm exec prettier --check convex/_generated/api.d.ts convex/hr/policies.ts convex/model/hr/policy.ts convex/model/hr/workRules.ts convex/model/hr/workRules.test.ts tests/integration/hr-work-rules-policy.integration.test.ts docs/plans/hr-parity/02-rules-calendar-roles/work-rules-foundation.md docs/plans/hr-parity/overnight-evidence/kiro-rules.md`, wrapper/child 62209/62210, exit 1.
- `git commit -m 'feat(hr): persist inactive work rule policy settings'`, wrapper/child 62429/62431, exit 0.

The first final-format check found only this new evidence Markdown file unformatted; all code and the implementation note passed. Formatting was applied to the evidence before the final check and evidence commit. Final green formatting check: `pnpm exec prettier --check convex/_generated/api.d.ts convex/hr/policies.ts convex/model/hr/policy.ts convex/model/hr/workRules.ts convex/model/hr/workRules.test.ts tests/integration/hr-work-rules-policy.integration.test.ts docs/plans/hr-parity/02-rules-calendar-roles/work-rules-foundation.md docs/plans/hr-parity/overnight-evidence/kiro-rules.md`, wrapper/child 63633/63634, exit **0** at `2026-11-01T15:23:35.285768+00:00`; all 8 matched files passed. No executable source changes followed the green test/lint/typecheck/codegen runs.
