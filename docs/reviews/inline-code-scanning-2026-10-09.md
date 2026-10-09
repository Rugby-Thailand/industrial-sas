# Inline code scanning — implementation and audit

Date: 2026-10-09 (Asia/Bangkok). Base: `9c5ca74` (`origin/main`).
Branch: `codex/inline-code-scanning`. This implements the approved field-scan plan.

## User behavior and scope

- Job No. and product barcode have an adjacent blue scan action on every editable
  ticket, including manual, barcode-origin and AI-origin tickets.
- The shared location picker uses the same action for intake and saved-record
  location changes, including multi-record assignment.
- Existing pallet, supporting-pallet, source and destination verification fields
  use the shared action and camera engine. Their parent workflows still resolve
  identities and verify storage/pickup/return; camera scans remain `SCAN` and
  keyboard/handheld entry remains `MANUAL`.
- Empty ticket fields accept one valid result into the exact ticket and field.
  Existing values show current/scanned values and require replacement confirmation.
  Cancel/Escape preserves the value and restores focus. Scanning edits the draft;
  the existing Save action submits it.
- Quantity, date and descriptive fields retain their existing editors. This change
  does not add editing of saved Job/product identities or change master-data forms.

## Confirmed problems fixed

| Finding                                                                                                   | Fix and verification                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global ticket scanning chooses a different incomplete ticket rather than the selected field.              | A field scan captures ticket key, field and original value; it cannot create another ticket or redirect its result. Tested with two tickets, replacements and removal.                                                                  |
| The Job input allowed 200 characters while the server accepts 100.                                        | Shared model limits now drive server validation, input lengths and scan validation; oversized scans are rejected without truncation.                                                                                                    |
| A storage/pallet QR could be classified as a product barcode.                                             | Both ticket scan entry points reject reserved storage identities and invalid payloads. Job/product labels must match the selected field.                                                                                                |
| Multiple frames could launch multiple location lookups before the UI closed.                              | A synchronous acquisition latch accepts one lookup per session.                                                                                                                                                                         |
| Late location lookups could overwrite typing or an explicit selection.                                    | Typing, selection, rescan, close and unmount invalidate the previous lookup.                                                                                                                                                            |
| Lookup rejection was unhandled, and query denial could become unknown-location text.                      | Failures have localized feedback and retry. Denied, ambiguous, wrong-kind and invalid identities cannot become an unmapped fallback. Only unresolved plain location codes can be offered as unmapped text.                              |
| Mobile acquisition toolbar labels clipped at 320 px, including Thai scan and English scan/manual actions. | Stack icons above labels on mobile; all 12 language/theme/viewport combinations have zero toolbar text overflow.                                                                                                                        |
| Destination camera lifecycle duplicated the barcode engine.                                               | Reused `useBarcodeCamera`, with synchronous single-shot stop, generation guards, rear-camera preference, multi-format decoding and owned-track cleanup. Tests retain previous camera behavior and cover all four verification purposes. |

## Standards review

Read repository AGENTS.md and installed Next.js 16.3.8 client-component guides.
Reviewed the production diff against the base personally, preserving the earlier
request to work without sub-agents. Camera acquisition is shared rather than
copied; the input action is shared by ticket/location/verification fields; scanner
state remains local to its workflow. No dependency or schema changes, no inventory
writes during browser checks, and no edits to the original checkout's work.

## Spec review

The requested Job/product buttons, exact field targeting, editable ticket origins,
location editing paths and existing verification contexts are implemented.
Replacement, cancellation, wrong labels, read/save locks, stale callbacks,
keyboard entry, localized names and camera retry have regression coverage.

## Validation

- Full Vitest suite: 139 files, 1,172 tests passed.
- Final affected-flow checks include the ticket workflow, location picker,
  DestinationScanner, shared camera hook and ticket field validation.
- ESLint, TypeScript, production build and production dependency audit checked
  separately; results are reported in the PR.
- Native T3 browser exercised production components with isolated synthetic data
  and the real ZXing reader (only media acquisition/backend were fixture boundaries).
  QR `FO69070073` and Code 128 `FBN-BXVMI004-BOX-00F` filled ticket #1;
  ticket #2 remained empty. No save was submitted.
- A second product QR displayed current and new values before replacement;
  confirmation returned focus to the original scan action. Live media tracks were
  zero after success and while showing the replacement confirmation.
- Pallet QR `DEMO-P0001` reached the existing verifier as `SCAN`, populated the
  code input and released its track. Simulated permission denial retained typing.
- Final ticket DOM measurements: 12 combinations of Thai/English, light/dark and
  320/390/1440 px have zero page or acquisition-toolbar text overflow. Scan touch
  targets are 48 px on mobile and 44 px on desktop. Thai confirmation widths were
  288/358 px at 320/390 px, with zero page overflow.

## Limits

The T3 native screenshot operation failed repeatedly, including after reopening
and trying another tab. No screenshot/video is attached or claimed as verified.
Browser behavior and layout measurements above were still available.
Rear-camera focus, real printed labels, warehouse lighting, flashlight hardware,
and iOS/Android permission behavior require physical-device verification.
The browser fixture does not establish authenticated end-to-end backend behavior;
existing integration tests continue to cover the server boundaries.
