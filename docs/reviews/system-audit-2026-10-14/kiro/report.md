# System audit 14 Oct 2026: Kiro UI review

Reviewer: Kiro CLI, model `claude-opus-5.5` (Kiro Opus 5.5).
Target: the current working tree of `industrial-sas` at HEAD `733c6aca`, including 263 uncommitted or untracked entries.
Scope: UI defects in the shell, HR, finished goods and storage layouts, plus frontend/backend contract mismatches that users can see. The other reviewer owns the deeper functional and backend audit.

This was an audit only. The only files I created are under `docs/reviews/system-audit-2026-10-14/kiro/`. No app code, tests, configuration, git state or data changed. `git status --short` outside this directory still matches `evidence/initial-git-status.txt`.

## Summary

I found 10 defects: 0 P1, 3 P2 and 7 P3.

- 14 isolated probes reproduced all 10. Every probe fails on the current source, which is the evidence.
- The related existing caller suites still pass: 18 files, 312 tests. They do not assert any of these cases.
- None of these defects corrupts data. The P2 items give contradictory or uninformative guidance in a blocked or refused workflow.

| ID         | P   | Area             | Title                                                                                               | Evidence                            |
| ---------- | --- | ---------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------- |
| KIRO-UI-01 | P2  | HR               | A stale shortcut save tells the user to "try again" while another notice tells them to cancel       | Reproduced (RTL)                    |
| KIRO-UI-02 | P2  | Finished goods   | "No suitable space" lists generic or identical reasons for 9 server reason codes                    | Reproduced (real mapper)            |
| KIRO-UI-03 | P2  | Storage layouts  | The desktop location inspector has two headings and two adjacent X buttons that do different things | Reproduced (RTL)                    |
| KIRO-UI-04 | P3  | Storage layouts  | The location card repeats the empty-inventory sentence twice and the unit count up to three times   | Reproduced (RTL)                    |
| KIRO-UI-05 | P3  | Storage layouts  | The mobile location sheet repeats the code, the floor and the heading                               | Reproduced (RTL), tracked as UI-003 |
| KIRO-UI-06 | P3  | Storage, Thai    | Thai labels repeat an English label: `ชั้น / FLOOR`, `Quick Change · แก้ไขด่วน`                     | Reproduced (RTL + catalogue)        |
| KIRO-UI-07 | P3  | Shell, AI Search | The English UI shows Thai example chips and Thai-only date hints                                    | Reproduced (catalogue), traced      |
| KIRO-UI-08 | P3  | Finished goods   | 5 server refusal codes show "Check your input and connection"                                       | Reproduced (real resolver)          |
| KIRO-UI-09 | P3  | HR               | The Profile card shows the employee code and site twice                                             | Reproduced (RTL)                    |
| KIRO-UI-10 | P3  | HR               | The Today page's Shortcuts section links back to Today                                              | Reproduced (RTL)                    |

"Reproduced (RTL)" means a real component rendered with the real message catalogue in Vitest/jsdom, with only Convex, router and access mocked. It is not a browser or screenshot check. "Traced" means the claim also relies on reading the source.

---

## KIRO-UI-01: A stale shortcut save tells the user to "try again" while another notice tells them to cancel (P2)

**Where:** `/[locale]/hr/customize`, `HrShortcutCustomizeScreen`.

**Source:**

- `src/features/hr/ShortcutCustomizeScreen.tsx:500-513` renders `WriteFeedback` and, for `PREFERENCES_STALE`, a separate stale notice.
- `src/features/hr/HrShared.tsx:17-21`: `useHrError` falls back to `Hr.errors.UNKNOWN` for any code it does not know.
- `src/features/hr/HrShared.tsx:131-140`: the `REFUSED` case adds the `Hr.write.refusedHint` body.
- `messages/en.json:2146` (`Hr.errors.UNKNOWN`) and `:1616` (`Hr.write.refusedHint`).
- `convex/hr/preferences.ts:98,103,106` returns `PREFERENCES_INVALID` and `PREFERENCES_STALE`. Neither code exists in `Hr.errors`.

**Trigger:** Another session saves the shortcuts. This session then changes a checkbox and presses Save.

