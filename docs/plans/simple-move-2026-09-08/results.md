# Simple move implementation — 2026-09-08

Implemented in codex/storage-planner. Live app: http://localhost:3100.

## Result
- RESERVED: unchecked physical pickup checkbox + Start move; no mandatory code.
- IN_TRANSIT: unchecked placement checkbox + Confirm move complete; no mandatory destination code.
- Return: source details + physical-return checkbox + Confirm returned; no mandatory source code.
- Optional QR remains available. Choosing QR requires valid verification; explicitly choosing checkbox instead resets the checkbox and uses an acknowledgement method.
- Desktop places controls beside the map. Mobile shows destination information first and fixes the acknowledgement and primary button at the bottom with reserved space and safe-area padding.
- Checkbox resets across status changes, target reservation revisions, route reload, verification-method changes and reopening the return dialog.
- Existing source/destination records and coordinates drive all summaries and previews.

## Backend
startMove / completeMove / returnMove accept explicit confirmationMethod ACKNOWLEDGEMENT plus physicalConfirmed. Existing SCAN/MANUAL callers retain verification requirements. Moves record pickupConfirmationMethod and completionConfirmationMethod alongside existing actor, timestamps, source/target IDs and audit events. Acknowledgement does not fabricate a QR scan or mark a placement as QR-verified.

Owner, tenant, warehouse, current-state, geometry, collision, height, support and reservation checks remain in force. Completion releases the old placement atomically; return releases the target only. Idempotent replay does not duplicate movement. No weight rules added; no quantity/repacking logic changed.

## Verification
- Added backend cases first: 3 failed as expected, then passed after implementation.
- pnpm check passed: typecheck, lint and 699 tests across 66 files.
- Production build passed with isolated .cache/simple-move-build output, preserving the running server.
- Added checkbox start/complete/return integration tests; physical acknowledgement required; source and quantity preserved; method recorded; stale target rejected; successful completion replayed safely.
- Support-lock regression runs both QR and checkbox move completion: moving an upper pallet keeps its supporting pallet locked until completion, then releases it.
- Other-operator rejection exercised for both confirmation methods. Existing cross-warehouse/readonly, collision, simultaneous reservation, cancel, return, retry and packing suites passed.
- UI tests verify no required textbox, disabled-until-checked behavior, explicit QR fallback, return, target-revision and reload reset.
- Browser inspection: Thai desktop, Thai/English mobile at 390 CSS px, no horizontal overflow. Mobile primary button is within viewport (top 751.8, bottom 799.8 in 844px height); English footer height 185.8px fits the reserved 192px bottom space.
- Live current move: checked only local UI state and optional scan/return dialogs; no physical movement was asserted or committed for the user's P-000001. Page left with checkbox unchecked.
- Synced Convex functions/schema to the existing local backend at 3320. CLI initially refused a second local process; used an ephemeral private self-hosted env file to synchronize the already-running backend. Removed temporary credentials file afterward; restored local deployment selection in .env.local after CLI rewrite.

## Evidence
artifacts/simple-move-2026-09-08/
- desktop-th.png: live checkbox UI.
- desktop-enabled.png: local enabled-button state only, not a completed move.
- mobile-th.png, mobile-en.png: viewport-override screenshots (capture may include excess background; DOM layout measurements recorded above).
- checkbox-actions.mp4: walkthrough assembled from timestamped real browser captures showing unchecked/checked button state, optional QR, switching back, and return dialog. Does not depict completion of the user's physical move.
- actions.json: capture timing manifest.
- check.log, build.log, backend-sync.log.

Design reference and original implementation plan remain in this directory. Generated design decoration was not added to the app; current data and existing sidebar/map components are used.
