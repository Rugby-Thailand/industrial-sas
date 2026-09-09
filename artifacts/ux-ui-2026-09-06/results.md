# UX/UI checklist — completed implementation and verification

Worktree: `/Users/macbook/Development/industrial-sas-storage-planner` (`codex/storage-planner`). Requested MVP implemented and tested first; UX work followed. Final checks: 7 September 2026, Bangkok. Development app stays on **port 3100**, with its existing local Convex database on **3320**.

## Changes and checklist results

| Checklist item | Change / finding | Evidence and limits |
| --- | --- | --- |
| Colour and contrast | Neutral occupied objects, distinct proposed highlight, amber reservation, text/error reasons as well as colour. Existing text/input/button tokens retained. | Rendered dark dialog muted text **5.25:1**, input boundary **5.32:1**, primary text **8.97:1**. Samples/results in JSON files. Static audit also checked light tokens. This is not an exhaustive contrast certification of every state. |
| Repeated steps | Placement editor is always interactive; removed Adjust position and Use this position mode transitions. | Adjusted placement → review → reserve now requires **2 action clicks instead of 4** after the coordinate edit. Destination review and physical identity/placement checks remain separate. |
| Primary action | One placement action leads to review, then Reserve. Invalid/unchanged/pending states prevent submission. | Browser valid/invalid checks, component tests. Existing stored units retain separate Move/Stack actions. |
| Icons | Important actions retain short text; mobile batch actions no longer hide their labels. Batch remove control enlarged from icon-sm to touch size. | BatchManager, a11y tests. Dialog primary/secondary/close targets measured **48 px** tall. |
| Back/cancel | Plain top-left back links retained and enlarged to at least 44 px high. Added back navigation to the new recommendation error state after independent review. Cancel reservation remains explicit and separate. | Live back navigation, Escape and reservation cancellation. Error-state regression assertion added. |
| Terminology | BOX preview/details now use box terminology; floor/rack help for BOX/OTHER; PALLET stacking opt-in only. | TH/EN browser checks; unit-format and retirement regression tests. Stored data names and counting-unit text are not translated. |
| 2D/3D | Continuous X/Y editing, computed Z, shared drag/keyboard/rotation support resolution; old geometry/stack lock rules retained. | Live P-000019 move: X3/Y0 → Z1.4 on P-000018, keyboard overhang blocks review, moving back restores valid review. Prior full stack/unstack evidence linked below. |
| Errors | Empty/nonfinite/negative coordinates cannot silently become zero. Packing review remains open during sending/failure and exposes retry of the same pending payload. Recommendation load errors separate from no-fit. | New coordinate/retry tests, wrong destination screenshot, concurrent reservation/stale data integration tests. |
| Density | Removed two editor mode buttons and repeated transitions. Existing search/filter toolbar stays without an enclosing background panel. | Desktop/mobile screenshots with multiple locations and long Thai data names. Long candidate rows scroll horizontally on narrow layouts; data tables have their own labelled scroll region. |
| Catalogue context | Search, status, product/unit tab and card/table layout persist per authenticated actor and warehouse. Corrupt/unavailable local storage falls back safely. | Agent tests + real mobile detail/back and browser refresh retained `BATCH-QA-0906`, Ready, Table view. Empty search result → Clear filters recovered. |
| Quantities and active units | Existing product/batch implementation preserved. No new automatic repacking on product defaults. | **4 → 2 = exactly two active units**, retired filtering, stack protection, replacement-limit reset and quantity preservation integration tests passed. QA product stayed 210 pieces in 3 boxes + 2 pallets; TEST001 not edited. |
| Mobile | Visible action labels, larger removal/back controls, responsive recommendation cards, bounded scrollable review dialog. | 390×844 portrait and 844×390 landscape: no horizontal document overflow; English/Thai review usable. Physical touchscreen and virtual keyboard remain unverified. |
| Keyboard/a11y | Programmatically opened dialogs remember the opener and restore focus on close. | User-event Escape and Back tests; live Escape returned to Review move / verification opener. Existing a11y suites passed. |
| Continuity | Packing save failure stays inside review with values retained; retry uses existing saved payload/idempotency key. Catalogue context survives remount. | Packing refresh/retry/send-twice tests, live reservation refresh and cancellation. No automatic physical confirmation. |

