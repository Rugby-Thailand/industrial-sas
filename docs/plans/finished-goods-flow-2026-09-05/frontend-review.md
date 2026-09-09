# Finished goods frontend review and regression evidence

Updated 2026-09-05 during implementation. This note records automated component and Convex checks, not live-browser or physical-camera verification.

## Current evidence

- `ProductScreens.test.tsx`: product creation, draft save, invalid inputs, server/network rejection, duplicate SKU action, local draft recovery, malformed storage recovery, save locking, uncertain-response recovery, existing product/new pallet, resume validation, catalogue filtering, and read-only access.
- `PalletScreens.test.tsx`: metre/centimetre conversion, partial measurements, invalid dimensions, failed save retention, remount recovery, direct-route guards, original pallet resume links, cleared dimensions, measurement command lifecycle, no-fit states, local placement coordinates, invalid adjustment, reservation review/conflict, destination mismatch, separate verification/storage confirmation, cancellation, stored navigation, and read-only access.
- Product and pallet accessibility suites: English and Thai forms, catalogue controls, position editing, reservation review, discard dialog, and destination verification dialog.
- `DestinationScanner.test.tsx`: 11 tests covering explicit camera startup, permission/unavailable-device errors, manual entry, duplicate frames, reader failures, stop/unmount, late startup, verified state and retry.
- `finished-goods-measurement-clearing.integration.test.ts`: 2 real Convex harness tests prove clearing one/all dimensions removes old database values and moves a pallet back to awaiting measurement; completing dimensions again restores awaiting-placement status.

Latest combined product/pallet/accessibility/clearing run: **60 tests passed across 5 files**. Scanner's separate suite: **11 tests passed**. Targeted ESLint passed after replacing inline import-type annotations. Global TypeScript check passed. Logs: `.cache/fg-polish-tests.log`, `.cache/fg-frontend-tests.log` (the latter predates later regression additions).

## Bugs identified and regression-covered fixes

1. The backend's `DUPLICATE_KEY` refusal initially displayed generic feedback. It now explains duplicate SKU and links to the existing product.
2. Restored product drafts initially skipped discard confirmation. Restored changes now remain recognized as unsaved work.
3. Malformed optional local-draft values could render null/object input values. Draft recovery now validates fields.
4. Pallet search initially omitted product names despite promising name search. Product-name searches now find matching pallets.
5. Inputs remained editable during asynchronous saves, allowing newer work to disappear on success. Save fieldsets now prevent this race.
6. A lost create-pallet response followed by refresh could create another pallet. Pending command identity now survives remount.
7. Returning from measurement to product details initially led to creating another pallet. Resume context preserves the original pending pallet and rejects wrong-product/reserved/stored targets.
8. Persistent measurement command identities needed clearing after successful saves. Revising dimensions A → B → A now uses a fresh final command, preventing stale idempotent replay from retaining B.
9. Read-only roles initially saw creation and placement controls. Their existing records remain readable while mutation actions are gated.
10. Camera startup/unmount races could retain media tracks or restart competing scans. Scanner lifecycle cleanup and startup serialization now have focused regressions.

## What these tests do not prove

Component tests mock the network and do not substitute for actual backend authorization tests, browser geometry checks, mobile keyboard/touch testing, or the recorded full flow. Accessibility scans run in jsdom and do not prove visual contrast or the usability of actual camera hardware. The final run should retain screenshots and a genuine screen recording separately.


## Shared device and operator verification follow-up (2026-09-06)

- Product and measurement drafts, including persisted uncertain command IDs, now use the authenticated Clerk user ID in their browser-storage scope. Auth must be loaded before either form mounts. Changing actors remounts the form, so in-memory state cannot leak across users sharing the same warehouse/browser. Legacy actorless drafts are ignored.
- Regression coverage switches actors without reloading the page, checks each actor's restored values, prevents reuse of another actor's uncertain product command, and gates form hydration until identity is ready.
- Verification is actor-specific: a prior operator's successful destination check does not disable the next operator's scanner or enable their storage confirmation. Actual server checks still decide whether storage can be confirmed.
- Structured ConvexError data.code now selects actionable error copy; a regression verifies a real ConvexError capacity-limit response does not fall back to a generic connection message.
- Validation: 79 Product/Pallet/frontend accessibility and scanner tests pass; global TypeScript and targeted ESLint pass. Additional regressions confirm normal product creation and measurement saving still work when browser storage throws SecurityError or QuotaExceededError. Logs: ignored `.cache/fg-actor-tests.log` and `.cache/fg-actor-typecheck.log`.
- These browser drafts are operational recovery, not encrypted secret storage. Signing out does not erase the previous actor's draft; it makes it inaccessible to other app sessions and available when that actor signs back in.
