# HR acceptance and recording protocol — November 2

Status: preparation only. No tutorial take is authorized as a passing walkthrough
until the final combined corrected source passes the acceptance gates below.
The current baseline has real failures. Keep failures visible in the acceptance
report; do not cut a successful-looking tutorial from a failed flow.

## Source and service ownership

- Use the T3-prepared test checkout, never the dirty Development checkout.
- Record `git rev-parse HEAD`, `git status --porcelain`, the source mapping,
  run command, UTC and Bangkok start/end times before every run. Commit test
  edits first. Distinguish tested source from later documentation commits.
- Reuse only the existing nine-field explicit TEST harness allowlist, privately.
  Verify the pinned real Clerk user and organization through setup. No invented
  credentials, auth mocks, other sessions' revocation, or shared demo writes.
- `node scripts/hr-e2e.mjs ...` owns anonymous Convex on 3320/3321 and Next on
  localhost:3100. Its preflight must refuse occupied IPv4/IPv6 loopback and
  wildcard listeners. Retain the run lock, process-group journal and finite
  setup/test deadline. Never adopt or kill somebody else's listener.
- Run only one browser suite at a time. Stop it before Next typegen/typechecks.
  Each run has workers=1, retries=0 and its unchanged test/expect time limits.
  Stop a blocked setup and classify it; do not enlarge timeouts or retry to green.
- Keep every run under a distinct ignored `.cache/hr-browser/resume-runN/`,
  including report, artifacts, process journal, console output and test source
  digests. Reports/screenshots containing authenticated DOM remain private.
- Restore exactly the previous local database role grants in `finally`.
  Revoke only the test's own recorded Clerk session. Journal shutdown; confirm
  all owned groups are gone and ports 3100/3320/3321 have no listeners at handback.

## Final acceptance order

Use the corrected exact commit, not a moving implementation checkout. Preserve
the earlier private DB/artifacts before any fresh final test database is created.
This suite retains disposable employees, so repeated broad runs can exceed the
50-employee roster bound; do not interpret an overfilled test fixture as a new
product regression or delete prior evidence to manufacture a pass. These are
focused suites, not permission to rerun the full repository until green.

1. Run `pnpm check:navigation`, normal `pnpm lint`, `pnpm ci:test-discovery`,
   and serialized `pnpm typecheck:ts6`. Run the repository's pinned Bun typecheck
   only if its checker is available; record setup failure separately if unavailable.
2. Run focused real caller tests for EmployeeProfileSections, EmployeesNavigation,
   EmployeeGapDetails, ShiftsRoster and HrOrgSettings. Include retained employment
   drafts, live pending completion, direct links, locale/query/hash, Close/Cancel
   followed by next Back, nested dialogs, Forward and remount. These jsdom tests
   supplement actual browser evidence; they are never browser tests.
3. Run registered handler tests for work rules, organization preservation,
   employment gaps/overnight shift protection, leave/roster consistency and
   `04-shifts-roster-limits.test.ts`. The 50 × 31-cell maximum belongs in a
   transaction-limit-enabled registered-handler probe, not 1,550 browser clicks.
   Do not add broad policy activation or legal benefit claims to enable a demo.
4. Run desktop Chromium and Pixel 7 Chromium emulation against real Next + the
   owned Convex + verified Clerk TEST account:

   ```sh
   node scripts/hr-e2e.mjs employees.spec.ts employee-recovery.spec.ts employee-lifecycle.spec.ts
   node scripts/hr-e2e.mjs foundation.spec.ts protocols.spec.ts roster.spec.ts roles.spec.ts
   ```

   Archive the first run before the second. If a particular case remains blocked
   or fails, retain it and report the exact reproduction. Use a narrower follow-up
   only after a source/test correction or a specific unresolved question.

5. Confirm company/org/employee saves preserve existing fields, real PNG
   upload/removal and revision conflicts; profile/contact/emergency/payment
   create/edit/reload with masked summary; dirty/stale and pending refresh;
   COMMITTED and FENCED recovery after versions advance; no sensitive stored
   payload and no late duplicate write; offboard/reinstate separation gaps and
   chronology; overnight open-shift refusal; fixed shifts and roster batch
   SHIFT/OFF/Clear, selected cell locking and atomic stale refusal. Disclose
   direct registered API setup/checks separately from actions exercised in UI.
6. Clock coverage requires new genuine clock actions. If same-day state has
   already consumed the actions, record zero actions and SKIP, including mobile.
   Never reset attendance to manufacture coverage. Mobile emulation is not a
   physical device test. Active leave approval coverage requires an explicit
   local synthetic policy fixture; an inactive-policy gate is a different result.