**Expected:** One warning that explains the real cause and the single way forward.

**Actual:** Two notices appear on the same panel:

- A red alert: "The change was not saved. Try again" with the body "Nothing was saved. Your entry is kept; correct it and try again."
- A warning: "Your shortcuts changed in another session. Cancel to load the current preferences, then make your changes again."

Thai shows the same pair: "บันทึกไม่สำเร็จ กรุณาลองใหม่" / "ยังไม่ได้บันทึก … แก้ไขแล้วลองใหม่ได้" plus "เมนูลัดของคุณเปลี่ยนจากอีกเซสชัน".

**Impact:**

- Following the red alert never works. Save sends the same stale `expectedVersion` and is refused again.
- The two notices contradict each other.
- `PREFERENCES_INVALID` also shows as the unexplained generic message.

**Evidence:** Probe `K-HR-01` in `hr.probe.tsx`. The log shows both texts rendered. The existing case `preserves a refused draft and lets Cancel load the newest query version before resaving` (`ShortcutCustomizeScreen.test.tsx:487`) checks only that the stale notice appears.

**Fix:**

- Add `Hr.errors.PREFERENCES_STALE` ("Your shortcuts changed in another session") and `PREFERENCES_INVALID` in both locales.
- For `PREFERENCES_STALE`, render only the stale notice, or pass a stale-specific body instead of `refusedHint`. Do not show both.

## KIRO-UI-02: "No suitable space" lists generic or identical reasons for 9 server reason codes (P2)

**Where:** The storage recommendation step (`/finished-goods/pallets/[palletId]/storage`, `PalletStorageScreen`) and move selection (`/finished-goods/pallets/[palletId]/move`, `MoveSelection`).

**Source:**

- The mapping is in `src/features/finishedGoods/PalletScreens.tsx:856-905`.
- It renders one `<li>` per reason at `PalletScreens.tsx:808-820` and `MoveScreen.tsx:244-255`.
- The server emits these codes:
  - `LOCATION_GEOMETRY_UNKNOWN` at `convex/finishedGoods/workflow.ts:981-983`.
  - Eight stacking codes (`STACK_PALLET_ONLY`, `PALLET_SUPPORTING_STACK`, `STACK_CYCLE`, `STACK_SUPPORT_UNAVAILABLE`, `STACK_SUPPORT_MOVING`, `STACK_LIMITS_REQUIRED`, `STACK_LEVELS_EXCEEDED`, `STACK_SUPPORT_OCCUPIED`) from `validateStack`. They are defined at `workflow.ts:2269-2318` and added to the reasons at `:1007-1009`.
  - The list is returned only when nothing fits (`:1062-1069`).

**Trigger:** No position fits, and at least one location has saved units without coordinates or has a blocked stack support. The `UI-B-DEMO` seed has unmeasured units, so this case is realistic.

**Expected:** Each reason explains a cause the user can act on, for example "Location contains units without measured coordinates; free space is unknown."

**Actual:** All 9 codes render the fallback "No valid position meets the current dimensions and storage constraints." (Thai: "ไม่มีตำแหน่งที่ตรงกับขนาดและข้อกำหนดการจัดเก็บในขณะนี้"). When two of them occur together, the list shows that same sentence twice, as two separate `<li>` items.

**Impact:** A blocked workflow repeats the heading's message instead of naming the obstacle. The mapping table and the server reason set have drifted apart.

**Evidence:** Probes `K-FG-01` and `K-FG-01b` in `fg.probe.ts` call the real `recommendationReason`. The log lists the 9 codes and shows two identical rendered lines.

**Fix:**

- Add entries for `LOCATION_GEOMETRY_UNKNOWN` and the eight stacking codes. Several already have equivalent wording in `WriteError.FG_STACK_*`, which can be reused.
- Deduplicate the rendered text, for example `new Set(reasons.map(text))`.

## KIRO-UI-03: The desktop location inspector has two headings and two adjacent X buttons that do different things (P2)

**Where:** `/[locale]/master-data/storage-layouts/[buildingId]` (Storage map) on a wide viewport. `FloorMap` renders an inspector `<aside>` that hosts `StorageZonesPanel compact`.

