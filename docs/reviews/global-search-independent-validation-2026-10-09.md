# Global search — independent validation

วันที่: 2026-10-09 · งานอยู่ในเครื่อง; ยังไม่เปิด PR ตามคำสั่งล่าสุด

Kiro implemented Phase 1 and Phase 2 of the [requirement and phase plan](../plans/global-search-ai-navigation-plan.md). Root independently audited the changes, supplied consequence regressions, exercised the actual configured model and local running app, and sent two fix rounds to Kiro. Phase 3 (storage entity lookup) remains deferred; static storage destinations are searchable.

## Result

- One destination registry serves static search, breadcrumbs and allowlisted AI navigation. Search reaches HR settings sections, employee editors/schedules, review days, own correction forms and explicit period versions.
- Employee and period lookups retain organization/site/self/team scope. Exact codes run through indexes; bounded name/period reads report incomplete results. A name alone never auto-selects an employee.
- The AI sends typed text and page/selection flags to OpenRouter, then schema validation and grounding against the original text precede protected record queries. App code builds the final URL. Navigation does not save, certify, revise or export HR data.
- Unsent and pending forms participate in the existing navigation guard, including same-page selection/version changes. Query, account, grants, selection, cancel and unmount invalidate old AI/search results. IME/debounce results cannot open the previous query's target.
- Search supports Thai/English, Cmd/Ctrl+K, arrow/Enter/Escape, collapsed sidebar and a full-screen mobile dialog.

## Independent evidence

| Check                                           | Evidence and scope                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root required check before final label polish   | `pnpm check`: typecheck, zero-warning lint, 151 files / 1,405 tests passed. `output/global-search/root-check.log`.                                                             |
| Root production build before final label polish | Exit 0; all 45 static pages generated. `output/global-search/root-build.log`.                                                                                                  |
| Final Kiro check after label polish             | `pnpm check --maxWorkers=1`: 151 files / 1,406 tests passed. `output/global-search/polish/check.log`.                                                                          |
| Final production build after label polish       | Passed; compiled and all 45 static pages generated. `output/global-search/polish/build.log`.                                                                                   |
| Final focused component/domain check            | 5 files / 167 tests passed; period target-label regressions fail when the fix is temporarily reverted. `output/global-search/polish/focused.log`.                              |
| Independent context probes                      | 7/7; explicit names/codes take precedence, dropped evidence cannot use context, short/alpha codes and code V1 remain valid. Synthetic inputs against actual grounding code.    |
| Independent resolver probes                     | 11/11; wrong-person fallback, range/version precedence, future/ambiguous dates and malformed versions are held. Synthetic scoped lookup responses; not authorization evidence. |
| Protected-query integration tests               | 19 cases cover scope, completeness, index lookup beyond list limits, provider failure/contract and quota. Convex test backend with a stubbed provider; not a real model.       |
| Real configured model                           | 60 frozen synthetic Thai/mixed queries sent using the shipped request/prompt/schema/parser. Parsed 60/60; explicit semantic-field oracles passed 58/60 (96.7%).                |

The final offline replay confirmed the shipped request body is identical to the evaluated body (`requestBodySame=true`) and revalidated all 60 captured answers against final grounding. There were no new provider calls in this replay. Model evaluation proves intent/grounding on this small synthetic set; it does not prove 100% real-data/role/browser navigation accuracy or a production latency/cost SLA.

Residual model semantics: “แก้เวลา 8 ต.ค.” asked which employee rather than confirming the missing year/date; “ดูยอดวันลาคงเหลือ” classified unsupported topic as OTHER instead of LEAVE_REQUEST. Both remained clarification/unsupported, with no wrong-target automatic navigation. An additional contextual “ลืมลงเวลาเมื่อวาน” in the native UI first offered task choices and navigated correctly on retry; this extra case is outside the frozen 60-case score.

## Native running-app checks

T3 native preview, authenticated local synthetic HR demo. Observations and original screenshot paths are recorded in `output/global-search/native-browser-evidence.json`; copies are in `output/global-search/screenshots/`.

- Thai “วันหยุด” → `/th/hr/settings?section=holidays`, focused `hr-settings-holidays`; the same section survived reload. English “holiday” opened the localized equivalent via Ctrl+K and Enter.
- Actual AI review query for EMP-DEMO-003 and 8 October opened the certified day without opening a decision form or re-certifying. Reload restored the certified tab and `hr-focus-decision`. A subsequent AI query for 7 October changed the day and focused the decision area.
- “ลืมลงเวลาเมื่อวาน” → own day 8 October and `hr-focus-correction`. An unsent reason stayed when choosing Keep editing; Discard allowed navigation to Holidays. No correction was submitted.
- “แก้ตารางงาน EMP-DEMO-003” → that employee's editor and `hr-focus-schedule`, with the existing 22:00–06:00 schedule. No save.
- “ส่งออกงวด 19–25 ก.ย. 2569 ฉบับ 1” → the closed period's version 1, focused `hr-focus-export`, and version 1 CSV button. No download or revision. The initial result-row label showed latest version 4; Kiro fixed it to display the actual target version 1. Version 99 remained disabled with an unavailable explanation.
- A name-only team query stayed in the dialog with employee/date choices. Bulk OT approval stayed unsupported without navigation.
- At 390×844 the dialog fits the viewport, input font is 16px and there is no horizontal overflow. Light/dark and English samples passed; collapsed sidebar keeps 48px search/AI buttons with accessible names. Escape returns focus to the mobile trigger.

Native preview intermittently returned client errors or lost its automation host; reopening reattached it. Some focused interactions were retried after input settled or through DOM clicks on the observed UI button. Browser checks cover the existing local actor only. Real auth-switch caching, actual hardware IME, VoiceOver and every mobile keyboard were not measured.

Verified captures: [desktop search](../../output/global-search/screenshots/search-desktop.png), [mobile search](../../output/global-search/screenshots/search-mobile.png), [period version 1](../../output/global-search/screenshots/period-v1.png), [employee schedule](../../output/global-search/screenshots/employee-schedule.png).

## Preservation and configuration

The baseline contains 720 source/working-file hashes. Final protected-file verification covers 105 files, including prior staging/prototype work, generated server files, package/lock files and Vitest configuration. None changed; no baseline file was removed. HEAD remains `0e9ea3aba4d241d4e1d732e2adb5637966ebabaa`. Existing HR foundation and unrelated pending work remain in the working tree. No branch, commit, push, PR, merge, deploy or publication was created.

The local anonymous Convex backend uses `OPENROUTER_SEARCH_MODEL=openai/gpt-6-luna` and the already-present server key. No secret was saved in these evidence artifacts. Other deployments need their own model/key configuration; AI returns a typed unavailable outcome when absent and ordinary search stays available.

Root added `output/**` to ESLint's generated-artifact ignores after default lint inspected copied baseline files. Application source and tests remain linted. Changed-file formatting is checked separately; the repository-wide format check still has pre-existing unrelated findings (staging data/older tests), which were preserved.

The final inventory also found 78 new files from concurrent unrelated work (skills, design-sheet and CI review documents). They were left untouched and excluded from this task's formatting set. `output/global-search/task-owned-changes.json` records the 27 modified and 30 new files belonging to search/validation; its final Prettier check passed.
