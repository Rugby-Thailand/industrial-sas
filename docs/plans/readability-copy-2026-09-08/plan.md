# Readability and concise copy — implementation plan

Date: 2026-09-08. Status: plan only; application behavior and code unchanged this turn.

## Evidence and scope

Compared the supplied generated desktop/mobile design with the live Thai IN_TRANSIT move page for P-000001. Inspected MoveScreen, DestinationSummary, FloorMap, PackingScreen, shared button styles and global color tokens. Other pages below are a planned audit scope, not a claim of completed visual audit.

Live dark-theme samples measured from computed CSS:
- Muted text #a8b1bd on panel #1a2028: 7.56:1. It is not a measured contrast failure.
- Disabled text #9aa4b0 on #2c333d: 5.04:1. Improve recognition and explanation rather than making it resemble an active button.
- Coordinate labels/help commonly use 12px text; map text has transformed screen bounds only 8–10px high at the inspected desktop viewport. SVG fontSize alone is misleading because the viewBox scales it.
- Essential location text is repeated in the source/target strip, confirmation card and scene footer. Status appears in the summary badge, warning banner and scene caption.

## Missing or weaker than the design

1. A compact progress indicator: เลือกปลายทาง → ย้าย → เสร็จ. Current screen has multiple status sentences instead.
2. Clear destination hierarchy: large location name, smaller building/floor, readable position code and one coordinate row. Current DestinationSummary makes the full breadcrumb one equally weighted line.
3. Readable map labels with selected destination emphasized. Current text is tiny and visually competes with dimension annotations and other pallets.
4. Primary-action hierarchy: checkbox + confirm should precede optional QR in visual/keyboard order. Current QR control is placed above the primary action.
5. Concise copy and a single explanation for space release. Current generic warning, subtitle and hints repeat the same state.
6. Distinct completion feedback with the new position. Keep existing completion route, add a short success message only after the server confirms; refresh must not replay it as a new success.

Keep the existing working checkbox flow, optional QR, permission checks and mobile action bar. The generated racks and extra sidebar modules are illustration details, not missing features to implement.

## Proposed move screen

Top: back link, title “ย้ายพาเลท”, compact three-step progress (aria-current=step).
Summary: “P-000001 · FG-001 · 500 ชิ้น”. Lot and dimensions in expandable details.
Route: “จาก POS-000001 → POS-000028”; do not repeat the full building/floor/location on both sides if they are the same. Cross-building/floor/location moves must clearly show the changed hierarchy.
Map: destination pin + readable selected position label, short legend, optional dimensions. Secondary labels reveal on focus/selection, not all at once. Never hide coordinates or identity from accessible inspection.
Confirmation card: location name first; building/floor underneath; position code; “X 1 · Y 0 · Z 0 m · 0°”. Supporting pallet remains explicit for stacking.
Action: unchecked physical checkbox, primary button, then compact optional QR disclosure. Source pickup and return use the relevant source details.
Mobile: destination context first and concise sticky action bar. Maintain bottom spacing, safe-area support and a visible label even when the map is scrolled. No duplication of the actionable checkbox.

## Copy changes (Thai; English follows the same meaning)

| Current | Proposed |
| --- | --- |
| ทั้งสองพื้นที่ยังถูกกันไว้ ระบบคืนพื้นที่เมื่อยืนยันการวางหรือคืนต้นทางเท่านั้น | Remove subtitle; one contextual helper near action: “ยืนยันแล้วคืนพื้นที่ต้นทาง” |
| ต้นทางคือตำแหน่งที่ยืนยันล่าสุด | Remove normal-state warning banner; keep actual issues as alerts |
| ไปยัง · ปลายทางที่จอง | ปลายทาง |
| ฉันวาง P-000001 ที่ปลายทางตามพิกัดและทิศทางที่แสดงแล้ว | วาง P-000001 ตามตำแหน่งนี้แล้ว |
| ฉันรับ P-000001 จากต้นทางแล้วจริง | รับ P-000001 จากต้นทางแล้ว |
| ฉันคืนพาเลทนี้ตามตำแหน่งและทิศทางต้นทางที่แสดงแล้วจริง | คืน P-000001 ตามตำแหน่งต้นทางแล้ว |
| สแกน QR เพิ่มเติม (ไม่บังคับ) | สแกน QR (ไม่บังคับ) |
| ติ๊ก checkbox หลังจากปฏิบัติงานจริงแล้ว | ติ๊กเมื่อวางเสร็จ (pickup: ติ๊กเมื่อรับแล้ว) |
| พิกัด X/Y อ้างอิงจากจุดเริ่มต้นที่แสดงภายในจุดจัดเก็บนี้ | Help disclosure: “X/Y วัดจากจุดเริ่มต้นในแผนผัง” |
| ระบบจะบันทึกการยืนยันและอัปเดตพื้นที่ที่กันไว้ | Remove after ticking; button itself communicates the next action |

