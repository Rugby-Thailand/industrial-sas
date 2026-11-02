# Runtime diagnosis: retained mobile employee failure and failed recordings

Source: checkout `/Users/macbook/.t3/worktrees/industrial-sas/t3-9c4080aa`, branch `t3/hr-final-acceptance-recording`, HEAD `aab4ad9f0477c844f69f23ae447e70ed833a92e3`. Changes are uncommitted for coordinator review. No push, deploy, branch, worktree, delegate, history rewrite, shared-demo write or Clerk policy change.

**Result:** Symptom A is a proven production race in the Employees editor. It now has a red→green real-browser regression and a minimal fix. Symptom B is not reproduced. Measurements falsify the accumulated-fixture explanations. Each recording failure traces back to a backend read failure (1s function timeout or app read error) during one ~4-minute window. That window's cause is still **unknown**. No speculative fix was made for B.

## A. Mobile “employee unsent ID-only real reload …” failure

### Evidence read

- `.cache/hr-final/archive-employee/report.json`: the only failure is mobile, at 49.5s. The desktop counterpart and every earlier mobile `open(page, "personal")` passed.
- `error-context.md` and the screenshot show the employee list with `q`/`#acceptance`. The `navigation-failure` attachment decodes to `historyLength: 5`, state keys `__NA, __PRIVATE_NEXTJS_INTERNALS_TREE, appNavigationIndex, hrListEntry`.
- `.cache/hr-browser/session-navigation.jsonl` (paths only) shows the difference. In passing cases, the Edit click produces Next's three-event commit triplet before the dialog entry. In the failing case, a single history event comes first (the dialog), followed by four more. No trace was recorded (`trace: "off"`).

### Hypotheses ranked before testing

1. **Race:** `open()` sets `editing` locally, before `router.push` commits the editor URL (dev RSC fetch, which is slow on mobile). The helper sees the profile, clicks Edit personal details, and the Dialog's `useWorkflowStep.enter()` pushes `overlay…=1` onto the _list_ URL. Next's patched `pushState` syncs that URL and supersedes the pending push. The `navigationKey` change resets `editing` from the URL (LIST), so the editor closes. _Prediction:_ delaying only the editor RSC response turns the case red on desktop too, and waiting for the editor URL before clicking turns it green.
2. Harness gesture mis-hit (Cancel, Back to list, or the dev overlay). _Prediction:_ indifferent to RSC delay.
3. Clerk/identity or Convex refusal remounting HrGate. _Prediction:_ error UI, no URL change, indifferent to delay.
4. A late search-field settle rewriting list criteria. _Prediction:_ a list-only URL write, indifferent to delay.
5. The invalidation traversal in `useWorkflowStep` (`step && !available`). _Prediction:_ happens without the delay too.

### Red feedback loop (actual caller, real Clerk/Convex/Next)

One bounded instrumented experiment ran first, using a temporary `[DEBUG-hr-runtime]` spec that delayed the editor RSC request (`rsc: 1`, `mode=edit`) by 4s:

```
node scripts/hr-e2e.mjs zz-debug-hr-runtime.spec.ts --project hr-desktop
→ waitForUrl=false FAILED (dialog absent; final URL list?q#acceptance, historyLength 5, same state keys)
→ waitForUrl=true  PASSED
```

The URL trace for the red case: `profile visible url-has-editor=false` → `keys=q,overlay_r_2h_` → `keys=q` (×3). The editor URL was never committed. This is the same five-event signature and final state as the original mobile failure. Hypothesis 1 is confirmed. Hypotheses 2–5 are falsified, because the outcome depends only on commit timing, and the result is deterministic on desktop.

### Regression (correct seam), then fix

The regression was added to `tests/e2e/hr-local/employees.spec.ts`: **“employee foreground opened while the editor URL commit is delayed keeps the editor and its URL”**. It uses the existing `employee()`/`open()` helpers and asserts the dialog, `mode=edit`, `employee`, the original `q` and `#acceptance`, then Cancel retaining the profile.

