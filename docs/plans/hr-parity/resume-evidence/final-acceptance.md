# Final independent acceptance and recording handoff

**Full acceptance is not granted.** The retained leave/roster regressions pass, and the real browser stages completed **49 passes, 1 failure, 1 interrupted case and 3 unexecuted cases**. Actual raw footage exists, but no complete tutorial flow passed its recording checks. Every take is private and `preferred:false`; none is presented as a verified full walkthrough.

## Exact source

Isolated checkout: `/Users/macbook/.t3/worktrees/industrial-sas/t3-9c4080aa`, branch `t3/hr-final-acceptance-recording`. Production range `a2e964e2045269231fc0df429d52cc51f53e2658..c5d21eafbdb2f868de77ea8eb484c563ef476664` was fast-forwarded with its original commits and attribution. Then exactly these test/evidence commits were cherry-picked, in order:

- `43d026409daceadcb75c281b6ec6cfff568e186d` → `d6dd3342`
- `9a826d53` → `96b25191`
- `3d2e6530` → `37568897`
- `fad9e75e` → `f71a4dcd`
- `0a07a193708b34fbb387b73c4f1feacadd265113` → `532e212c`
- `b7e2afe357ee23ceb6538b65f9eeb8376d6c71d1` → `41d8ec47`

`281c1e75` was already in the source range; neither it nor `cfbab8b7` was duplicated. The semantic integration removed only a duplicate type-only import from the limit test, retaining its populated 1,550-row read/update/stale-refusal assertions. Full source/local SHA, author, date and subject mappings are in [final/source-map.json](final/source-map.json).

Primary browser head: **`31b46fe1b7d9f6d24c1caaf3eeed2fd4f08a795b`**, clean at launch. Focused active-leave and all recording attempts: **`8379396a17ec52fac51e5c9898adf39248fe1671`**, clean at launch. The latter adds only restoration of this lane's interrupted local role case before focused acceptance.

After stopped runs, the coordinator's copy-only `b42f07c1` and audit/storyboard `76b49800` were incorporated as `36b3ebf9` and `55a4a9c9`. Both are already included in the primary browser head. No recorded old bank hint needs correction. `git diff c5d21eaf -- src convex docs/contracts` is empty; the only later production-file difference is the supplied two-language hint: “The first account is stored as the primary account.” No implementation repair was taken over.

Lane test/evidence commits before runs: `e0df5213` (mapping/import resolution), `b6782dd0` (guarded active-leave subset), `74fa4834` (followup mapping), `31b46fe1` (assigned web port), `8379396a` (owned local-role restoration). The final handback commit adds reports and capture-helper snapshots only.

## Boundaries and inspection

Read AGENTS, installed Next 16.3.8 navigation documentation, Back contract/inventory, root resume, source combined/coordinator/full-feature audits, and previous Sol acceptance/recording plan. Applied qa-video recording methodology only, in English; no Dr.Ease URL, SSH, service or database was used. No child agents, push, deploy, PR, shared demo write, external Clerk user/role/policy change or history rewrite.

Independent inspection confirmed that roster reads active claims in bounded monthly ranges and validates all selected cells before domain writes. Claims are released on withdrawal/return/cancellation. Approval checks every claimed date with `isEmployedOn(employmentOf(employee), date)` before attendance/balance writes, retaining the captured-plan semantics.

Only the explicit nine TEST fields were privately transferred. This checkout created its own anonymous Convex data; no database was copied. The harness verified the pinned real Clerk user and organization membership. Actual browser runs used **http://localhost:3110**, Convex `127.0.0.1:3320/3321`, workers **1**, retries **0**, case limit **120s**, expect **30s**, navigation **60s**. Pixel 7 is Chromium emulation, not a physical phone. Direct fixture writes/readbacks are separate from UI actions.

Port 3100 belonged to another checkout. Two initial attempts refused it before any HR service/auth/test. The coordinator explicitly assigned 3110; exact host/key/issuer guards were retained, arbitrary ports/hosts remain refused, and 25 environment/seed guard tests passed before launch. The unrelated 3100 service was left untouched.

## In-process verification

