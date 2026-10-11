# Shortcut customization: drag-only revision

11 October 2026. User direction: remove visible up/down arrow buttons and keep drag reordering. The HTML and fourth component board now show only a six-dot grip, icon, label and visibility switch per row. The image was edited with the built-in ImageGen tool; [exact edit prompt](../../prompts/component-04-drag-only.txt), PNG metadata, sidecar and manifest record its provenance. No user approval of the resulting image is assumed.

The same 48px grip supports mouse, emulated touch and keyboard interaction. Keyboard users select with Space/Enter, move with keyboard arrows/Home/End, place with Space/Enter, and cancel with Escape. Those are keys; no arrow buttons remain in the visual interface. Changes update the draft and live preview, then Save persists them or Cancel discards them. Pointer cancellation restores the pre-drag order. Edge scrolling supports dragging through a long list.

Executed [targeted browser checks](results.json): **8/8 pass**, no browser errors. Covered arrow-control removal/48px grips; desktop drag/live preview/Save/reload; Cancel of order plus visibility; keyboard commit/cancellation; pointer Escape/cancellation; returning to original order clears dirty state; full labels/no overflow in desktop/mobile light/dark; actual Chromium touch-event reordering and capture release. [Current source and image hashes](artifact-hashes.json) bind this evidence to this revision. Four current screenshots accompany these checks; these supersede the earlier customization composition. Root visually inspected both light captures and the ImageGen edit in one inspection round.

This follow-up uses the existing palette, fonts, card anatomy, toggle and Save/Cancel treatment. Its new handle and selected drag row use existing neutral/link/selected roles; no global application token changed. The original Kiro and independent whole-preview reports describe the earlier revision and were not rerun for this narrow follow-up. No claim of a fresh whole-preview approval is made. Chromium touch emulation is not a physical-device or screen-reader test.

Production features remain unimplemented; this is the local synthetic preview.
