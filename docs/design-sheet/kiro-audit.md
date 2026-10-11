# Kiro audit: design-sheet system adoption plan

Date: 2026-10-11 (Asia/Bangkok). Auditor: Kiro CLI, `claude-opus-5.5`, high effort, independent of the implementer.

Audited: `docs/plans/design-sheet-system-adoption-2026-10-11.md` (99 lines; byte-identical to `plan-v1.md` in this folder), checked against:

- the original no-inner-rail sheet: `docs/design-sheet/index.html`, `sheet.js`, `styles.css`, `tokens.css`, `DESIGN.md` and `README.md`, committed in `8b0ef538`;
- application source at HEAD `733c6aca`.

Working tree at audit time: modified `.env.example`, `README.md`, `convex/hr/navigationIntent.ts`, `package.json`, `pnpm-lock.yaml` and shell/search tests (concurrent AI-search/runtime work). Untracked: root `PRODUCT.md`, HR self-service design/plan, Bun/AI documents, `src/app/api/ai/`, `src/lib/ai/`. No plan, sheet, application, test, `PRODUCT.md` or lockfile was changed by this audit. `.env*` contents were not read.

Local Next guidance read: `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md` and `.../01-next-config-js/cssChunking.md` (Next 16.3.8, Tailwind 4.3.3). The plan's guidance matches them: Tailwind or shared components for component styling, global CSS only for truly global styles, and production CSS order checked with `next build` because development ordering can differ.

## Verdict

**Approve the direction. Revise the plan and the sheet before either is used as an implementation reference.** There is no P0. The plan correctly recognises the work that has already landed (density variant, shared field and focus utilities, `Panel`, `StatusBadge`, scan/catalogue/floor/HR foundations) and the palette ownership.

Eight P1 problems remain:

- **The sheet contradicts shipped domain behavior on every workflow tab.** Examples: catalogue product rows carry storage-unit statuses; the scan specimen drops Remove, Unit type and Change; HR uses the wrong state labels and tones.
- **The sheet uses one failure model.** The application has two different write-outcome models.
- **The plan has no explicit decision on stronger status contrast,** although the request depends on it.
- **The plan's HR step overlaps the concurrent self-service plan,** which will restructure `TodayScreen`.
- **The historical variants share the sheet's JavaScript and CSS,** so any sheet revision changes them.

Each P1 has a small, source-backed fix below. Mandatory items are marked **M**. Optional improvements are marked **O**.

## Findings

### P1

**P1-1. The scan specimen removes or alters domain actions and fields that the app has.**

Evidence:

- **Source/removal row:** `TicketCard.tsx:191-213` always renders `#N · source`, the reading state and an icon button labelled `Remove #N`, including for a single ticket. The sheet omits it on the original page (`sheet.js:571`, `originalSheet ? ""`). `README.md:23` records "the single ticket no longer repeats its heading" as accepted copy. Plan line 31 says "Multiple tickets retain a stable ordinal/source/removal row", which permits hiding Remove and source for one ticket.
- **Unit type:** `TicketCard.tsx:243-256` puts a `Unit type` select (`Pallet` default, `Package / box`, `Other`) in the required group. The sheet has none.
- **Optional-detail count:** `TicketCard.tsx:259-265` shows the label `Optional details` and a `filledCount` badge ("# filled" / "กรอกแล้ว #"). The sheet shows a fixed `Optional details · 7` (`sheet.js:572`), which reads as a field count.
- **Per-field scanning:** each required identity has an inset scan action labelled `Scan {field}` (`TicketCard.tsx:124-130`). The sheet has none.
- **Location context:** the app shows the `Location set` / `Needs location` badge (`JobScanScreen.tsx:397`), a `Change` link with the accessible name `Change location` (`:403-414`), a building · floor line and the `locationNotStock` note (`:416-426`). The sheet shows only `Mapped` and a name (`sheet.js:568`).
- **Save model:** the app disables Save and shows the blocker as status text ("Every ticket needs a Job No. and a product barcode.", `:372-384`, `:575-586`). The Save button's accessible name is `Save N tickets`. A required field is marked invalid only after the person leaves it (`TicketCard.tsx:66-85`, `:116-121`). The sheet keeps Save enabled, validates on submit and moves focus (`sheet.js:776-791`).
- **Capture toolbar:** the app uses `Photos (AI)`, `Scan barcode` and `Type manually`, with `aria-pressed` toggles (`JobScanScreen.tsx:430-466`). The sheet uses `Add photo`.
- **Review advisory:** the app shows it only when a ticket was machine-read (`:383`, `:490-495`).
- **Saved outcome:** a confirmed save replaces the screen with `Saved N tickets at {location}`, the stock note, `Scan more` and `View records` (`:309-343`).

