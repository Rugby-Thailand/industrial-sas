# Consistent scan icons

Captured from the running app in the `codex/consistent-scan-icons` worktree,
using the Thai interface and dark theme. Desktop captures use a 1440 × 1000
viewport; mobile captures use a 390 × 844 viewport.

All code-scanning icons now use the shared `ScanIcon` export of Lucide's
`ScanBarcode` glyph. This covers sidebar navigation, the finished-goods
catalogue, barcode acquisition, location selection, ticket fields, and the
shared pallet, source, destination, and supporting-pallet verification fields.
Location assignment in scan records also uses the shared location picker.

Inline scan actions show only the neutral icon, with a transparent background
instead of a blue fill. Their accessible labels, focus styling, and touch targets
remain available.

Inline scan buttons are centered by a wrapper, so the button's press translation
cannot overwrite their positioning. Browser measurements found a 1 px press
effect instead of the original 23 px jump, and the clicks reached their controls.

| Screen                                 | Screenshot                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| Catalogue and sidebar                  | [Desktop](catalogue-desktop.png)                                                     |
| Location picker                        | [Desktop](location-scan-desktop.png)                                                 |
| Ticket fields and barcode acquisition  | [Desktop](ticket-scan-desktop.png), [Mobile](ticket-scan-mobile.png)                 |
| Pallet verification during move pickup | [Desktop](pallet-verification-desktop.png), [Mobile](pallet-verification-mobile.png) |

Validation: 114 related tests passed; full typecheck, targeted ESLint, formatting,
and diff checks passed. The Impeccable detector reported no findings. Browser
checks confirmed matching SVG paths, working location and verification scan
actions, the ticket-field dialog, and no horizontal overflow at mobile width.
Physical camera decoding was outside this visual check.

The preview runs at <http://localhost:3110/th/finished-goods/scan> with an isolated
copy of the local demo backend on ports 3330/3331. The temporary move reservation
used to expose verification controls was cancelled after capture.
