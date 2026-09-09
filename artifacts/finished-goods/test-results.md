# Finished-goods verification

Date: 6 September 2026, Asia/Bangkok. Worktree: `codex/storage-planner`.

## Automated verification

Final `pnpm check` passed: TypeScript, ESLint with zero warnings, **345 tests across 46 files**. Final `NEXT_DIST_DIR=.next-build pnpm build` passed after the development-watcher change. Both commands exited 0. Logs: [check-final.log](check-final.log), [build-final.log](build-final.log).

## Live browser verification

| Case | Result |
| --- | --- |
| Create product → physical pallet → measure → recommend → adjust → reserve → verify destination → confirm stored | Passed twice, including final FG-1 walkthrough |
| Product required fields and negative quantity | Browser validation blocks progression |
| Measurement zero height | Storage action disabled |
| Measurement too tall for every location | No-fit page shows height-specific explanation and working edit action |
| Measurement m/cm conversion | 1.2 / 1 / 1.4 m becomes 120 / 100 / 140 cm |
| Position outside location | Invalid state; cannot accept position |
| Position overlapping stored pallet | Collision explanation; cannot accept position |
| Object rotation versus camera rotation | Exact X/Y unchanged by camera; pallet orientation saved separately |
| Wrong destination code | Refused; stored confirmation remains disabled |
| Correct location code | Verified; separate physical-storage confirmation becomes available |
| Refresh after reservation | Reservation and exact coordinates retained |
| Product and measurement draft refresh | Entered values restored |
| Refresh after stored | Three consecutive final refreshes retain stored record and POS-000003 |
| Cancel reservation / keep reservation | Both confirmation choices work; releasing returns to placement recommendations |
| Planner occupancy | Stored pallet visible in floor model and location card, with exact coordinates and detail link |
| Occupied geometry edits | Review blocks confirmation before submission; server guard also tested |
| Different warehouse from existing pallet URL | Record unavailable; no cross-warehouse record displayed |
| Empty warehouse | Clear first-product action and zero counts |
| Mobile navigation | Hamburger drawer opens, navigates, and closes |
| Thai / English | Language switch works; same route retained |
| Widths 320, 390, 768, 1440 px | No document horizontal overflow on checked forms/detail/list/recommendation states |
| Final browser console | Zero errors after watcher fix; expected Clerk development-key warning only |

## Automated edge cases

Tests include tenant and warehouse isolation; role-based read-only UI and mutation guards; concurrent reservations and planner edits; exact boundary/collision/support-height rules; randomized fit-search comparisons; idempotent uncertain retries; partial measurement clearing; draft actor isolation; storage-disabled browser recovery; operator-specific verification; stale measurement and occupied-layout checks; missing/error/empty UI states; keyboard scene controls; accessibility; camera cleanup, startup failure, and duplicate decode suppression; locale query/hash preservation.

## Review and fixes

Independent backend, frontend, geometry, and planner reviews found and fixed operator-verification handoff, actorless draft keys, stale retry IDs, duplicated error messages, occupied-edit confirmation, condition normalization, and locale query loss. Notes are in `docs/plans/finished-goods-flow-2026-09-05/`.

During recording, evidence writes under the worktree triggered excessive development recompilation. Development watch exclusions now cover artifacts, cache, and plan files while retaining source hot reload. Actual Watchpack and live Next trace checks passed. A transient script error during the rebuild storm did not recur; all 248 saved bundle modules parsed successfully. See `dev-refresh-investigation.md` for the exact evidence and limits of the diagnosis.

## Limits

Real camera hardware was unavailable for a physical QR scan. Automated camera/decoder behavior and real manual-code verification were tested. Product stock ledgers, picking/shipping, automatic physical-placement detection, and stored-pallet relocation are outside this finished-goods placement scope.