## Final test and build results

- `pnpm test --maxWorkers=2`: **573 passed / 62 files**, no unhandled errors — `tests-final.log`.
- `pnpm typecheck` and `pnpm lint`: passed — `quality-final.log`.
- `NEXT_DIST_DIR=.next-build pnpm build`: passed — `build-final.log`; the separate output directory preserves dev assets.
- `git diff --check`: passed — `diff-check.log`.
- Earlier MVP gate: 538 baseline → 64 focused tests; first combined UX run passed 552 tests. Additional move tests were added concurrently in the shared worktree. One later default-worker run exited with an unhandled worker error despite passing assertions (`check-worker-interruption.log`); a complete rerun with two workers passed all 573 tests. That interrupted run is not counted as passing.
- Independent read-only review found one missing back link in recommendation failure state; fixed and tested. No other actionable findings in the reviewed editor, retry, dialog or catalogue changes.

## Browser session and saved data

- **P-000021**, 50-piece QA box, 0.4 × 0.3 × 0.2 m: recommendation → alternative → edit → review → reserve **POS-000016** → refresh → wrong QR rejected → correct manual code accepted → cancellation released reservation. Ends awaiting placement, unchanged quantity and dimensions.
- **P-000019**, 50-piece QA pallet: inspected existing move editor and automatic stacking/overhang/keyboard behaviour. Left via Back to pallet without reserving a new move. Existing physical position **POS-000015** remains unchanged.
- Full creation/storage, stack locking/unlocking, wrong identities, return, cancellation, stale geometry and racing reservations pass automated integration tests. The preceding live stack/unstack run and evidence are recorded in [automatic stacking results](../automatic-stacking-2026-09-06/results.md); those physical-confirmation browser steps were not repeated in this UX turn.
- A long-running dev web process stalled while compiling the move route. Restarted the web process; the original combined dev runner also stopped its backend on child exit, so the local backend was restarted using the same database and ports. Warehouse context recovered and move route returned HTTP 200. Web and backend are running; logs are `dev-server.log` and `dev-backend.log`.

## Evidence index

1. `01-empty-coordinate-th.png` — validation without silent zero.
2. `02-exact-position-th.png` — always-on exact position, neutral old objects and fit reasons.
3. `03-wrong-destination-th.png` — wrong destination blocked.
4. `04-mobile-review-th.png`, `08-mobile-review-en.png` — bilingual mobile review.
5. `05-mobile-2d-th.png`, `06-mobile-3d-th.png`, `07-landscape-review-th.png` — responsive views.
6. `09-empty-catalogue-mobile-en.png`, `10-catalogue-desktop-en.png` — empty recovery and filtered table.
7. `11-review-desktop-en.png`, `12-recommendation-desktop-en.png` — final recommendation review/alternative.
8. `13-move-stack-en.png`, `14-move-overhang-en.png` — preserved stacking in simplified move UI.
9. `recommendation-flow.mp4` — **17.28-second real browser capture** of pack → recommended spot → alternative → 2D/3D → invalid input → reset → review. It does not show the entire physical putaway workflow. Raw frames/timestamps retained.

## Explicit remaining verification limits

No hardware touchscreen, software keyboard or camera scanner was available for physical-device QA. Responsive viewport checks do not replace them. Actual warehouse placement is outside software QA; manually verified QR payloads and test data were used. Contrast samples cover observed controls plus static token review, not every browser/OS/hover combination. The observed error-level console capture is session evidence, not a guarantee for all deployments. No weight/load rule or paid service was added.