## Three-flow tutorial outline

Use one staff view, with the local backend readback saved as evidence; no invented
second-party page. Record the real app only. Prefer the verified Thai UI if that
exact flow passed in Thai; otherwise use the tested English UI and label it.
Do not add a voiceover unless requested. Avoid claiming deferred payroll,
calculation, flexible shifts or rotation functionality.

| Flow                                   | Before and action                                                                                                                                                                                     | Negative case                                                                                                                                       | Verified ending                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Company and organization               | Show `บริษัท ทดสอบ HR / HR Training Company`, create `Training Operations`, `Training Coordinator`, and `Training Level`; save company/bank and a small synthetic PNG logo, then employee assignments | Two local editors demonstrate a stale logo revision refusal, with no silent overwrite                                                               | Reload company/org/employee assignment and compare saved values; show explicit reapply only after reviewing refusal |
| Employee lifecycle and private payment | Use an unlinked disposable `TRAIN-<unique>` employee, safe personal/contact/emergency data and synthetic bank details; save and reload masked summary, offboard and reinstate on valid past dates     | Dirty Back keeps the draft; invalid lifecycle chronology refuses without a new event; demonstrate recovery only if its final real acceptance passed | Backend versions/events match UI once; separation gap remains excluded, payment summary shows last four digits only |
| Fixed shifts and roster                | Create `TRAIN-AM-<unique>` 08:00–17:00 with a 60-minute break; assign two eligible dates, then OFF and Clear                                                                                          | A selected cell recorded independently becomes locked; remove it while keeping the other selection, and show atomic refusal where appropriate       | Reload confirms stored revisions and weekly fallback; captured attendance plan stays unchanged                      |

Use reserved synthetic email `training@example.invalid`, fictional address
`123 Training Road`, and clearly synthetic identifiers/accounts. Never display
Clerk identifiers, JWTs, cookies, environment values, source logs or a real
person's account. Preview the intended frames privately before publication.

## Capture and timestamp procedure

Read and adapt only the recording methodology in
`/Users/macbook/.codex/skills/qa-video/references/record.md`; Dr.Ease endpoints,
SSH hosts, databases and authentication are outside this task.

1. After final acceptance, call `preview_status`, then open a dedicated owned
   incognito tab if needed. Authenticate privately using the same verified TEST
   fixture. Start recording only after sign-in, on a safe synthetic app screen.
   Never share an existing person's browser session.
2. Prefer T3 `preview_recording_start({tabId})` and
   `preview_recording_stop({tabId})`. Record returned `startedAt`, stop time,
   path and size. Interactive actions use fresh snapshot locators. Stop before
   opening logs, account settings, credentials or unrelated pages. Close the
   owned tab when finished. No recording was taken in this preparation stage.
3. If T3 is unavailable, record the explicit tool error and use the already
   authorized Playwright runner: headed Chrome, 1280×800, `recordVideo`,
   `slowMo:250`, one context. Hold verified states 1.5–2 seconds, move the pointer
   before clicks. This remains real app footage, not an automatic polished cut.
4. Store `events.json` entries
   `{t_ms_epoch, side:"staff", id, label_th}` at actual visible before/action/
   refusal/saved/reload states. Capture process UTC/Bangkok time and browser
   `Date.now()` offset at start/end; retain discontinuities without guessing a
   cause. Do not fabricate timestamps from expected durations.
5. Store `videos.json` entries
   `{file,side:"staff",flow,start_ms_epoch,duration_ms,preferred}` using measured
   durations. Keep earlier takes with `preferred:false`. If two real windows
   are later required, calibrate epoch clocks to within 100 ms and disclose any
   larger offset; do not silently claim synchronization.
6. Save minimal approved synthetic backend before/after JSON under `evidence/`,
   safe screenshots under `screens/`, video under `raw/`, and per-flow rows
   `step | expected | actual | PASS/FAIL/BLOCKED | evidence` in `report.md`.
   Review JSON for secrets before sharing. Keep private browser/debug artifacts
   outside this publication bundle. List loading/setup cut ranges and retakes.
7. End the recording report exactly with
   `RESULT: company-org=<PASS|FAIL|BLOCKED> employee=<PASS|FAIL|BLOCKED> shifts-roster=<PASS|FAIL|BLOCKED>`
   using the actual verdicts. Hand off the real verified footage for editing;
   do not make a successful tutorial from failed or skipped acceptance.
