# Screenshot user manual — production plan

Status: planned; manual capture has not started.  
Target: `codex/storage-planner`, app at http://localhost:3100.  
Primary language: Thai, matching the warehouse UI. Include English control names in a short reference index.  
Audience: warehouse operators and users responsible for buildings/storage locations.

## Deliverable

A task-based manual using actual screenshots of the running application. Each action has a numbered red rectangle around its target, a short instruction, and the expected result. Screenshots appear inline; users do not need to open image links to understand the guide.

Deliver a browsable HTML manual with chapter navigation and a printable PDF, plus the Markdown source, original screenshots, annotated screenshots/overlays, and a coverage checklist. Use desktop screenshots for the main guide and mobile screenshots where the controls/layout differ. The guide documents functionality available in the current build; unsupported features must not appear as available actions.

## Step template

- **Goal:** the task the reader will complete.
- **Before starting:** required permission and state, e.g. an unplaced measured pallet.
- **Step 1 — Click [exact visible button name].** Screenshot with red rectangle 1 around the button.
- **Step 2 — Complete the opened dialog.** New screenshot with numbered rectangles around required fields; a short example value for each.
- **Step 3 — Review and confirm.** Screenshot of the actual review/confirmation state, explaining the effect of confirmation.
- **Result:** screenshot showing the successful state and where to continue.
- **If something is wrong:** screenshot of the relevant error and the shortest correction path.

Example storyboard: Open unit details → click “Measure box” → exact-unit editor opens → correct height → check measured dimensions → review replacements → confirm → updated unit/result. Include an alternative Close → Keep editing / Discard sequence.

## Annotation standard

1. Use a thin, bright red rectangle, with a small red numbered badge just outside the target. Rectangles may be rectangular to fit the control; do not force a large square over neighboring controls.
2. One action per screenshot where possible; at most three numbered targets for a small group of fields. Match numbering to the instruction below the image.
3. Keep text, icons, validation messages and selected values readable. No filled red blocks over the interface.
4. Capture before clicking, then capture the resulting menu/dialog/page separately. Never describe a popup using only a screenshot of the closed button.
5. For drag actions, mark the object and destination separately and add a red directional arrow; include the final position and calculated height.
6. For errors, mark both the error and the control used to correct it. Explain the reason in text; do not rely on red alone.
7. Preserve full-page context when useful, plus a readable close-up for dense fields. Use a consistent viewport and screenshot scale within a flow.
8. Keep raw screenshots separately from annotated versions. Use actual QA data and actual UI results, with no fabricated success states.

## Coverage matrix

| Chapter | Functionality | Required screenshot sequences |
| --- | --- | --- |
| 1. Getting started | Sign in, first-run setup if presented, warehouse selection, language, sidebar, top-left Back, user menu/sign out | Entry screen → action → resulting state; mobile navigation variant |
| 2. Find products and units | Summary counts, products/units tabs, search, status filter, clear filters, card/list switch, open details, return with filters retained | Normal list → search/filter → matching detail → Back; no-results → clear |
| 3. Create and edit FG | Required product fields, counting unit, storage conditions/notes, optional references, save/cancel, prepare more goods | Create form → required fields → validation → saved product; edit existing product → save; explain product data versus batch quantities |
| 4. Prepare and pack a batch | Total quantity, lot where available, packaging type, quantity per unit, automatic split, add/remove units, partial remainder, dimensions, measurement confirmation, review/save | Product → prepare → allocate → measured units → review → created units; show a non-even split and quantity mismatch correction |
| 5. Correct packing and measurements | Exact-unit pencil, direct measurement correction, whole available-batch editing, 4 → 2 repacking, protected stored/reserved units, history/replacements, legacy measurement/cancellation where available | Select one unit → edit → review → save; whole-batch 4 → 2 example with total preserved; dirty Close → Keep editing / Discard; unavailable target → recovery |
| 6. Buildings and floors | Search/filter buildings, create building, dimensions/floor count, select floor, settings/quick change, review/activation, allowed edits and impact review | Create → building model → floor selection → edit → review → active; invalid dimensions and occupied-change restrictions |
| 7. Storage locations | Floor dimensions, unusable areas, add/edit/archive storage spots when allowed, location name/code/QR, direct location editing, layout save, 2D/3D controls | Floor → add/edit area/spot dialog → position/size → save → QR/details; occupied location restriction and safe correction |
| 8. Recommend and store | Open measured unit, suitable locations, search/select alternatives, exact position, X/Y, rotation, 2D/3D, zoom/rotate/reset, reserve, verify identity/location, confirm placement | Unit → recommendation → precise preview → review/reserve → scan or enter code → confirmation → stored result; no-fit, collision, wrong QR and cancellation branches |
| 9. Move stored units | Contextual Move, destination search, change exact position, reservation, source/unit verification, movement confirmation, destination verification, completion; cancel/return/resume | Stored unit → Move → select/preview → reserve → verify/start → destination verify → finish; interrupted move and return branch |
| 10. Stack pallets | Enable/configure available stacking limits, choose upper pallet, automatic Z on drag, red invalid elevated preview, drag off support, reserve/verify/confirm, stored upper through Move, support lock/unlock | Lower → Stack on top → limits → upper → 2D/3D → reserve → identities → placed; overhang/height/level errors; move upper away → lower unlocked |
| 11. Recover and continue | Required/invalid inputs, permission restrictions, unavailable data, stale changes, retry, refresh, safe Back, unsaved changes, loading/saving states | Each recovery branch belongs beside its main task, with a short index here; document when a reservation remains held |
| 12. Mobile and control reference | Mobile menu, responsive dialogs, reachable actions, location controls, QR/manual entry, icon meanings, Thai/English labels | Differences from desktop only; use real mobile viewport captures and describe physical camera limitations honestly |