Consequence: an implementer who follows the sheet, or plan line 31, would remove the only Remove action and the source information for a single ticket, drop Unit type and Change, and swap the disabled-Save blocker model for submit-time validation. Plan Step 0 mentions only "unit type and optional-detail count meaning" (line 41).

**P1-2. The catalogue specimen mixes product records with storage-unit semantics.**

Evidence:

- **What the totals count:** "Products" counts products. "To measure", "To store" and "In storage" count storage units (`convex/lib/finishedGoodsSummary.ts:103-116`). "To store" includes `RESERVED`; "In storage" excludes moving units. The app labels the strip `Products / To measure / To store / In storage` (`FinishedGoodsCatalogue.tsx:226-253`). It adds the `About warehouse totals` explanation (`:254-259`) and a `Moving units` status line (`:261-265`).
- **Product status:** product status is `DRAFT`/`ACTIVE` ("Draft"/"Ready") (`shared.tsx:35-44`, `catalogueViewState.ts:17`). Product rows show name + SKU, `Total in storage units` with the product's own unit, a format breakdown, a status breakdown and the product status (`FinishedGoodsTable.tsx:131-153`).
- **What the sheet shows:**
  - The first total is labelled `Total` (`sheet.js:466`, `:578`).
  - Product rows carry storage-unit statuses (Stored / Awaiting storage / Awaiting measurement).
  - The totals 3/1/1/1 equal the three rows exactly.
  - The quantity reads `24 CARTON` (`sheet.js:167`, `:618`).
  - The filter is a single `All records / Stored only` toggle (`:579`, `:802-808`).
  - Empty results are a table row without a recovery action (`:621`).
- **What the app uses for filters, empty results and paging:**
  - Filters: a Filters control, filter chips and `Clear filters`.
  - Empty results: an `EmptyState` with `No matches`, "Try another code or name, or clear the filters." and a `Clear filters` button (`FinishedGoodsCatalogue.tsx:328-362`).
  - Paging: cursor paging with a page-size choice, Previous/Next, `Page N` with no page total, and `First page` only after history truncation (`CursorPagination.tsx:41-73`).
  - Phones: the table becomes `FinishedGoodsMobileList` (`FinishedGoodsTable.tsx:68-79`).

Consequence: the sheet teaches that warehouse totals are row tallies and that products have storage statuses, which is the opposite of the "no row count is a warehouse total" invariant in plan line 61. Plan Step 0 mentions "total scope/measurement units" but not the record-status mismatch, the reserved/moving semantics, filters, empty recovery or cursor-paging controls.

**P1-3. One "Save failed" specimen stands in for two different write-outcome models.**

Evidence:

- **HR (`useHrWrite.ts:11-22`, `:125-190`):** a write ends as SAVED, REFUSED, DENIED or UNCERTAIN.
  - The request ID is stored per `org:actor|intent` in session storage, and the command is pinned for an exact retry.
  - Inputs are locked while a write is pending or uncertain.
  - `WriteFeedback` (`HrShared.tsx:103-169`) says "We could not confirm whether this was saved", followed by "Try again safely".
- **Finished goods (`useAsyncOperation.ts:54-80`):** there is no uncertain state. Any thrown error becomes `FG_UNKNOWN`: "The change could not be saved. Check your input and connection, then retry." (`messages/en.json` `WriteError.FG_UNKNOWN`).
  - Job scan calls `useOperation()` without a scope (`JobScanScreen.tsx:82`). The request ID is therefore memory-only and keyed by the payload JSON (`:292`; `useRequestIdentity.ts:15-43`).
  - The server replays a repeated `requestId` (`convex/finishedGoods/workflow.ts:125-160`). An unchanged retry is safe; an edited retry gets a new ID.
- **The sheet:** its only failure specimen asserts "Changes weren't saved" (`index.html:478-492`; `sheet.js:475`).

Consequence: shown on HR, the sheet's copy is false for an uncertain clock. Shown on scan, it invents semantics the app lacks. Plan Step 0 asks for "failed/uncertain outcomes" (line 39) without saying which domain has which, and Step 2 says only "fail and retry a write" (line 55).

**P1-4. The attendance specimen contradicts shipped labels, tones and states, and the plan's HR step collides with the concurrent HR plan.**

Evidence from the sheet:

- **State badge:** the sheet always uses a success tone, with `In progress` / `Complete` (`sheet.js:453`, `:635`). The app uses `Clocked in` with the accent tone and `Clocked out` with success (`TodayScreen.tsx:321-328`, `Hr.today.state`). The sheet's Thai `ยังไม่ปิดรายการ` (`:500`) is not the app's `เข้างานแล้ว`.
- **Time labels:** the sheet uses `Start` / `End` (`:451-452`); the app uses `Clock-in` / `Clock-out`.
- **Unrecorded time:** the sheet shows `—`; the app shows `--:--` plus `Not recorded yet` (`TodayScreen.tsx:182-203`).
- **Thai date:** the sheet hard-codes `ศุกร์ 9 ตุลาคม 2026` (`sheet.js:377`). The app's `formatBusinessDate` with `th-TH` produces `วันศุกร์ที่ 9 ตุลาคม 2569` (verified with Node's Intl).
- **Missing app content:** the `View this day` link, the receipt `Clocked out at {time}` with `View time history` (`:330-369`), and the `My correction requests` panel (`:275-316`).

Evidence of the scope collision:

- The concurrent `hr-employee-self-service-improvement-2026-10-11.md` (lines 13, 43, 67) makes Today the employee home and adds shortcuts and holidays.
- Its design brief (`docs/designs/hr-employee-self-service-2026-10-11/brief.md:58`) names `globals.css`, `Panel` and `StatusBadge` as the authorities and says the sheet must not override them.
- Plan Step 5 still proposes "existing attendance refinements" in `TodayScreen`, `HrShared` and `HrUi` (lines 71-73).

Consequence: two plans would edit the same screen with different targets. The sheet would also leave HR with wrong state language.

**P1-5. Stronger status contrast is requested but neither implemented nor planned.**

Evidence:

- The sheet's badges use proposed `--sheet-status-*` inks (`styles.css:26-35`). `DESIGN.md:195` calls them "requested for stronger status contrast" and says they are not part of the snapshot.
- `StatusBadge` uses `text-success`, `text-warning` and similar tokens (`StatusBadge.tsx:18-26`).
- Computed contrast on the app's own badge surfaces, which are identical in the app and the sheet:

| Theme | App badge ink | Sheet badge ink |
| ----- | ------------- | --------------- |
| Light | 5.55–6.29:1   | 8.29–9.72:1     |
| Dark  | 5.90–6.42:1   | 7.96–8.14:1     |

- Plan line 5 lists "stronger status contrast" among the qualities to preserve. Step 1's acceptance says only "readable statuses" (line 49). Line 49 also forbids copying "production token[s] from the old sheet snapshot", which an implementer could read as forbidding these inks.
- `FloorMap.module.css:4-29` hard-codes a private palette (`#1d4ed8`, `#166534`, …) that does not follow token changes.

Consequence: one of the requested qualities has no slice, acceptance criterion or owner. Changing `StatusBadge` would also affect HR screens owned by concurrent work.

**P1-6. The sheet presents an old palette as the existing one.**

Evidence:

- The Foundations subtitle reads "Existing palette. A quieter application." (`index.html:228`; `sheet.js:58`).
- The displayed values are hard-coded snapshot strings (`sheet.js:667-685`).
- The app's light values differ (`globals.css:149-224`):

| Token            | App (light) | Sheet snapshot                  |
| ---------------- | ----------- | ------------------------------- |
| Primary          | `#1d4ed8`   | `oklch(0.4901 0.2875 264.3293)` |
| Ring             | `#1d4ed8`   | `oklch(0.46 0.22 266)`          |
| Selected surface | `#eff6ff`   | —                               |
| Success          | `#166534`   | `#0f6b3f`                       |
| Warning          | `#92400e`   | `#8a5300`                       |
| Danger           | `#b91c1c`   | `#b3261e`                       |
| Hover            | `#1e40af`   | `#1024c4`                       |
| Muted text       | `#475569`   | —                               |
| Foreground       | `#17212f`   | —                               |

- `DESIGN.md:197` lists five of these drifts. It does not list the semantic or hover drift.

Consequence: a reference that labels outdated values as current invites the palette rollback that plan line 23 forbids.

**P1-7. Sheet edits would silently change the "historical" variants, and the evidence would become stale.**

Evidence:

- `variants/index.html:12-16` loads `../tokens.css`, `../styles.css` and `../sheet.js`.
- `variants/README.md` says `variants.js` wraps `renderWorkflow` and moves the rendered nodes by class.
- Copy is branched only by `originalSheet` (`sheet.js:429`).
- The evidence files (`evidence/browser-checks.json`, `copy-checks.json` and the screenshots) describe the current markup.

Consequence: plan line 41, "keep the original comparison variants as historical explorations", cannot hold once render functions or class names change. The 144/64 check counts in the sheet's README would describe a different artifact.

**P1-8. The sheet's density rule is width-only.**