Keep “ยืนยันย้ายเสร็จ” as the action label. A failed action must retain its reason and a concrete next step; never shorten error text so far that recovery becomes unclear. Keep zero counts, occupied/reserved distinction, item/unit identities, units of measurement and physical-action acknowledgement.

## Typography and contrast

- Use existing semantic tokens consistently. Important names, quantities, coordinates and actions use primary text; muted is for secondary context only. Avoid reducing opacity on essential text.
- Aim for 14–16px rendered body/action text; secondary metadata 13–14px; Thai instructions readable with suitable line height. Map identity labels at least 12px rendered size at normal viewport, with larger selected label or external callout on small screens.
- Use a screen-space label layer or projection-based font scaling for SVG labels; constrain overlap and expose full names through selection. Do not enlarge all labels until the map becomes unreadable.
- Measure enabled buttons in normal/hover/focus states against their actual backgrounds. The generated image’s bright blue with white text is not a verified color token; preserve or choose a measured foreground/background pair.
- Text contrast target: 4.5:1 normal, 3:1 qualifying large text. Essential component boundaries and graphical cues: 3:1 against adjacent colors. Inactive controls are exempt under WCAG, but adopt a readable internal target and clear disabled styling/help.
- Do not blindly brighten global muted colors: inspected dark samples already pass. Audit light and dark separately, including badges, placeholders, tooltips, selected rows, errors and SVG fills.
- Sources: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html and https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html .

## App-wide audit order

1. Move / destination confirmation / return dialogs: apply the design and copy changes above.
2. Pallet details, measurement, storage selection, stacking: shared PalletScene, DestinationSummary and Summary; eliminate repeated breadcrumb/status/help, retain measured dimensions and support identity.
3. FG list/detail and batch/packing: make total quantity vs units distinct, one status per item, collapse long packing guidance, improve table headers and validation readability.
4. Building overview, floor map, storage spot cards: readable labels, one selected-location summary, no duplicate inspect hint when the empty inspector already displays it; meaningful zero/empty states.
5. Shared controls/navigation/dialogs: input labels, placeholder text, badges, disabled buttons, focus rings and translated error notices. Check auth/setup screens using those components as regression scope.

## Implementation stages and checks

1. Save before screenshots and a contrast inventory (element/state/color/background/ratio/rendered size). Record repeated text by screen, not just duplicate strings across the repo.
2. Fix shared typography/color roles without changing business logic; test both themes and affected component variants.
3. Add compact/context options to DestinationSummary, Summary and PalletScene as needed; preserve detailed defaults on pages that need them. Avoid a separate bespoke component for each page.
4. Simplify move screen and copy first; verify pickup, acknowledgement, optional QR mismatch/fallback, return and completion. Check ownership/error states still explain what to do.
5. Roll the shared pattern through the other pages above and verify each before proceeding. Preserve domain distinctions (สินค้า / ชุดจัดเตรียม / หน่วยจัดเก็บ / จุดจัดเก็บ / ตำแหน่ง).
6. Run typecheck/lint/full tests/build, browser audit at mobile 390px and desktop 1119px/1742px, Thai/English and light/dark. Test keyboard, zoom 200%, long names, no data, loading, pending and errors. Automated contrast testing is supplemented by manual SVG/overlay inspection.
7. Save after screenshots, per-page pass/fail report and short video for the move flow. Use synthetic records for committed tests, preserve the user's live pending movement.

## Acceptance

- One clear next action visible without scrolling past the 3D scene.
- One operational status explanation per screen; no repeated full destination path unless necessary for spatial orientation or sticky context.
- Selected location and pallet identity remain readable at normal zoom; map labels no longer render at 8–10px.
- No required enabled text/control contrast failures in audited states. No blanket claim of whole-app compliance from a few samples.
- Target at least 30% less static explanatory copy on the move screen (exclude item names, quantities, coordinates, errors and accessible labels from the count).
- All movement/reservation/support/quantity rules remain unchanged; no weight-rule work in this task.
