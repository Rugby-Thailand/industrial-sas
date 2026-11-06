# Retained workflow Forward repair

Stage 2 reproduced this on source `214ec14a` in phone and desktop browsers: close the ticket camera, go Back to the location question, then Forward cannot restore tickets. The shared guard rearmed with a same-URL `pushState`, deleting the Forward list while the caller correctly retained its draft.

Commit `0e403340` distinguishes a duplicate consent buffer from an anchor on an existing workflow entry. Retained Back anchors the landed entry with `replaceState`. Removing an anchor clears metadata in place; duplicate removal still consumes its extra entry. Forward admission requires a mounted workflow, matching origin scope and depth, the same pathname, and no pending or unrelated guarded work. Native departure still restores the guarded page before consent. Caller dirty registration is unchanged.

## Verification

- Red reproduction: `VITEST_MAX_WORKERS=1 pnpm exec vitest run src/components/navigation/NavigationGuardProvider.workflow.test.tsx`; Forward remained on Location question, 1 failed in 5.50 seconds.
- Five provider and real JobScan caller files: 102 tests passed, including repeated native/header Back, Forward, exact query/hash, dirty/clean remount, explicit new entry, stale duplicate and pending-write protection.
- Six additional navigation caller files: initial 144/145 passed. The existing clean Floor Forward case waited a fixed 30 ms before issuing the next traversal; it passed alone. It now waits for the actual Back URL before Forward, then for the Forward URL, without changing timeouts or assertions. The entire Floor file passed 53/53 after that synchronization change; the other five files passed 92/92. Together the two focused groups cover 247 distinct tests.
- Navigation contract: 68 fixtures; 61 route/error policies; 312 state/overlay owners; 26 action intents, passed.
- Normal ESLint passed. Pinned Bun typecheck passed 1,202 files after correcting the explicit undefined type on the anchor scope. Full format check and changed-file format check passed.
- Real Next 16.4.1 navigation fixture production build passed. Chromium desktop/mobile, Firefox and WebKit passed all 8 runtime cases in 1.3 minutes, with zero retries. This verifies the real Next/provider/workflow integration; the authenticated Stage 2 caller browser trace must be rerun on its integrated next-loop source. This is not a merge or stage-pass claim.

## Standards review

Independent Codex review found no substantiated standards violations or actionable baseline code smells. It checked AGENTS.md, the Back contract, the machine inventory and caller evidence. Read-only review; it did not claim browser verification.

## Spec review

Independent Codex review found no actionable requirements defects or material scope creep. It checked retained Forward admission, pending/unrelated work, anchor removal, explicit entry ownership and real caller coverage. Read-only review; it did not claim browser verification.

Both reviews completed against the Forward patch, before the separate no-save dialog-title change. The later Floor test synchronization is described above. Original failed attempts are retained locally under `output/ui-loop/shared-navigation/2026-11-06`.

The shared navigation change does not establish the UI score gate. Stage 1 loop 16 has only the first three screens audited by both models; the remaining screens and current-source integration validation remain required before merge.

## No-save dialog title

Stage 4 finding S4-L0-sol-08 identified a title promising Save when that action was unavailable. The title now follows the same `summary.saveable` condition as the description: saveable work retains its existing title, while non-saveable work says “ละทิ้งการเปลี่ยนแปลง?” / “Discard changes?”. Actions, descriptions, and pending protection are unchanged.

Exact title expectations were updated in existing callers, with English and Thai assertions for both branches. The focused AST-derived selection passed 63 parameterized cases from 56 literal titles across 22 unit files (684 unrelated cases skipped), one worker, 66.53 seconds. Changed-file lint/format and final normal ESLint/typecheck passed. Six HR browser-selector files were updated to the new accessible title but were not executed locally; CI and the stage runtime runs remain required. The earlier broad title-test attempt was aborted under unrelated machine load and is retained as incomplete, not a pass. No test timeouts were increased.