The plan notes this as needing parity (line 15) but does not make it a Step 0 requirement.

Evidence:

- The app uses `dense = (width >= 48rem) and (pointer: fine)` (`globals.css:16`), with `min-h-touch` and `dense:min-h-control` on every control (`buttonVariants.ts:28-42`, `input.tsx:10-17`).
- The sheet switches size at `max-width: 800px` (`styles.css:1172-1189`). It states "48px at touch widths (800px and below)" (`DESIGN.md:261`, `:279`, `:295`; `README.md:17`; `sheet.js:76`, `:212-213`).

Consequence: on a coarse-pointer tablet at 801–1280px, the sheet shows 36px controls and 14px input text where the app shows 48px controls and 16px text. Reviewers would approve a density the app does not ship.

### P2

**P2-1. The floor specimen is internally inconsistent and mis-describes narrow layouts.**

- The inspector always says `0 pallets` (`sheet.js:631`). The only pallets drawn are in `FG1-R01`, which cannot be selected (`:630`). `floorContentsValue` ("2 sample pallets", `:179`, `:367`) is unused.
- Both selectable zones report `4.0 × 2.0 m`.
- The `12 × 20 m` floor (`:175`) is drawn in a landscape 300×240 view box.
- The caption says the inspector sits "below the map on phones" (`:187-188`). In the app:
  - Details open in a sheet when the workspace is under 851px, or under 1400px in split view (`useFloorWorkspaceView.ts:51-74`; `FloorMap.tsx:211-229`, `:279-287`).
  - Split view is available only from 1100px.
  - On desktop, selecting the selected location again clears the selection and fits the view (`FloorMap.tsx:303-312`).
  - Keyboard focus on a location is a dashed 3px stroke (`FloorMap.module.css:245-249`); the sheet has no equivalent.

**P2-2. Two of the plan's test targets are misnamed (line 80).** The files are `src/features/finishedGoods/useCatalogueState.test.tsx` and `src/components/storageLayouts/useFloorWorkspaceView.test.tsx`, not `.ts`. Useful existing targets are also missing:

- `src/components/ui/theme-contrast.test.ts` (it already checks badge, notice, edge and focus contrast);
- `sharedControls.test.tsx`, `StatusBadge.test.tsx`, `FormField.test.tsx`, `SelectControl.test.tsx`;
- `DataGate.test.tsx`, `CollectionToolbar.test.tsx`, `FinishedGoodsMobileList.test.tsx`;
- `FloorMap.workspace.test.tsx`, `FloorMap.labels.test.tsx`;
- `HrScreens.test.tsx`, `HrSimplification.test.tsx`.

**P2-3. Two HR invariants are stated inaccurately (line 71 and line 75).**

- **Guard:** only a pending clock is guarded (`TodayScreen.tsx:89-91`, `draftGuard.ts:56-58`). An uncertain write is not guarded; its request ID survives in session storage instead.
- **Receipt and intent keys:** these are `organizationId:actorUserId` (`HrAccessProvider.tsx:70`) plus the linked employee ID (`TodayScreen.tsx:78-96`). The site is not part of either key.

Rewrite the acceptance as: "account, organization or employee-link changes never reuse an intent or receipt."

**P2-4. Plan Step 5 is missing HR states.** It omits:

- the `HrGate` states: loading, unavailable, denied, and the gate-level timezone notice (`HrShared.tsx:22-85`);
- `UNRESOLVED_OPEN` with a pending correction, which hides the correction button (`TodayScreen.tsx:380-416`);
- the REFUSED and DENIED write outcomes.

**P2-5. Plan Step 3 omits catalogue gaps and paths that already exist in source.**

- **Unimplemented proposal:** quantity alignment. Neither the table nor the cards right-align or use tabular numerals for quantities (`FinishedGoodsTable.tsx:145-147`). This is the one catalogue presentation gap from the sheet's README proposal.
- **Existing paths to verify:** summary preparation (`SummaryPreparation`); summary `reset` with its one automatic restart (`FinishedGoodsCatalogue.tsx:121-137`); the header scan-packages icon action; the cards/table layout control (≥lg); the mobile list.

**P2-6. The release wording is too loose for this repository (line 84).** A merge to `main` releases production automatically (root `README.md`, "Automatic production release"). Each slice merge is therefore a production release and should need an explicit user go-ahead. Plan line 7 is consistent with this but does not say it.

**P2-7. The invalid-field halo conflicts with the restrained edge.** `input.tsx:15` and `select.tsx:34` add `ring-3 ring-destructive/20` (the select trigger lacks the dark variant). The sheet uses a clean danger border (`styles.css:509-511`). The cascade between `aria-invalid:` and the `focus-field` utility in compiled CSS was not verified.