| Scope                                                                                                                                             | Actual result                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Policy-neutral leave regression, new consistency cases, populated deployed-limit regression, employee/navigation/organization/roster/i18n callers | **118/118**, 10 files                                                                                                               |
| Organization, work rules, roster, supervisor, employment gaps, seed/environment preservation                                                      | **127/127**, 9 files                                                                                                                |
| Assigned-port environment/seed guards, including wildcard/IPv4/IPv6 listeners                                                                     | **25/25**, 2 files; overlaps the preservation set                                                                                   |
| Back navigation gate                                                                                                                              | Passed: 68 Node fixtures; 60 route/error policies, 309 owners, 26 intents                                                           |
| Normal ESLint after the test changes                                                                                                              | Passed                                                                                                                              |
| Discovery                                                                                                                                         | Passed: 397 Vitest files, 27 Playwright spec files                                                                                  |
| TS6 and pinned Bun/embedded TS                                                                                                                    | Passed after teardown, serialized TS6 then Bun 1.4.3 / embedded TS7.0.2 (1,137 files); exact provenance in `final/run-summary.json` |

These are convex-test/jsdom/Node checks, not real-browser approval. Counts overlap and must not be summed. The transaction-limit test exercises the full populated 50×31 selection; it is not a browser throughput measurement. Distinct-identity leave approval and employment-gap refusal pass in the registered-handler regression, using in-process identities.

## Real browser stages

Exact cases, provenance, statuses and narrow failure excerpts are in [final/run-summary.json](final/run-summary.json). Private reports/screens/session diagnostics remain under `.cache/hr-final/`, `.cache/hr-browser/`, `test-results/hr-local/` and `playwright/.auth/`.

| Stage                                                             | Actual result                                | Limits and retained artifacts                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Employee/profile/payment/lifecycle/recovery, desktop + Pixel 7    | **27 passed, 1 failed**, 549.03s             | Existing case/expect limits; outer bound 840s did not fire. `.cache/hr-final/archive-employee/` |
| Foundation/protocol/roles/roster, desktop + Pixel 7               | **20 passed, 1 interrupted, 3 not executed** | Outer 840s bound fired. `.cache/hr-final/archive-foundation/` and `foundation-3110.log`         |
| Illustrative active-leave submission/claim locking, both projects | **2 passed**, 97.67s including service setup | Outer 360s; actual UI submit and real backend refusals. `.cache/hr-final/archive-active-leave/` |

The previously blocked desktop dirty/stale caller **passed**, as did its mobile counterpart. All **16 cases in `employee-recovery.spec.ts`** passed across both projects. COMMITTED writes hold actual server frames after the genuine commit; FENCED cases destroy a genuinely offline document. No backend result was synthesized.

The retained employee failure is mobile **“employee unsent ID-only real reload fences request without replaying private draft”**, at its _initial_ Personal-details opening (`employees.spec.ts:343`, helper line 61). The helper observed the employee profile; after clicking Edit personal details, the final snapshot showed the employee list, with `mode`/`employee` removed from the URL. The dialog was absent for 30s. Offline write, reload, reconciliation and late-write assertions were **not reached**. Cause unknown; this is not counted as a recovery pass and was not randomly rerun.

The outer foundation bound interrupted mobile **“roles HR employee keeps self-service while real backend denies admin reads, writes and pages.”** Not executed:

- Mobile **“roles HR supervisor reviews team attendance but stays denied for HR administration”**.
- Mobile **“roster fixed shift UI saves and reloads while pristine Cancel consumes its entry”**.
- Mobile **“roster real batch SHIFT OFF Clear persists and selected newly recorded cell can be removed”**.

All twelve desktop foundation/protocol/role/roster cases and the first eight mobile foundation/protocol cases passed. Termination prevented the foundation JSON reporter from flushing; its counts come from the real reporter's per-case console events matched to discovery titles. A stale employee JSON was explicitly renamed `STALE-employee-report-not-foundation.json`, never used for those counts. No clock, correction, physical-device, Thai-UI, full-repository or full-release claim is made.

## Actual active leave, separate approval gap

The fixture was guarded to this exact loopback backend and marked **ILLUSTRATIVE LOCAL TRAINING FIXTURE — no legal entitlement assertion**. It used authenticated public handlers to give synthetic retained employees valid schedules where needed, reconcile openings, add training holidays and activate policy version 1. It changed no external identity policy. These setup actions were not UI acceptance.

Both projects then used the real English leave UI to preview and submit one annual working day. Desktop reserved **2026-11-16**, mobile **2026-11-17**. The roster UI disabled each claimed cell; the real OFF mutation returned `ROSTER_DAY_LEAVE_CLAIMED`. The actual approval attempt returned `SELF_REVIEW`; neither request was approved. The UI approval button was not exercised with another actor, and no reviewer was invented.

