# HR module and permission-aware Search delivery

## Identity and dependency boundary

Worktree: `/Users/macbook/Development/industrial-sas-hr-delivery-20261011`.
Branch: `codex/hr-module-delivery-20261011`. PR base: `main`.
Source checkpoint: `075b10e865ae649d7e8d2be99db0dafa6e1899c8`.
Integrated main: `9ac5da0e5ffc681e19a7dc5ad83da5d26bb61320`.
Reference final source: `4ddbf080c6967f114fb21b5181674f14dcd5371a`.
Specification: `docs/specs/hr-phase-1-requirements.md` and source Search plans.

Deliver employee directory, schedules, attendance, correction/review queue,
attendance period close/revise/export, holidays and HR access, plus the shared
permission-aware navigation Search used by these workflows. Periods represent
attendance/payroll preparation: do not invent payroll payment or accounting
features outside the specification. AI Search resolves navigation only; it
must not execute business mutations from user text.

Own HR routes/components/backend/models, Search resolver/provider/shell,
draft/deep-link guards, tenant-safe member directory, associated permissions,
schema, translations, local demo fixtures, and tests. Exclude AI usage tables,
recorder hooks, monthly statement screens, FX settings, recovery, and exports.
Search transport must work without importing AI usage code. Preserve the
production changes already present on main.

## Four-agent roster and handoffs

| Role                  | Runtime                             | Deliverable                                                   |
| --------------------- | ----------------------------------- | ------------------------------------------------------------- |
| Implement             | Kiro `claude-opus-5.5`, high effort | Scoped port/split changes and implementation report           |
| Audit code            | Codex, read-only                    | Standards, security, lifecycle and compatibility findings     |
| Audit spec and fix    | Codex                               | Spec review, reproduced defects, scoped fixes and regressions |
| Test and computer use | Codex coordinator                   | Independent automated checks and live user-flow evidence      |

Kiro first ports the HR fixes from commit `213a45d` path-wise. Do not cherry-pick
the whole commit: its Search transport and tests depend on AI usage. Extract a
usage-free Search HTTP transport adapter out of the pure model and cover its
timeout and error paths. Keep AI-only landing/Search provider integration in
the upper task. Return control before either audit or Codex fix edits source.

Code and spec review run in parallel against a frozen candidate. Audit the
complete HR diff, not only the small split patch. Fix agent reproduces each
confirmed finding. Tester verifies affected layers after each fix. Repeat
until no unresolved blocker remains, then validate the final complete tree.

## Acceptance scenarios

1. Authorized HR user creates and edits a synthetic employee, links an account
   from the same organization, sets supervisor/warehouse/schedule, and sees
   persisted details after reload. Reject foreign-organization links and
   conflicting mappings. Ordinary employee cannot edit the directory.
2. Employee clocks in/out on an eligible local day. Duplicate clicks, missing
   in/out, active/inactive schedules, split shifts, cross-midnight boundaries,
   holidays, missing employee mapping, and day/date conversions behave as
   specified. Future schedules must not erase historical attendance.
3. Employee requests a correction, edits/cancels it where allowed, and sees
   pending status. Supervisor/HR reviews within their scope, accepts/rejects
   with required context, and the employee sees the resulting persisted state.
   A reviewer cannot decide their own record or access another tenant.
4. HR creates a period, reviews unresolved days, closes only when eligible,
   exports correct totals, revises when authorized, and preserves closed-period
   snapshots. CSV is scoped and resists formula injection. Do not claim a
   payroll payment workflow.
5. HR configures a holiday and access grants. Dirty forms prompt before leaving
   via sidebar, browser navigation, or Search. Cancel preserves the draft;
   confirm navigates once. Stale writes and permission changes are handled.
6. Search opens authorized static pages, employee records, day corrections,
   review rows, period exports, and settings sections. Test Thai, English,
   ambiguous names, missing dates, malicious prompts, provider timeout/unreadable
   answers, stale organization changes, and requests for unauthorized targets.
   Result selection must revalidate permission and focus the intended form.
7. Desktop/mobile, keyboard navigation, locale switching, loading/empty/error
   states, refresh, and repeat submissions work without console/request errors.

## Verification and evidence

Use isolated local Convex and Clerk test identities. Start separate Next dev
and build directories, and record frontend/backend URLs without credentials.
T3 browser walkthroughs must perform actual UI interactions, then confirm
persisted results by refresh or an authorized read. Test at least the core
employee -> clock -> correction -> review -> period export loop. Record which
roles are exercised live versus automated. Synthetic data is disposable and
must not be production business data.

Run formatting/typecheck/lint, all Vitest projects, production build, Convex
codegen freshness, relevant browser smoke/workspace tests and required CI.
Add focused tests only for meaningful defects or newly isolated boundaries.
Record exact final source SHA for every independent audit/check and screenshot
set. Do not reuse historical reports as evidence for this branch.

Evidence directory: `output/delivery-20261011/` (ignored). Required files:
`implementation.md`, `standards-audit.md`, `spec-audit.md`, `findings.md`,
`fixes.md`, `verification.md`, and logs/screenshots referenced from the report.

## PR gate and handoff

Create the HR/Search PR against main only after acceptance and checks pass.
Its description must explain the Search dependency and exclude AI accounting.
Link it in T3 immediately. This task does not merge or deploy. Commit the final
HR head before the upper AI task merges it, and verify the upper PR diff does
not reintroduce HR as independent changes. Existing combined PR #62 remains
untouched and must not be merged as an additional copy of this work.

Status: worktree created; implementation/audit/fix/test pending.

## Delivery evidence — 11 October 2026

Four roles completed: Kiro Opus 5.5 integration, independent Codex code audit,
Codex specification audit/fixes, and Codex automated/live browser verification.
Runtime candidate: `e761b4181257a821ef1e197a7ff8bbd4d3814f4d`.

- Full format/typecheck/lint and 234 Vitest files / 2,749 tests pass.
- Production build and fresh pinned Convex codegen pass.
- Workflow pins/actionlint, runtime/app/release dependency gates and test
  discovery pass. Anonymous desktop/mobile smoke: 92 tests pass.
- Authenticated local computer-use: clock-in/out and refresh, invalid correction
  refusal/draft guard/submission, supervisor overnight certification/history,
  close version2 and actual 21-row CSV with 4,672 worked minutes, Thai period at 390px,
  and mobile employee create/edit/refresh all observed.
- Live test identity is an organization admin in an isolated synthetic local
  organization. Backend/model/UI tests cover restricted/foreign-tenant roles;
  those are not claimed as a live multi-user walkthrough.
- Fixed stale certification queue, non-finite correction/evaluation values,
  test fixture narrowing, and HR observability static-route integration.
- Raw calendar helper interface remains a nonblocking model-contract advisory;
  broader 69-caller Result migration is outside the confirmed defect repair.

Detailed role reports/logs/screenshots are in ignored
`output/delivery-20261011/`. Workspace browser suite: 42 passed / 2 expected skips, zero retries.
GitHub checks are monitored after PR creation. PR targets main; this plan does not claim merge or deployment.