- Red before fix: `node scripts/hr-e2e.mjs employees.spec.ts --project hr-desktop -g "delayed keeps the editor"` → failed at `employees.spec.ts:61`, the exact original line and attachment (`historyLength 5`, `hrListEntry`).
- Fix (`src/features/hr/EmployeesScreen.tsx`): the optimistic `editing` state still locks the list and Add, but the editor renders only after its URL has committed (`editorUrlCommitted`: NEW ↔ `mode=new`, EDIT ↔ same `employee`). Any foreground opened from the editor now builds on the editor entry. Close/Cancel/traversal, provenance and inventory semantics are unchanged; the inventory already declares “Editor selection follows the URL.”
- Green: `node scripts/hr-e2e.mjs employees.spec.ts zz-debug-hr-runtime.spec.ts -g "delayed keeps the editor|unsent ID-only real reload fences|DEBUG-hr-runtime"` → **8/8 passed** (desktop + Pixel 7): the regression, the originally failing case, and both diagnostic variants. After the fix the diagnostic logs `profile visible url-has-editor=true`.

The jsdom caller tests cannot show this bug, because their router mock commits synchronously. The browser regression is therefore the correct seam.

### Checks

| Check                                                                                                                                                                                             | Result                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Vitest callers: EmployeesNavigation, EmployeeProfileSections, EmployeeForm.employment/.memberScope, EmployeeGapDetails, HrPagedRecovery, HrListReturn, HrBack, HrBackNavigation, HrClientRecovery | 165/165, 10 files                                   |
| `pnpm check:navigation`                                                                                                                                                                           | OK: 60 route/error policies, 309 owners, 26 intents |
| `pnpm lint` (eslint . --max-warnings=0)                                                                                                                                                           | exit 0                                              |
| `pnpm typecheck:ts6`                                                                                                                                                                              | exit 0                                              |
| Codegen                                                                                                                                                                                           | Not relevant: no Convex/schema change               |

Not rerun: the other employee/recovery browser cases. Every one of them goes through the changed render path. Run them once, as step 1 of the recipe below, before granting acceptance.

## B. Recording failures

### Facts from the retained artifacts

- `output/hr-final-english/walkthrough-results.json` and `videos.json`: all three final CDP takes ran between 16:15 and 16:20 UTC on source `8379396a` (clean).
- Employee take 2: the UI loaded the editor (`cdp-employee-take2/failure.png` shows the Edit form). The error came from the **recorder's direct `ConvexHttpClient` query** (the first call in the body, `employeeLifecycle`): `Function execution timed out (maximum duration: 1s)`.
- Shifts take 3: the failure screen is the app error boundary **“The read did not complete.”** The missing site option is therefore a consequence of a failed read, not a locator mismatch. The label format `code · name` matches `HrSiteSelect`.
- Company take 3: the masters were created at 16:16:19–16:16:37; the post-reload department button was then absent for 30s.
- `.cache/hr-final/record-web.log` has the editor RSC for that same window: `GET /en/hr/employees?employee=…&mode=edit… 200 in 44s (application-code: 38.9s)`. The server code for that route only awaits Clerk `auth()`, and other requests took 0.4–2.5s. The same stall therefore hit the Next server, and it also widened Symptom A's window in the recording.
- Host sleep is not evidenced inside the takes: each take's epoch frame span is ≤ its monotonic elapsed time. The UTC jumps between stages remain unexplained.
- The recording-time Convex backend log was **not retained**: both `serve.mjs` and `scripts/hr-e2e.mjs` open `.cache/hr-browser/backend.log` with `w`, and that file was overwritten by this pass's runs. Function logs were disabled (`--tail-logs disable`) in any case.

### Defined measurement (read-only, same accumulated local data)

A temporary `[DEBUG-hr-runtime]` spec ran on fresh owned services: `node scripts/hr-e2e.mjs zz-debug-hr-runtime.spec.ts --project hr-desktop` → passed.

- Scale: `sitesComplete=true`, 1 site (the fixture site is in the preview), 7 departments, exactly 1 `TRAIN Operations`. This **falsifies** a paged site picker, truncated masters and duplicate-name strictness as causes.
- HTTP latency, 8 calls each: `hr/access:display` 20–107ms, `hr/org:listDepartments` 21–27ms, `hr/access:sitesPage` 19–29ms, all ok.
- Organization page reloaded 3×: list visible in 4.5s/2.4s/1.6s (first compile included); `Edit department TRAIN Operations` count 1.
- `employeeLifecycle` itself was not timed: the read-only search found no `TRAIN-EMP-` row with `pageSize: 1`. It reads one employee, at most `MAX_EVENTS` indexed events, two `take(1)` bounds and member names, so it is not a scale-bound query. Its latency under the recording conditions is still unmeasured.