Actual sanitized backend evidence is in `output/hr-final-english/evidence/active-leave-*.json` and `active-leave-readback.json`: annual `used 0`, `reserved 0→1→2`, both requests PENDING v1; both dates retain revision 0, no events, no disposition and UPCOMING status. This is submission/claim-lock acceptance, **not approval/consumption acceptance**. Distinct-identity in-process approval tests do not close that real-UI gap.

## Real footage and recording outcome

Read [the recording report](final/recording-report.md) locally. Absolute media paths, measured durations, source/dirty flags, byte sizes and SHA-256 values are in `output/hr-final-english/videos.json`; real epoch events and English labels are in `events.json`. **Eight raw takes exist; all are private/non-preferred. No edited or caption-burned tutorial was produced.**

T3 readiness failed twice with exact errors `Preview automation open timed out after 15000ms` and `Preview automation waitFor timed out after 15000ms`; its owned tab was closed. Headed Chrome fallback used 1280×800, slowMo250 and 1.8s holds, with authentication outside recording. One unrecorded cold-output setup timed out. The recording helper's initial 5s standalone expect default and an ambiguous End/Ends-next-day locator were corrected to the existing 30s expectation and exact End label; those failed takes were retained. No acceptance-test limits were raised or test failures erased.

Separate `recordVideo` contexts then showed actual app read-error screens. The final bounded attempt captured Chrome's real CDP screencast in the authenticated context, starting **after** the pinned user/org and initial real UI were verified. Actual JPEG frames and their browser timestamps were encoded to VFR WebM; no scene was invented, no auth screen was recorded, and no footage was edited. Capture-helper snapshots and SHA-256 hashes are under `final/recording-sources/`.

| Flow                               | Outcome                               | Latest raw path and evidence                                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Company/org                        | **FAIL** to complete reload proof     | `.cache/hr-final/cdp-company-org-take3/capture.webm`, **121.00s**. Save, logo, company reload, stale refusal and three master creations were filmed. Final department reload could not show `Edit department TRAIN Operations` within 30s. |
| Employee/profile/payment/lifecycle | **BLOCKED** before tutorial writes    | `.cache/hr-final/cdp-employee-take2/capture.webm`, **49.36s**. Actual backend response: `Function execution timed out (maximum duration: 1s)`. Earlier separate-context take showed “The read did not complete.”                           |
| Fixed shifts/roster                | **BLOCKED** before roster assignments | `.cache/hr-final/cdp-shifts-roster-take3/capture.webm`, **45.60s**. Real TRAIN shift saved; subsequent site option did not become selectable within 30s.                                                                                   |

The company take contains useful **partial** states at approximately 0.5–37s (company save/logo/reload/stale refusal) and 56.9–76s (master creation). The roster take contains shift creation around 6.9–20s. These are editorial review ranges, not verified full-flow clips. Final reload/read-error ranges must not be cut into a false successful ending. No complete before/after backend JSON bundle was produced for these failed walkthroughs; only active-leave readback is complete. Preserve all prior takes.

Captions must not claim bank display on payslips, payroll/tax generation, legal benefit correctness, masking from authorized HR editors, or a tooltip reason not visible in footage. Only claimed working dates are leave-locked. “Locked dates cannot be selected” remains the safe roster caption. No offboard/reinstate tutorial actions completed, so no filmed separation-gap claim is made.

## Cleanup and remaining work

Final guarded local-role restoration returned the exact existing baseline `ORG_ADMIN`, `HR_ADMIN`, `HR_EMPLOYEE` and retained it. Interrupted-run cleanup found one detached owned Next group, verified exact checkout/cmd/listener ownership, journalled and stopped it; no broad kill was used. Recording supervisors/backends/Next/Chrome sessions were closed. Owned process/port audits are in `.cache/hr-final/`; final safe cleanup evidence is included with the recording report. Ports **3110/3320/3321 have no listeners**. All run-created Clerk sessions are inactive/revoked: the final recording session was explicitly verified revoked, and a read-only session inventory found **zero active sessions created during this lane**. Older unrelated sessions were left untouched. No owned T3 tab remains.

Large host UTC jumps were observed between stages (including 13:47→14:17→15:18 UTC). Epoch timestamps are retained verbatim without assigning a cause; media durations are measured by ffprobe. The host epoch span is not represented as measured active work time.

Normal lint, discovery, navigation and type checks do not replace the missing runtime cases or complete recordings. Follow-up needs the retained mobile transition investigated, the three unexecuted mobile cases and interrupted role case completed, real approval with a separately authorized reviewer, and stable full walkthrough capture. The recording-time 1s backend execution timeout and read errors are reported without claiming a root cause or silently changing production.