**P2-8. The sheet's terminology diverges from the message catalogue.** The two sets of terms below conflict; the sheet should either adopt the app's terms or mark its own as proposals.

| Field / element      | App (EN)   | Sheet (EN)           | App (TH)            | Sheet (TH)       |
| -------------------- | ---------- | -------------------- | ------------------- | ---------------- |
| Job number           | `Job No.`  | `Job number`         |                     |                  |
| Part name            |            |                      | `ชื่อสินค้า`        | `ชื่อชิ้นงาน`    |
| Customer             |            |                      | `ชื่อลูกค้า`        | `ลูกค้า`         |
| Delivery date        |            |                      | `วันที่ส่งสินค้า`   | `วันส่งสินค้า`   |
| Manufacturing date   | `MFG date` | `Manufacturing date` | `วันที่ผลิต`        | `วันผลิต`        |
| Location (floor map) |            |                      | `จุดจัดเก็บ`        | `ตำแหน่งจัดเก็บ` |
| Awaiting placement   |            |                      | `รอเลือกจุดจัดเก็บ` | `รอจัดเก็บ`      |
| Clock-out action     |            |                      | `ลงเวลาออกงาน`      | `ลงเวลาออก`      |

**P2-9. The static HTML fallback copy is stale.** The no-JS text says "24–32px between tasks" (`index.html:121`) and "48px touch targets · visible keyboard focus" (`:320`). It also says "16px content padding… 32px major groups" (`:515`). The JS copy says "8/16/24/40" and "36px desktop · 48px touch".

**P2-10. Some small documentation figures do not match source.**

- The sheet pads content by 20px; `Panel` uses `p-section` (16px, `Panel.tsx:16-20`). The app value governs.
- The `Panel` comment says "12px radius", but `rounded-xl` resolves to `0.5rem × 1.4` = 11.2px.
- The plan's component list (line 32) omits shared pieces the screens actually use: `SegmentedControl`, `SearchField`, `IconButton`, `CollapsibleSection`, `StatusReason`, `OutcomeGate`, `FilterChips`, `TableScroller`, `HrTimeCell`.

**P2-11. Tool context could pull in the wrong product scope.** The installed Impeccable skill loads root `PRODUCT.md` and `DESIGN.md` (`.agents/skills/impeccable/SKILL.md:17`). Root `PRODUCT.md` is currently scoped to HR self-service. Any Impeccable-assisted sheet revision should:

- pass the sheet's own `docs/design-sheet/DESIGN.md` as context;
- not run `init` or `document` at the root.

**P2-12. The plan cites a server URL as the approved artifact (line 5).** `http://localhost:3211/` is a local server, not an artifact. Cite `docs/design-sheet/index.html` at `8b0ef538` instead.

## Baseline claims checked

| Plan claim                                                                                           | Result                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rhythm tokens 2/8/16/24px and the `dense` variant (≥768px, fine pointer); 48/36px controls (line 15) | Correct (`globals.css:16`, `:56-67`; `buttonVariants.ts:28-42`; `input.tsx:10-17`)                                                                                          |
| Shared field presentation and `focus-field` (line 16)                                                | Correct (`input.tsx`, `select.tsx:32`, `FormField.tsx`, `ScanCodeInput.tsx`). Omits the invalid halo (P2-7)                                                                 |
| `Panel` has surface/plain/divided; `StatusBadge` has icon + text (line 17)                           | Correct. Omits the badge-ink gap (P1-5)                                                                                                                                     |
| Job scan foundations (line 18)                                                                       | Correct. Omits view-only replacing the whole flow (`JobScanScreen.tsx:307`), the disabled-Save blocker model, the saved-outcome screen, and FG retry semantics (P1-1, P1-3) |
| Catalogue foundations (line 19)                                                                      | Correct. Omits unit-count semantics, reserved/moving, preparation/reset and the alignment gap (P1-2, P2-5)                                                                  |
| Floor ownership (line 20)                                                                            | Correct. `LocationDetailsHost.tsx` is only an 11-line context; inline vs sheet details are decided in `FloorMap.tsx` with `useFloorWorkspaceView`                           |
| HR foundations, pinned uncertain commands (line 21)                                                  | Correct. The guard/receipt wording at lines 71 and 75 is inaccurate (P2-3)                                                                                                  |
| Light primary `#1d4ed8`; the sheet records an older palette (line 23)                                | Correct. The drift is wider than the primary (P1-6)                                                                                                                         |
| Type scale 24/32, 18/28, 14/20 (line 29)                                                             | Correct (`PageHeader.tsx:52`, `SectionHeader.tsx:38`, `DescriptionList` stat)                                                                                               |
| Forms capped at 48rem, details at 80rem (sheet)                                                      | Correct (`PageContainer.tsx:5-7`: `max-w-3xl` / `max-w-7xl`)                                                                                                                |
| Test file names (line 80)                                                                            | Two are wrong (P2-2)                                                                                                                                                        |
| "Pending and uncertain writes retain their current guard"; "account or site changes" (lines 71, 75)  | Inaccurate (P2-3)                                                                                                                                                           |

