# Independent finished-goods frontend review

Reviewed product and pallet screens, shared save/error handling, camera/manual verification, tenant/read-only affordances, refresh/resume behavior, unavailable states, and accessible scene status. Root task separately checks the live browser and captures screenshots/video.

## Findings and disposition

1. **Another operator's scan could prevent further work.** The UI treated any `verifiedAt` as current-user verification, disabled scanning, and enabled a confirmation that the backend correctly refused for a different operator. Added backend `destinationVerifiedForCurrentUser`; root wired it into the UI. Backend reviewer added two-operator tests, including replay behavior.
2. **Successful verification request IDs needed to be retired.** A→B→A operator handoff could replay A's first successful scan without changing the current verification actor. Root clears verification request identities after a known successful verification. Uncertain retries still reuse their request ID.
3. **Wrong-code errors appeared three times.** Scanner generic failure duplicated the workflow's exact refusal inside/outside the modal. Added `DestinationScanner.showVerificationErrors` (default true); parent can pass false while displaying its precise business error. Local camera errors remain visible. Root coordinates outer/modal notice placement.
4. **No-fit reasons lost their meaning.** The screen lacked labels for actual backend codes `HEIGHT_EXCEEDED`, `NO_FREE_FOOTPRINT`, and `NO_SUPPORT_SURFACE`. Reported to root for its owned pallet screen.
5. **Unavailable destination could produce a broken layout link.** A stored record with null destination produced `/undefined/floors/undefined`. Reported to root to conditionally render the link and show an unavailable-destination notice.
6. **Permissions changing during an open modal left stale actions visible.** Server authorization remained effective, but scanner/cancel modal actions also need current permission/state guards. Reported to root, which owns those dialogs.
7. **Local drafts/request keys were not actor-scoped.** Two managers sharing a device and warehouse could recover each other's unfinished work or saved retry identities. QA agent owns adding actor-qualified draft keys and refusing recovery until identity is resolved; root owns measurement wiring.
8. **Thrown Convex errors lose their structured error code.** Shared operation handling read only `Error.message`; `ConvexError.data.code` should be preferred for known, actionable error copy. Reported to QA agent while they own shared save helpers.

## Confirmed behavior

- Backend checks still enforce tenant/warehouse/manage permission despite UI affordances.
- Direct read-only product creation is gated; existing product fields are readable and disabled; camera inspection and back navigation remain usable.
- Valid resume targets must belong to the same product and warehouse and remain pending. Resuming updates the same product and returns to the same pallet.
- Duplicate SKU offers an existing-product link while retaining local inputs.
- Product illustrations and invalid measurement drafts do not show invented dimensions or origins.
- Proposed, reserved, and stored scenes have distinct appearance and status instructions. Stored pallets cannot drag.
- Scanner stops tracks on success, stop, unmount, and late startup completion. Manual entry survives verification rejection and remains available without camera permission.
- Scanner's manual input limit now matches the backend 500-character limit.

## Evidence

Focused scanner regression: **12 tests pass**, including parent-managed business errors and retained retry input (`.cache/fg-review-scanner-tests.log`). Earlier scene/product/pallet regression: **62 tests pass** with TypeScript and lint clean. Backend review confirms operator-specific verification and planner/hold concurrency coverage passes. Root/QA run the final combined suite after their owned follow-up changes.
