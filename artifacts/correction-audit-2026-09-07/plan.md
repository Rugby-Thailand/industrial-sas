# Correction flow audit — 2026-09-07

Branch: codex/storage-planner. Preserve the existing batch and stacking implementations; no weight enforcement.

1. Audit stored/reserved location correction and batch measurement correction on desktop.
2. Put location actions next to the actual destination, avoiding the bottom-of-page hunt. Keep all lock/permission guards.
3. Make move destinations searchable, with stable selection and a clear empty-search recovery.
4. Open packing corrections directly from the affected unit and identify that unit in the editor.
5. Test each change, inspect desktop/mobile in English/Thai, audit again and fix concrete remaining issues.
6. Run combined tests/typecheck/lint/production build. Record separate browser videos for location corrections and packing corrections; save screenshots/results.

Baseline: stored unit move and layout links are in the bottom action bar; moving uses an unbounded horizontal destination strip. Product unit rows offer storage preview but no direct packing edit.

Completion boundary: correction paths are discoverable, preserve quantities and locks, and have no material issues found in the final audit. Physical move verification remains explicit.
