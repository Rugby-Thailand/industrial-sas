# HR UI simplification — Claude implementation, Codex final audit

Date: 2026-10-10. Status: proposed plan; application code has not changed in this planning pass. No PR yet.

## Outcome

Make everyday attendance and HR review easier to understand and complete. Put the current task and its decision evidence first; show detailed history, configuration and technical explanations when requested. Use the existing neutral surfaces, blue primary actions and Thai/English terminology.

Primary audiences are employees recording/correcting time, supervisors reviewing their team, and HR closing/exporting attendance periods. Start with Review, Periods and Today. This is a scoped simplification of the existing operating UI, rather than a new product or visual identity.

**User-confirmed priority:** excessive steps and rule text cluttering the screen. Prioritize removing redundant interactions and always-visible explanations before cosmetic layout work. Review is first, followed by Periods and Today. Show a rule where it explains a current blocker or decision; otherwise make its explanation available on demand. Keep the underlying correctness checks intact. This preference refines the proposed plan; implementation has not started.

## Evidence and current limits

- Current source was inspected at `cc42063` after the completed rebase. Existing HR/Search work and unrelated changes are uncommitted; preserve them.
- Claude CLI 2.1.295 is authenticated. An actual read-only planning invocation completed successfully using Claude Opus 5.5, with only Read/Glob/Grep enabled and no permission denials. Its [planning review](../../output/hr-simplification-plan-20261010/claude-planning-review.md) is source-based and explicitly lists the files it did not inspect. Codex also inspected the requirements, Thai copy, current source and saved screenshots before synthesizing this plan.
- Current collaborative preview disconnected during screenshot attempts. The saved HR and Search screenshots were viewed, but they precede the rebase and are historical layout evidence. Fresh authenticated screenshots are required before implementing layout decisions.
- The preceding rebase verification passed typecheck, lint and 1,478 tests. Those are historical baseline results, not new verification of this proposed change. No application tests or final audit were run in this planning pass.
- [HR Phase 1 requirements](../specs/hr-phase-1-requirements.md) and the [Search plan](global-search-ai-navigation-plan.md) remain the functional baseline. This plan replaces their historical Kiro handoff for the next UI pass: Claude implements, Codex independently audits.

## What is making the UI difficult

| Finding                                                                          | Source evidence                                                                                                                                               | Proposed change                                                                                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review repeats original time and places the decision after a general day summary | `ReviewDetail.tsx` renders `DayDetailView` before its decision children; the summary contains Original/Effective, and the decision contains Original/Proposed | Give the review flow one Original → Requested comparison, the employee's reason and the decision actions; move additional day/history information below |
| Desktop queue context disappears on smaller desktop panels                       | `ReviewScreen.tsx` enables the split layout only at `xl`; selecting a record below that hides the queue and toolbar                                           | Verify a useful split at 1061px; keep compact single-record navigation on phones. Choose the breakpoint from actual usable pane widths                  |
| Periods repeats state and shows many competing explanations                      | `PeriodDetailScreen.tsx` stacks status, lifecycle, versions, totals, action headings, disabled draft export, pilot and CSV notes                              | One status for the displayed version, a compact summary, the blocker or next step, and one primary action                                               |
| Settings exposes developer-facing policy detail                                  | `SettingsScreen.tsx` displays raw CSV columns, server clock details and unavailable reverification                                                            | Keep operational setup prominent; put export format and pilot limitations behind labelled details                                                       |
| AI search stacks instructions around the results                                 | `SearchDialog.tsx` renders intro, context, examples, AI status, privacy, result status and result groups                                                      | Keep the input, AI button, context and current outcome prominent; shorten instructions and show examples only for an empty query                        |

The source establishes ordering and duplication. Exact fold positions, visual density and the best desktop breakpoint still need fresh browser confirmation.

## Keep, reveal, and reduce

| Surface              | Show by default                                                                           | Reveal when needed / reduce                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Today                | Date, current attendance state, recorded in/out, next clock action, saved/error feedback  | Put the action ahead of secondary metadata; consolidate method explanations. An open previous day must show its correction action clearly                                                              |
| Review               | Queue, employee/date, issue, original vs requested times, reason, Certify and Return      | History and calculated breakdown in “รายละเอียดและประวัติ”; optional comment on demand; Return reveals the required reason. Remove duplicate original-time panels and repeated history-retention notes |
| Periods              | Range/site, displayed version and its status, worked total, unresolved count, next action | Previous versions, breakdown and revision under labelled controls. Remove the redundant lifecycle stepper and permanently disabled draft Export; keep a short explanation that export follows close    |
| Employees / Settings | Existing configuration and useful account/schedule status                                 | Trim repeated hints; group settings into labelled sections with on-demand policy/export detail. Keep the employee editor structure for this pass                                                       |
| Search / AI          | One search dialog, separate AI action, readable result trail, active context and outcome  | Short instruction text; concise clarification choices; details for provider disclosure. Keep a truthful one-line disclosure visible before asking AI                                                   |

For a blocked period, “ตรวจรายการที่ค้าง” should take HR directly to the relevant review, with a real employee/date target when known. For a ready draft, “ปิดงวด” is primary; for a closed version, “ดาวน์โหลด CSV ฉบับ N” is primary. The version number stays visible even when the version picker is collapsed.