Inventory every visible menu item, button and allowed state against this matrix before capture. Rack/fixed-support controls and any first-run/admin controls must be included only if the current UI exposes them. Account-provider screens should be documented as observed without capturing passwords, session tokens or personal account details.

## Important explanations

- FG defines the product. Batches hold quantity and packing; units represent the actual boxes/pallets.
- Total product pieces, pieces per unit and number of active units are different values.
- Repacking replaces eligible units; retired units are history and must not count as active stock. Demonstrate 4 → 2 with exactly two active units and unchanged total quantity.
- A location name such as FG-1 is not the product SKU. Show building → floor → location → precise position.
- Preview does not reserve space. Reservation does not confirm physical placement. The guide must show these separate states.
- Stacking applies to pallet-on-pallet in this scope. Z is calculated automatically. Supporting pallets stay locked until the upper pallet is moved away and that move is confirmed.
- Do not teach weight/load enforcement: those rules remain deferred in the current project.
- Manual identity-code entry can demonstrate QR validation, but it is not proof that a physical camera was tested.

## Production sequence

1. **Inventory and map:** inspect all accessible routes, menus and actions in the current build; assign task and screenshot IDs. Identify permission-dependent and state-dependent controls.
2. **Prepare examples:** use dedicated MANUAL-QA products, batches and building/location fixtures. Record initial quantities and placements. Use representative empty, ready, measured, reserved, stored, moving and stacked states without modifying unrelated records.
3. **Capture task flows:** perform each action in the app; capture the target before action, opened dialog/next page, review and result. Capture meaningful errors and the recovery steps.
4. **Annotate and write:** add numbered red rectangles/arrows, concise Thai instructions and expected results; keep original images unchanged in a separate directory.
5. **Assemble:** HTML chapters with inline images and table of contents; printable PDF with legible screenshots and no split step/caption pairs; icon/English reference index.
6. **Walk through and review:** follow the manual from a fresh starting state using only its instructions. Check every rectangle against its caption and the current app. Verify success and correction routes, quantities, permissions, mobile variants and all links.
7. **Deliver evidence:** show representative annotated pages inline in the conversation, save complete manual/source/checklist, and identify any feature that could not be captured or verified.

## Planned file layout

`docs/manuals/storage-planner/`

- `index.html` — browsable manual
- `manual-th.pdf` — printable manual
- `manual-th.md` — source text
- `coverage.csv` — task, route, permission, starting state, steps, screenshot IDs, result, verification status
- `screenshots/original/` — actual unannotated captures
- `screenshots/annotated/` — screenshots with numbered red marks
- `annotations.json` — source image, target rectangle/arrow, instruction and target name
- `capture-notes.md` — build/date, QA records, changes made, cleanup and limitations

File IDs use chapter/task/step, e.g. `05-01-02-edit-unit-dialog.png`. Maintain a screenshot manifest so an updated UI can be recaptured without rewriting the whole manual.

## Completion criteria

- Every available functionality has a checklist entry and either a verified screenshot sequence or an explicit reason it is not applicable/unavailable.
- Every instruction names the actual visible control; every red mark identifies that control accurately.
- A new user can complete create FG → prepare/pack → measure → recommend → reserve → verify → store → move/stack → correct/recover by following the guide.
- Stored/support locks, repacking totals, cancellation/return and identity verification are explained without implying a preview performed a real warehouse action.
- Inline images remain readable on desktop and phone; PDF text and screenshots remain readable at normal zoom.
- No obsolete screenshots, broken links, hidden required steps or unsupported weight-rule instructions.