**Source:**

- `src/components/storageLayouts/FloorMap.tsx:943-967`: an `h2` "Location details" and an `IconButton` "Hide details".
- `src/features/storageLayouts/StorageZonesPanel.tsx:1111-1126`: an eyebrow "Selected location" and an X button "Clear selection", rendered inside the same aside, directly below.

**Trigger:** Select any location on the map.

**Expected:** One header row with one dismiss control.

**Actual:** The rendered header labels are `["Location details", "Selected location"]`, and the X buttons are `["Hide details", "Clear selection"]`. The aside's accessible name is also "Selected location" (`FloorMap.tsx:951`), so a screen reader hears "Selected location" twice.

**Impact:**

- Two stacked headings say the same thing.
- Two identical X icons sit a few pixels apart with different results. One hides the panel and keeps the selection. The other clears the selection.
- A user cannot predict which one to press.

**Evidence:** Probe `K-STO-03` in `storage.probe.tsx`.

**Fix:** Keep the FloorMap header (h2 "Location details" with one X) and suppress the panel eyebrow and X when it renders inside a `LocationDetailsHost`. Alternatively, keep a single X with one clear meaning ("Close details"). Because `FloorMap.tsx#FloorMap:inspectorVisible` is a declared presentation owner in the navigation inventory, re-audit it if the targets change.

## KIRO-UI-04: The location card repeats the empty-inventory sentence twice and the unit count up to three times (P3)

**Where:** The compact location details (desktop inspector, mobile sheet and table-view inline drawer), in `StorageZonesPanel` with `compact`.

**Source:** `StorageZonesPanel.tsx`:

- `:785-790`: metric "Storage units: 1 unit".
- `:792-819`: "Stored products" box, which shows the product names plus " · 1 unit", or the empty sentence at `:810`.
- `:966-972`: a second empty sentence.
- `:976-987`: the summary "1 pallet at this location".

**Trigger:** Select an empty location, or one with stored units.

**Expected:** The empty state appears once, and the count appears once.

**Actual:**

- Empty location: "No stored or reserved units yet" appears twice, once inside the Stored products box and once in a bordered paragraph below the QR disclosure. Thai repeats "ยังไม่มีหน่วยที่จัดเก็บหรือจอง" twice in the same way. The metric also says "0 units".
- Occupied location: `1 unit` appears as the metric value and again in "Widget A · 1 unit", and the summary below adds "1 pallet at this location".

**Impact:** The same fact is restated in a narrow panel. The previous Kiro review (`ui-cleanup-2026-10-13/kiro-review.md` §3) noted the duplicated empty sentence but did not schedule it.

**Evidence:** Probes `K-STO-01`, `K-STO-01(th)` and `K-STO-02`.

**Fix:**

- In compact mode, drop the paragraph at `:966-972`. The inventory box already covers the empty case.
- Drop the trailing " · {mapUnitCount}" at `:811-818`, because the metric already states the count.

## KIRO-UI-05: The mobile location sheet repeats the code, the floor and the heading (P3)

**Where:** The same route on a phone (≤580 px), in the `FloorMap` bottom `Sheet`.

**Source:** `FloorMap.tsx:1040-1046` renders the `SheetTitle` "Location details" and the `SheetDescription` "{code} · Floor N". `StorageZonesPanel.tsx:1114-1116` then adds the eyebrow "Selected location", and `:756-759` adds `h3` {code} and "{label} · Floor N".

**Actual (en):**

- H2 "Location details", then "FG-1 · Floor 2".
- SPAN "Selected location", then H3 "FG-1", then "Occupied FG · Floor 2".

The code appears twice, the floor twice, and two synonymous headings stack on top of each other.

**Status:** This is UI-003 in `docs/plans/ui-cleanup-2026-10-13.md`. It is still present in the working tree.

**Evidence:** Probe `K-STO-05`.

**Fix:** UI-003 as planned: make the location `SheetDescription` `sr-only`, keep it visible for reserved areas, and drop the eyebrow on mobile.

## KIRO-UI-06: Thai labels repeat an English label: `ชั้น / FLOOR`, `Quick Change · แก้ไขด่วน` (P3)

