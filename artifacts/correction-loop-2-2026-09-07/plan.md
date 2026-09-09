# Follow-up correction loop

Continue on codex/storage-planner. Preserve quantities, stacking locks and weight-rule deferral.

1. Remove the batch-measurement detour from pending unit details and recommendations. Open the exact unit correction via a scoped product link; reject missing/locked/foreign-unit requests.
2. Protect unsaved packing corrections from Escape, outside click and Close. Leave untouched editors easy to close; keep draft-preserving tab navigation easy. Block dismissal during submission.
3. Live audit the resulting flow, including cancellation, invalid input, repeated navigation, mobile/Thai, and no unintended writes.
4. Fix findings, run focused/full checks and production build; save screenshots and a video of each changed interaction.


## Completion

All four stages complete. Follow-up review found and fixed a stale URL close race, offscreen error recovery, and editor state leaking across targets. Final: 634 tests/63 files passed; desktop EN and mobile TH inspected; production build passed. Evidence and limitations: `results.md`.