### Classification

| Symptom                   | Backend/measurement                                                                                                                                | Capture/load/auth/setup                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Employee 1s timeout       | Real backend error (recorder's direct query). Cause of the >1s execution unknown. Normal latency on the same data is ~20–30ms for comparable reads | Recorder clicked during the uncommitted-editor window (now fixed) |
| Shifts site option        | App read error preceded the option wait                                                                                                            | No locator/fixture defect found                                   |
| Company department reload | Not seen on fresh services (1 matching button, ≤4.5s)                                                                                              | Likely the same stall window; unproven                            |

**Remaining unknown:** what stalled both the local Convex backend and the Next server at 16:16–16:20 UTC after many sequential takes (host CPU contention from headed Chrome + CDP screencast + webpack dev, backend state, or something else). Do not raise the 1s limit or test timeouts. Do not attribute it to the machine without a measurement.

## Next recording recipe

Small steps, exact source, one flow per service lifetime.

1. Commit or review this change, then record from that exact clean SHA. Before recording, run the remaining employee browser cases once: `node scripts/hr-e2e.mjs employees.spec.ts employee-recovery.spec.ts employee-lifecycle.spec.ts`.
2. Change the recorders to append to a per-run backend log rather than truncating `backend.log`, and keep `record-web.log` per flow. Start services with the existing guarded `serve.mjs` on 3110/3320/3321 after the IPv4/IPv6/wildcard preflight.
3. Warm each route once off-camera (`/en/hr/settings?section=company`, `?section=organization`, `/en/hr/employees` plus one editor URL, `/en/hr/shifts`, `/en/hr/roster`) so dev compilation never happens inside a take.
4. Run one flow per service lifetime (`HR_RECORD_FLOWS=company-org`, then restart services for `employee`, then for `shifts-roster`). Gate each step on the committed URL plus a visible ready element, for example `toHaveURL(mode=edit&employee=…)` before opening a profile dialog.
5. Around each recorder API call, record the request ID, wall time and the matching `record-web.log` lines. On the first `Function execution timed out` or “The read did not complete”, stop the take, keep its frames, and capture `ps`/load average once. Do not retry until green.
6. Split takes at natural boundaries (company save/logo/reload/refusal; organization masters + reload; employee personal/contact/payment; lifecycle; shift; roster). Short verified clips are better than one long fragile take. Keep English captions, no voiceover, and do not edit or render until a full set passes.

## Process journal and cleanup

All runs used `scripts/hr-e2e.mjs` (exact-loopback guards, the nine-field TEST allowlist, verified Clerk identity, owned sessions revoked by the fixture, no auth mocks). Owned process groups: run 1 convex 18052 / playwright 18060; run 2 (red) 19245/19253; run 3 (green) 20024/20033; run 4 (measure) 25927/25944. Each was stopped by the harness (convex SIGTERM; journal `.cache/hr-browser/processes.jsonl`). Final check: no listeners on 3110/3320/3321, no `run.lock`, and no process from this checkout except the Kiro session. Port 3100 and other projects' dev servers (3240/3250/3255) were not touched. Private outputs are under `.cache/hr-diagnosis/`. Both `[DEBUG-hr-runtime]` specs were deleted; `grep -rn DEBUG-hr-runtime src tests convex scripts` returns 0.

Changed files: `src/features/hr/EmployeesScreen.tsx`, `tests/e2e/hr-local/employees.spec.ts`, this document.

## Coordinator review before committing

Reviewed the production diff and real-browser red/green log. The fix gates editor rendering on the matching committed URL while preserving immediate selection locking; it does not suppress or bypass the dialog guard. NEW and EDIT selection checks match their respective URL states. Updated the existing editing owner in `back-navigation.json` with the precise committed-URL requirement and the literal new browser regression case.

Independent coordinator check: normal `pnpm lint`, `pnpm check:navigation` (68/68 fixtures and inventory), `git diff --check`, and `EmployeesNavigation.test.tsx` plus `EmployeeProfileSections.test.tsx` passed **51/51**. These caller tests overlap Kiro's 165 and do not replace the pending full employee browser rerun. The 8/8 diagnostic browser total includes four temporary probe variants; the permanent regression and originally failed case passed on both projects.

The old recording backend log was overwritten during diagnosis. Preserve remaining old evidence and create unique per-run logs before any new services. No root cause or repair is claimed for the recording-time backend stall.