Do not hide decision evidence, errors, unresolved blockers or partial-search notices in a disclosure. Show a single note beside any outside-shift metric that it is not approved OT; lengthy implementation limitations can live in the on-demand policy detail. AI disclosure must say that typed text may include names and is sent to the provider; it must not claim employee information can never be sent.

## Delivery sequence

1. **Baseline and prepare.** Capture fresh authenticated Review, Periods and Today at 1280×800, the actual desktop panel around 1061px, and 390×844. Record the existing app/source snapshot so the new diff can be audited separately from earlier uncommitted work. Read `AGENTS.md`, the relevant installed Next.js guides and the existing design-system guidance. Do not reset, stash, discard or commit unrelated work.
2. **Claude: Review first.** Adjust `ReviewScreen`, `ReviewDetail` and `DayDetailView` with a small presentation interface for their distinct tasks. Remove the duplicated comparison, put decision evidence/actions first, and disclose read-only history. Show optional comments only when requested and the return reason when Return is chosen. Preserve draft state across toggles; retain useful visible stale/locked/unlinked feedback. Validate this flow before moving on.
3. **Claude: Periods and Today.** Simplify period hierarchy, status and version controls. Preserve one clear close confirmation naming the version, and the revision reason flow. Make the current clock action easy to find, with receipt and recovery beside it. Do not introduce extra confirmations for routine clocking or certification.
4. **Claude: supporting cleanup and refactor.** Shorten matching Thai/English HR and Search copy, group settings, and simplify Search/AI presentation. Reuse existing controls. Refactor only duplication exposed by the preceding changes; avoid new global state, routing systems or dependencies. Keep normal Search and the AI button, including navigation to subpages and exact forms.
5. **Codex: independent final audit.** Review the new diff against the per-pass snapshot, inspect fresh screenshots and reproduce the primary workflows. Send concrete defects back to Claude for a batch fix, then verify those fixes. Deliver an audit with outcomes, screenshots and any real unresolved limits. Stop when the acceptance checks pass; no PR, push or deployment in this scope.

Use one batched desktop/mobile inspection after the complete implementation, one batch of visual corrections, and one confirmation pass. Repeat further only for an actual failed workflow, regression or unmet acceptance check. A new screenshot without a demonstrated improvement is not a reason for another polishing loop.

## Acceptance and final audit

These are proposed acceptance targets, not measured results.

| Flow                        | Required result                                                                                                                                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Employee attendance         | Next clock action and current state are visible on the initial 390×844 view for an ordinary linked employee. Saving shows actual persisted time; a lost response offers the same-command retry without creating duplicate punches                         |
| Correction review           | The employee/date, original/requested times and reason precede the actions. Original times appear once in the decision flow. At 390×844, the complete comparison and actions are reachable within one viewport of scrolling; neither is hidden in history |
| Return / stale decision     | Return reveals a labelled reason field, validates it and retains a typed draft on failure. Stale certification remains disabled with a visible recovery instruction                                                                                       |
| Period close/export         | Blocked drafts show why and how to resolve it. Ready drafts expose Close and one clear confirmation. Closed versions expose the selected version's export; historical versions remain selectable and unchanged after a revision                           |
| Search and AI navigation    | Normal Search reaches menus, subpages and authorized records/forms. A clear existing intent follows the current direct-navigation rules; an ambiguous person/date asks only for the missing choice. AI never saves or certifies data                      |
| Deep links into disclosures | Employee schedule, review decision, period version/export and settings sections work on direct load, reload and Back/Forward. The relevant section opens before scroll/focus. The displayed employee/date/version matches the URL                         |
| Forms and navigation        | Search, AI, record changes, same-page version switches and Back/Forward preserve the existing dirty/pending protections. Collapsing read-only details must not unmount stateful forms or their guards                                                     |
| Permissions and edge states | Self-only, supervisor/site, HR and cross-organization restrictions hold. Empty, denied, loading, failed, incomplete, locked and unlinked states remain distinguishable and actionable                                                                     |
| Layout/accessibility        | No page-wide horizontal overflow at 390px. Thai/English and light/dark remain readable; primary touch controls are at least 48px; keyboard focus, dialog Escape/focus return and reduced motion work                                                      |

Use isolated local fixtures for write verification; do not alter the existing demonstration clock/history/closed-period records. Role and rejection cases belong in focused integration tests, rather than weakening permissions to make a browser demonstration work.

Run focused component/integration regressions for changed behavior, formatting for changed files, then `pnpm check` and `pnpm build`. Add tests for a new consequence such as lost guard state or a collapsed deep-link target, not for copy wording or CSS classes. If an unrelated existing failure appears, record and isolate it; do not expand this change to repair another module.

The audit must preserve existing server authorization, self-review prohibition, timezone/overnight calculations, immutable period versions, stale-revision checks, bounded-result truth, idempotency and AI grounding. Removing explanatory text is allowed; removing those protections is outside this UI simplification. No backend rewrite is planned; any necessary backend bug fix requires a concrete reproduced defect and an explicit scope note before implementation.

## Deferred

Leave balances, approved OT, payroll computation, bulk certification, GPS/offline/kiosk attendance, extra dashboards/charts and storage-record AI expansion remain deferred. New navigation architecture and a full employee-form redesign are also deferred until the three core flows are demonstrably easier to use.

Final deliverables for the implementation phase are the scoped diff, fresh before/after screenshots, a Claude implementation report, and a Codex final audit. The existing Thai walkthrough can be updated after the UI is stable; this planning pass does not regenerate the video.