## Conflicts with implemented behavior or concurrent work

- **Removal and source information:** plan line 31 plus the sheet would remove single-ticket removal and source information that the app has (P1-1).
- **Save validation:** the sheet's submit-time validation conflicts with the app's disabled Save and blocker messages (P1-1).
- **Catalogue statuses and totals:** the sheet puts storage statuses on product rows and makes totals equal the row count (P1-2).
- **Attendance:** the sheet's labels and tones contradict `Hr.today.state` and `STATE_TONES`. The plan's Step 5 edits overlap the HR self-service plan, whose brief also binds `Panel` and `StatusBadge` (P1-4, P1-5).
- **Shared tokens:** any `StatusBadge` ink token change is shared foundation work visible to the HR preview and HR screens. Coordinate it; do not land it inside an HR file.
- **Concurrent AI-search work:** it currently modifies shell/search tests and `useAiSearch.ts`. The adoption plan does not need shell files; keep it out of `src/components/shell/**` and `src/components/examples/c-sidebar-2*`.
- **Root `PRODUCT.md`:** untouched and HR-scoped. Neither this plan nor the sheet should read it as the product's design authority (P2-11).

## Plan revisions

Mandatory:

1. **Line 5:** cite `docs/design-sheet/index.html` at `8b0ef538` as the approved artifact. Keep the local URL only as a viewing instruction.
2. **Baseline table:**
   - Add the invalid halo, the badge-ink gap, the FG vs HR write models, the view-only full-screen replacement on scan, the disabled-Save blocker and saved screen, and the catalogue unit-count semantics (reserved in "To store", moving excluded).
   - Add the floor compact-sheet thresholds (851/1100/1400px workspace width).
   - Add the floor map's private palette.
3. **Line 31:** replace "Multiple tickets retain…" with "Every ticket keeps its ordinal, source and Remove action; shorten only its visual weight."
4. **Step 0 (line 41):** expand the correction list to the mandatory sheet revisions below (S1–S9). State that sheet edits must freeze the variants first (S10).
5. **Step 1:** add an explicit status-ink decision.
   - Adopt the proposed inks as new light/dark status-ink tokens used by `StatusBadge`, or record that existing inks (≥5.5:1) are accepted.
   - Clarify that these inks are not part of the forbidden snapshot.
   - Coordinate with the HR self-service owner before merging.
   - Decide the invalid halo, and test the invalid and focus-visible combination.
   - Note that `FloorMap.module.css` must be updated alongside any token it duplicates.
6. **Step 2 acceptance:** split "fail and retry" into these checks.
   - A refused save keeps drafts and shows the coded message.
   - A lost response followed by an unchanged retry replays the same `requestId`.
   - View-only users see only `ViewOnlyNotice`.
   - Save stays disabled with the correct blocker for reading, missing required values, invalid quantity and unreviewed duplicates.
   - The saved screen shows the location and the stock note.

   Record the existing FG gap (an edit after an unknown failure gets a new ID; there is no uncertain UI) as an open fact. It is behavior, not presentation, and stays out of this plan.

7. **Step 3:** add the quantity alignment gap. Add verification of preparation, the `reset` restart, `Moving units`, the scan-packages action, the layout control and the mobile list. Say that page indicators never show a total page count.
8. **Step 5:** make it verification-only for this plan. No edits to `TodayScreen.tsx`, `HrShared.tsx`, `HrUi.tsx` or `useHrWrite.ts` while the HR self-service plan is active; the sheet's corrected attendance specimen is handed to that plan as input. Add the missing states (P2-4) and fix the invariants (P2-3).
9. **Validation item 2:** fix the file names and add the tests listed in P2-2.
10. **Validation item 3:** name the fixtures `pnpm dev:seed --storage-ui` (UI-B-DEMO, UI-B-REFERENCE, archived and no-floor buildings), `--pagination` (121 products, `NEEDLE`) and `--hr` (`scripts/seed-local-test.mjs:30-32`).
11. **Validation item 6:** "Merging to `main` releases production automatically; each slice merge requires explicit user approval."

Optional:

- Add a short "sheet ↔ source" status column (Present / Gap / Verify only) to `docs/design-sheet/README.md`'s source map. Link to it from the plan instead of duplicating it in the plan.

## Design-sheet revisions

Keep the original layout, close labels, 36/48px controls, divided task surface, unboxed totals, strong status inks and short bilingual copy. Every change below is a content or semantics correction inside the existing structure. No new framing is needed.

| #   | File(s)                                                                      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Kind       |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| S1  | `styles.css`, `sheet.js:76`, `:212`, `DESIGN.md:261/279/295`, `README.md:17` | Keep the 800px and 520px layout breakpoints. Move control density to the app rule: `@media (width < 48rem), not all and (pointer: fine) { :root { --sheet-control-size: 48px } … }` (padding, 16/24 input text). Copy: "36px with a fine pointer from 768px · otherwise 48px".                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | M          |
| S2  | `tokens.css`, `sheet.js:667-685`, `index.html:228`, `DESIGN.md`              | Render the current `globals.css` light/dark values; keep the 2026-10-09 snapshot as a dated history note in `DESIGN.md`. Read the displayed values with `getComputedStyle` instead of hard-coded strings. Fallback if palette changes need a separate decision: retitle the strip "2026-10-09 snapshot — the app uses `#1d4ed8`".                                                                                                                                                                                                                                                                                                                                                                                                                  | M (either) |
| S3  | `index.html` foundations status row                                          | Label the badge inks "Proposed status ink (not yet in app)" and show the app ink pairing once. Add the `accent` tone specimen that the app uses for "Clocked in".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | M          |
| S4  | `sheet.js renderScan`, `field()`                                             | Restore a quiet `#1 · AI` row with a ghost Remove icon button (`aria-label="Remove #1"`). Add a `Unit type` select (Pallet default) to the required group. Use `Optional details` with a `7 filled` badge. Add inset scan actions (`Scan Job No.`, `Scan Product barcode`). In the location strip, use `Location set`, a `Change` link (`aria-label="Change location"`), a building · floor line and the stock note. Use app toolbar labels with `aria-pressed`. Make Save disabled with blocker text, accessible name `Save 1 ticket`, no arrow; mark a required field invalid only after blur.                                                                                                                                                   | M          |
| S5  | `sheet.js renderCatalogue`, `updateProducts`                                 | Label the strip `Products / To measure / To store / In storage` with values that differ from the visible rows (e.g. 128 / 6 / 14 / 342), plus a one-line "Totals cover the warehouse, not this page or filter; To store includes reserved units". Add a `Products / Storage units` segmented control. Product rows: name + SKU, Ready/Draft badge, `Total in storage units`, a breakdown line. Storage-unit rows carry the storage statuses. Replace the toggle with `Filters` plus one removable chip. For empty results, use an EmptyState with `Clear filters`. Footer: "Showing 3 records", per-page 20, Previous (disabled) · Page 1 · Next, no page total. Add a totals state switch: `…` while loading; `Unavailable` plus the load notice. | M          |
| S6  | `sheet.js renderFloor`, `styles.css`                                         | Make `FG1-R01` selectable. Make inspector values follow the selection (L01/L02: 0 pallets; R01: 2 pallets) with distinct dimensions. Make the floor dimensions match the view box (e.g. 15 × 12 m). Add the dashed focus stroke. Caption: "Details sit beside the map on wide workspaces and open in a sheet on narrow ones."                                                                                                                                                                                                                                                                                                                                                                                                                      | M          |
| S7  | `sheet.js renderHr`, `refinedCopy`                                           | Use `Clock-in/Clock-out`, `Clocked in` (accent) and `Clocked out` (success). Unrecorded time: `--:--` with `Not recorded yet`. Make the title the business date and the summary `Name · code`. Thai date `วันศุกร์ที่ 9 ตุลาคม 2569`. Use a leading clock icon; Thai `ลงเวลาออกงาน`. After the sample clock, show a receipt line `Clocked out at 17:31` with `View time history`. Add a `View this day` link and a divided `My correction requests` section ("No correction requests yet", `View all`).                                                                                                                                                                                                                                            | M          |
| S8  | `index.html` states, `sheet.js` copy                                         | Replace the single failure example with three quiet examples: **Not saved** (refused: "Nothing was saved. Your entry is kept…"), **Not confirmed** (HR uncertain: "We could not confirm whether this was saved" plus `Try again safely`; captioned "HR attendance"), and **View only** (notice; no Add/Save). Make the empty example match the app: "No tickets yet. Take a photo of a job ticket or scan its barcode."                                                                                                                                                                                                                                                                                                                            | M          |
| S9  | `sheet.js` copy, `index.html` fallbacks                                      | Align terms with `messages/*.json` (P2-8). Sync the static fallback text (P2-9).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | M          |
| S10 | `variants/`                                                                  | Before editing, copy today's `sheet.js` and `styles.css` into `variants/` as frozen files and repoint `variants/index.html`. Bump the `?v=` cache strings in `index.html`. Mark `evidence/*.json` as describing `8b0ef538`, or regenerate them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | M          |
| S11 | `README.md`                                                                  | Add the source-map status column (see the optional plan revision).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | O          |
| S12 | `sheet.js`                                                                   | Saved-scan confirmation specimen; a minimal floor toolbar row (floor, "3 locations", search, Map/Table/Split); the catalogue mobile list at ≤520px.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | O          |

