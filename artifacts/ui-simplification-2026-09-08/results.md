# Storage planner simplification — results

8 September 2026 · `codex/storage-planner` · `/Users/macbook/Development/industrial-sas-storage-planner`

## Delivered

- Direct reservation from the visible placement summary: **2 button activations → 1** after a valid position is ready. Source/target and optional move reason remain visible before a move reservation.
- Inline destination verification removes the scanner-dialog entry action. Camera start remains explicit; verification never confirms physical placement automatically.
- Exact-unit correction beside dimensions returns automatically to the same destination, X/Y, rotation and camera view when the original unit remains active. Replacement units require an explicit new selection; retired identifiers never inherit old reservations.
- Preview state survives refresh in this browser session. Invalid coordinates remain visible for correction. Unavailable or removed destinations are not silently replaced.
- Unit cards/table expose Measure, Choose storage, Continue placement/move, or View details as applicable. Stored-unit movement still goes through authoritative lock checks on the details page.
- Shared destination picker, packing row conversion/validation presentation and dimension controls. Create/repack commands and server rules remain separate.
- Product cards/table calculate each product's unit summary once instead of three times per render.

## Verification

- Baseline: **634 tests / 63 files passed**.
- Final: **671 tests / 65 files passed**, plus TypeScript and ESLint (`pnpm check`). See `check.log`.
- Final production build passed using `NEXT_DIST_DIR=.cache/simplification-final pnpm build`. See `build.log`.
- Authenticated production build inspected on temporary port3104. Development app remains on **3100**.
- Live desktop1728 and mobile390 viewport checks in Thai and English. Sampled page width equalled viewport width: no horizontal overflow on recommendation and catalogue pages.
- No application console errors observed in the captured console log. Clerk development-key warnings and Fast Refresh reload warnings occurred in this local development environment.

### Live action coverage

| Flow | Result | Actions |
| --- | --- | --- |
| Create FG / pack | 100 pieces, two50-piece units; blank and sub-mm input rejected; copied dimensions still need acknowledgement | 1–11 |
| Choose / correct / refresh | Selected location, invalid X and 2D view survive refresh; invalid fit blocks reservation | 12–16, 46–48 |
| Reserve / verify / store | One-click reservation; wrong code rejected; correct code still needs explicit physical confirmation | 17–20 |
| Stack | Auto Z0.5, total height1m, both pallet identities verified; base remains locked | 21–27 |
| Move upper away | Source/target held; pickup and placement verified; final move releases lower-pallet lock | 28–38 |
| Repack4→2 | New batch100 pieces changes four25-piece units to exactly two50-piece active replacements | 39–45 |
| Mobile / English / cancellation | Inline error, clean cancellation, space released, empty search recovery | 49–54 |
| Unit actions / production | Direct card action and matching table action; production catalogue/editor rendered | 55–59 |

Cancellation and return dialogs during a move were opened and inspected without committing those alternate operations. Actual return, concurrent reservations, stale revisions, idempotency/retry, permission failures, collision/height/stack restrictions and retired-unit exclusion are covered by the passing automated suite. Physical camera, hardware scanner and touch-device tests were not performed; manual code entry and viewport emulation were used.

### Bugs found and fixed in this pass

1. Recommendation reorder could change the implicitly selected location after correction: pin destination when editing/entering correction; regression test added.
2. A removed destination could silently fall back to another candidate: retain explicit selection and require choosing a valid replacement; regression tests added for storage/move.
3. Wrong-QR error leaked into reservation cancellation dialog: clear unrelated error on opening cancellation; regression assertion and live retest passed.

## Quantities and QA records

Product `SIMPLIFY-QA-0908` remains for inspection. Two separate100-piece batches total200 pieces:

- Original batch: P-000030 and P-000031, 50 each, both stored. P31 was stacked on P30 then moved to floor; quantity did not change.
- `REPACK-4-TO-2`: original four units retired; P-000036 and P-000037 are the only two active replacements, 50 each, awaiting placement. Temporary screenshot reservations were cancelled.
- Final product catalogue: **4 active units / 200 pieces**, because it contains those two independent batches. The repacked batch alone is **2 / 100**.

## Code and performance accounting

Production `.ts/.tsx` files directly under `src/features/finishedGoods`, excluding test files:

- Before10,669 lines; after10,767 lines; **net +98**. See `source-lines-final.json`.
- Shared packing scope:2,243→2,242 including new shared files. Duplication removed; new recovery/action behaviour accounts for overall growth.
- Shared destination and next-action decisions reduce duplicated implementations. No generic workflow framework, availability cache or new dependency was added.
- Runtime latency, drag frame rate and repeated task duration were **not benchmarked**. The verified speed claim is fewer required activations and reduced repeated summary computation, not a percentage latency improvement.

## Evidence and reproduction

Open `index.html`: all59 action screenshots are embedded and immediately visible. Seven MP4 chapters use actual captured frames, held2.5seconds per action; idle time is shortened. These are **action-based screenshot walkthroughs, not continuous screen recordings**. Original capture timestamps and labels remain in `actions.json`.

`build-evidence.py` regenerates HTML and chapter manifests. `scripts/encode-browser-recording.swift` encodes the manifests. Full manual and recommendation highlight were refreshed using `docs/manuals/storage-planner/refresh-simplified-flow.py`; run this after the older base-manifest builders. Current images are embedded so sharing HTML does not lose them.

Unrelated pre-existing worktree changes were preserved. No merge, commit, push, deployment, paid service, or weight/load-rule implementation was performed.

Local HTML browser inspection was blocked by browser URL policy. Static validation confirmed all59 report images,71 full-manual images and5 highlight images are embedded and decode; all seven video files exist and encoded successfully. No alternate browser/server workaround was attempted.