**Where:** The floor-map stamp (`FloorMap.tsx:734-740`), the floor table action (`StorageLayoutScreens.tsx:3173`) and the active-layout hint (`StorageZonesPanel.tsx:1195-1198`).

**Source:** `messages/th.json`:

- `:302` `canvasFloor` = "ชั้น / FLOOR {floor}"
- `:356` `quickChange` = "Quick Change · แก้ไขด่วน"
- `:503` `quickChangeActive` = "พร้อมใช้ Quick Change"

**Actual:** In Thai, the stamp renders "BLDG-A / ชั้น / FLOOR 02". It reads as three path segments and says "floor" twice in two languages. The table action says "Quick Change" and "แก้ไขด่วน" side by side. English is clean ("Floor 02", "Quick Change").

**Evidence:** Probes `K-STO-04` (rendered stamp) and `K-LOC-02` (catalogue).

**Fix:** In Thai use "ชั้น {floor}", "แก้ไขด่วน" and "พร้อมแก้ไขด่วน".

## KIRO-UI-07: The English UI shows Thai example chips and Thai-only date hints (P3)

**Where:** The global AI Search dialog (`SearchDialog.tsx:472-485,519-536`), in the English locale.

**Source:**

- `messages/en.json:2335-2338`: the `Search.example*` values are Thai.
- `:2364,2368,2369,2371`: the `Search.clarify.DATE/RANGE/DATE_UNSUPPORTED/DATE_AMBIGUOUS` hints give only Buddhist-era Thai dates, for example "8 ต.ค. 2569".
- The English placeholder directly above the chips is English: `:2295` "For example: forgot to clock out yesterday".
- The parser accepts English month names (`convex/model/search/dates.ts:75`), and the provider prompt lists "8 October 2026" (`convex/model/search/provider.ts:49`).

**Actual:** An English user sees the English placeholder, then the label "Examples", then Thai chips ("ลืมลงเวลาเมื่อวาน", "ตั้งวันหยุด", …). Date clarifications ask them to type a Thai date even though English dates are supported.

**Impact:** Users who cannot read Thai cannot use the examples or the date hints. The existing test `offers examples only while the AI query is empty…` (`GlobalSearch.test.tsx:312-320`) asserts a Thai chip in the English UI. If that is deliberate, it needs a product decision. As implemented, it conflicts with the English placeholder.

**Evidence:** Probe `K-LOC-01` (8 English keys contain Thai). The render locations are traced from source.

**Fix:** Write English chips ("Forgot to clock in yesterday", "Set a holiday", …) and English date examples ("yesterday" or "8 Oct 2026"), and keep the Thai values in `th.json`.

## KIRO-UI-08: 5 server refusal codes show "Check your input and connection" (P3)

**Where:** Finished-goods writes that use `useOperation` and `useWriteError` (`src/features/finishedGoods/shared.tsx:299-310`, `src/lib/resolveWriteError.ts:8-22`).

**Codes with no `WriteError.FG_*` entry:**

- `PRODUCT_ALREADY_ACTIVE` (`workflow.ts:282-283`)
- `PRODUCT_DRAFT` (`:381,:429`)
- `LOCATION_GEOMETRY_UNKNOWN` (`:1299-1300,:1847-1848`)
- `LOCATION_ONLY_ACTION_UNAVAILABLE` (`:1814-1815,:2346-2347`)
- `SCAN_GROUP_SIZE_INVALID` (`convex/finishedGoods/jobScans.ts:73-74,272-273`)

**Actual:** Each one shows `FG_UNKNOWN`: "The change could not be saved. Check your input and connection, then retry." Retrying cannot succeed, and the connection is not the problem.

**Reach:** The UI usually prevents these states. For example, `MoveScreen.tsx:124` and `StackScreen.tsx:166` block location-only units, and `JobScanScreen.tsx:103,229,320,438` cap the group at 50. So most of these appear only after a concurrent change, such as a location gaining unmeasured units between recommendation and reserve. That is why this is P3.

**Evidence:** Probe `K-FG-02` uses the real `resolveWriteError` and the real catalogue.