## Acceptance and validation gates

The sheet (Step 0) is accepted when every item below holds:

- **Composition:** the original layout is recognisable against `evidence/desktop-en-light.png` and `mobile-th-dark.png`. There is no Side Rail, and no new nested frames are added.
- **Consistency checks:** a DOM script asserts each of the following, in both languages:
  - inspector contents match the drawn pallets;
  - catalogue totals differ from the row count;
  - product rows never carry a storage status;
  - HR badge tones equal the app's `STATE_TONES`;
  - the scan specimen has a Remove button, a Unit type select and "N filled";
  - Save is disabled whenever a required value is empty.
- **Viewports and modes:** 390, 768, 1024 and 1280px, plus 1440 at 200% zoom; light and dark; Thai and English.
- **Density:** 36px controls appear only at ≥768px with a fine pointer; 48px controls and 16px inputs appear with coarse-pointer emulation at 1024px.
- **Keyboard:** tabs (arrows, Home, End); map Enter and Space; disclosure; filter chip removal; the Remove button.
- **Automated checks:** no axe A/AA violations in the tested rules, and `pnpm format:check`. `docs/design-sheet` is not prettier-ignored.
- **Variants:** `variants/?variant=side-rail` and `margin-labels` render identically to `variants/evidence/*` after S10.

Each application slice (Steps 1–4) is accepted when:

- the named focused tests and `theme-contrast.test.ts` pass;
- `pnpm check` and `pnpm build` pass, with the production CSS order checked in the build output;
- the seeded browser checks in revised validation item 3 pass;
- before/after screenshots are recorded by route and state;
- no merge happens without user approval (merging auto-deploys);
- unrelated baseline failures caused by concurrent work are reported separately.

## Suggested rollout

1. **Sheet freeze and corrections:** S10, then S1–S9. Re-run the sheet checks. Apply the plan revisions in the same documentation change.
2. **Shared foundations:** one PR for the status-ink and invalid-halo decision, including `FloorMap.module.css` parity and contrast tests. Coordinate with the HR self-service owner before merging.
3. **Catalogue:** quantity alignment and verification of the paths in P2-5.
4. **Job scan:** verification. Change copy or presentation only if the corrected sheet still shows a gap. Most items are already present in the app.
5. **Floor:** verification on UI-B-REFERENCE and UI-B-DEMO. Change chrome only for a proven gap.
6. **HR:** verification only. Hand the corrected attendance specimen to the HR self-service plan.

## Not verified

- I did not run the sheet or the application in a browser, and ran no tests, build, axe or contrast tooling beyond the hex contrast calculation above.
- I did not inspect compiled Tailwind output, including the `aria-invalid:` vs `focus-field` precedence.
- I did not read `LocationPicker`, `PhotoCapture`, `BarcodeCameraBox`, the 3D scene, `FloorMapDrawing` beyond its selection strokes, or all of `styles.css`.
- I did not review the HR self-service preview HTML in depth.
- I did not check the sheet's evidence JSON for validity or freshness.
- The Thai Buddhist-era output was verified with local Node ICU only.
- I made no claim about deployed or production state, and none can be inferred from the repository.

## Summary

The plan is sound in direction and honest about the foundations that already landed. It is not yet a safe implementation reference.

- **Sheet:** it contradicts shipped behavior on scan (Remove, Unit type, Change, Save model), catalogue (record statuses vs unit totals, filters, cursor paging) and HR (state labels, tones, Thai date, missing receipt and requests). It uses one failure model for two, and it presents an old palette as current. Its density rule ignores pointer type.
- **Plan:** it lacks an owner for stronger status contrast, overlaps the HR self-service plan on Today, and would change the variants it calls historical.

Apply the mandatory plan revisions and sheet changes S1–S10, then follow the six-step rollout.

Report: `docs/reviews/design-sheet-system-adoption-2026-10-11/kiro-audit.md`