**Fix:** Add `WriteError.FG_<code>` entries in both locales with an action for each, for example "This location now has units without coordinates. Choose another location."

## KIRO-UI-09: The Profile card shows the employee code and site twice (P3)

**Where:** `/[locale]/hr/profile`, `HrProfileScreen` (`src/features/hr/ProfileScreen.tsx:70-100`).

**Actual:**

- The header description reads "EMP-001 · Head office".
- Directly below, the description list repeats "Employee code: EMP-001" and "Site: HQ · Head office".

**Impact:** The same two facts appear twice in one card, a few lines apart. The Today card (`TodayScreen.tsx:225-231`) needs this description because it has no description list.

**Evidence:** Probe `K-HR-03`. The rendered nodes are SPAN and DD for the code, and P and DD for the site.

**Fix:** On Profile, drop the `SectionHeader` description, or drop the code and site rows from the description list and keep the fuller "HQ · Head office" form.

## KIRO-UI-10: The Today page's Shortcuts section links back to Today (P3)

**Where:** `/[locale]/hr/today`. `HrShortcuts` is rendered only by `TodayScreen.tsx:407`.

**Source:**

- `src/features/hr/HrShortcuts.tsx:25` defines the `hr.today` card, which links to `ROUTES.hrToday`.
- The default preferences make it visible (`convex/hr/preferences.ts:13-26`).

**Actual:** The first card under "Shortcuts" on the Today page is "Today: Your attendance and next action." It links to the page the user is already on. The customize screen also offers it as a menu "on Today" (`Hr.shortcuts.summary`).

**Impact:** A wasted, confusing first card that leads nowhere and repeats the page name.

**Evidence:** Probe `K-HR-02`.

**Fix:** Exclude `hr.today` from the cards rendered on Today, and from the customization list if Today is the only host. The server key list can stay for compatibility.

---

## Reproduction

Run these from the repository root. The probes are deliberately outside the normal Vitest projects.

```sh
pnpm exec vitest run --config docs/reviews/system-audit-2026-10-14/kiro/vitest.config.mts --reporter=verbose
pnpm exec tsc -p docs/reviews/system-audit-2026-10-14/kiro/tsconfig.probes.json
pnpm exec eslint --max-warnings=0 docs/reviews/system-audit-2026-10-14/kiro/
pnpm exec prettier --check docs/reviews/system-audit-2026-10-14/kiro/
```

| Command                                             | Result                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Probe run                                           | 4 files, **14 failed / 14** (exit 1, as expected), about 3 s. See `evidence/probes-red.log` |
| `tsc` (probes)                                      | Pass                                                                                        |
| ESLint / Prettier (probes)                          | Pass                                                                                        |
| Related caller suites (`--project unit`, 7 targets) | 18 files, 312 tests passed. See `evidence/baseline-related-tests.log`                       |

| Probe file          | Cases                                                          |
| ------------------- | -------------------------------------------------------------- |
| `storage.probe.tsx` | K-STO-01, K-STO-01(th), K-STO-02, K-STO-03, K-STO-04, K-STO-05 |
| `hr.probe.tsx`      | K-HR-01, K-HR-02, K-HR-03                                      |
| `fg.probe.ts`       | K-FG-01, K-FG-01b, K-FG-02                                     |
| `locale.probe.ts`   | K-LOC-01, K-LOC-02                                             |

The `evidence/*.log` files exist locally but are ignored by the repository's `*.log` rule (`.gitignore:118`). Rerun the commands above to regenerate them.

How the probes work:

- They mount the real `BuildingModelWorkspace`, `HrShortcutCustomizeScreen`, `HrShortcuts` and `HrProfileScreen` through `renderWithIntl`, with the real messages.
- Only `convex/react`, `@/i18n/navigation`, `next/navigation`, workspace/HR access and `QueryGate` are mocked, following the existing caller tests.
- `fg.probe.ts` imports the real `recommendationReason` and `resolveWriteError`.

## Checked scope

- **Context:** AGENTS.md, PRODUCT.md, the back-navigation contract and inventory, `ui-cleanup-2026-10-13/kiro-review.md`, and the `daily-bug-search-2026-10-13` README and final ranking. There is no CONTEXT.md or ADR in the repository. I read the Next.js Vitest guide before writing the probes.
- **Catalogue checks:** en/th key parity (2,223 keys each, none missing), placeholder parity (no mismatches), Thai text in `en`, English text in `th`, and duplicate values within a namespace and within each file's rendered keys.
- **Source:**
  - Shell: `c-sidebar-2.tsx`, `SearchTriggers.tsx`, `SearchDialog.tsx` and `PageHeader`.
  - HR: Today, Shortcuts, Customize, Profile, Holidays, Requests, History headers and `HrShared` feedback.
  - Finished goods: catalogue and mobile list, product screen, batches, storage recommendation, move and the write-error resolver.
  - Storage: `FloorMap`, `StorageZonesPanel`, the location catalogue and the building page.
- **Contract checks:**
  - HR backend codes (`convex/hr`, `convex/model/hr`) against `Hr.errors`.
  - Finished-goods codes (`convex/finishedGoods`, `convex/model/finishedGoods`) against `WriteError` and `recommendationReason`.

## Rejected candidates

- **Same message value for the visible label and the accessible name:** `Hr.employees.edit` / `editLabel`, `StorageLayouts.edit` / `editReservedZone`, `remove` / `removeReservedZone`, `Hr.shortcuts.show` / `showLabel`. The visible text is "Edit" and the aria-label is "Edit {name}". This is the correct pattern, not visible repetition.
- **`catalogue.allLocations` = `catalogue.caption` ("จุดจัดเก็บทั้งหมด"):** the first labels an icon-only segmented control (`iconOnly`), and the second is a table caption. They are not repeated on screen.
- **`Hr.history.title` = `tableLabel`, and `Hr.periods.title` = `tableLabel`:** the table label is an `aria-label` on the scroller, not visible text.
- **Keys my scan reported as "missing"** (`WriteError.copy.*`, `Hr.day.*`, `Hr.history.legend`, `Hr.correction.reasonCount`): my file-level scan matched the wrong namespace. For example, `CorrectionForm.tsx:49` reads `reasonCount` from `Hr.form`, where it exists. Catalogue parity is intact.
- **Legacy `Navigation.*` ERP keys** (`dashboard`, `balances`, …): unused and never rendered.
- **`App.name` identical in th and en:** this is the brand name.
- **Unmapped HR codes `YEAR_INVALID` and `PAGE_SIZE_INVALID`:** the client cannot send these values. `HolidaysScreen.tsx:52-58` validates the year, and Requests sends `limit: 20`. `QUERY_INVALID`, `RATE_LIMITED` and `AI_UNAVAILABLE` are mapped under `Search.aiError`.
- **Earlier findings that appear fixed in this tree (source check only):**
  - DAILY-02: Back to Today now uses `returnFromTask` (`ShortcutCustomizeScreen.tsx:534`).
  - INV-09: the Job Scan client caps the group at 50 (`JobScanScreen.tsx:103,229,320,438`).
- **Sidebar brand icon and app name above the warehouse selector:** these are the planned UI-001 and UI-002 changes, not defects, so they are not reported here.
- **`FloorMap` built-in inspector (`FloorMap.tsx:422-597`):** this path is not used in `BuildingModelWorkspace`, which always passes `locationInspector`. It is excluded from KIRO-UI-03 to KIRO-UI-05.

## Limitations

- **Not checked live:** I launched no browser, server, Convex backend or automation, and claim no screenshot. Visual weight, spacing and wrapping are not measured. The parent handles live browser verification.
- **Rendering:** the storage probes use jsdom with the repository's `matchMedia` convention (wide layout by default, and a mocked ≤580 px query for the sheet). They prove the DOM text, not what a real viewport looks like.
- **KIRO-UI-07** does not establish whether showing Thai chips in the English UI was intended. It shows that the current copy conflicts with the English placeholder and with English date support.
- **KIRO-UI-08** reach is source-traced. I did not reproduce the concurrent paths against Convex.
- **Not covered:** physical camera and decoder behaviour, production data, and authenticated production paths.
- **Line numbers** refer to the working tree on 14 Oct 2026.
