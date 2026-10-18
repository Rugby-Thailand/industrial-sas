# Parent browser verification · 15 October 2026

These checks supplement Kiro's independent source/probe audit. No design-sheet source was changed. The existing preview server on port 3211 remains running. The audit-only axe asset server on port 3212 (PID 93752) was stopped after use.

## Confirmed observations

- **Thai calendar years disagree:** the visible trigger reads `14 ต.ค. 2569` and caption `ตุลาคม 2569`; the grid label is `ตุลาคม 2026`, and the selected day accessible label is `วันพุธที่ 14 ตุลาคม 2026, เลือกแล้ว`. These are live DOM accessible labels; no physical screen reader was used.
- **Confirming the selected date clears it:** open the date initialized to `2026-10-14`, then press Enter on the auto-focused selected day. The source becomes an empty string, the trigger reads `Pick a date`, and the popup closes.
- **Escape does not cancel an edited time:** open time `08:30`, click the hour Select, press ArrowDown then Enter to choose `09`, then Escape. The popup closes and returns focus, but the source retains `09:30`. This differs from the production adoption plan's explicit commit/cancel contract.
- **A valid field regains an error after changing language:** enter `JOB-1` in the static Job No. specimen. Its error clears and `aria-invalid` becomes `false`. Switch to Thai: the value and `aria-invalid="false"` remain, but the error text reappears as `กรอกเลขที่ Job ก่อนบันทึก`.
- **Short-height calendar is clipped:** at a 640×320 CSS viewport, with the trigger around y=70, the popup has top=114, bottom=446, height=332, `max-height: none`, `overflow-y: visible`; Radix reports only 194px available. The Clear date button occupies y=389–437, outside the viewport. This is emulated geometry, not a physical landscape device test. Screenshot capture for this case did not return usable evidence.

## Passing checks and limits

`browser-evidence.json` records 136 settled-state combinations: 17 workflow/state combinations × English/Thai × light/dark × 320/1280px widths. Full axe-core 4.12.1 reported no violations in those states, and no page-wide horizontal overflow was measured. Initial theme-transition contrast results were discarded and rerun after finishing CSS transitions. Axe still marked one `aria-prohibited-attr` case incomplete and four SVG floor contrast cases incomplete; this is not a blanket accessibility certification.

Calendar keyboard ArrowRight moves focus; the focused day has a visible 2px outline. Escape closes the calendar and returns focus to its trigger. The Reading specimen disables scanner, select and date controls. Nested time Select mouse/keyboard interaction works. Prior hover/press verification on this same revision confirmed text-only buttons change color without moving and preserve keyboard focus.

The detector returned two generic font warnings (Geist and Geist Mono). Both are rejected as actionable findings: the approved design preserves the application's established fonts. No additional generic styling claims are inferred from that scan.

## Needs follow-up

Selecting Reading with the keyboard in the Review state Select left focus on a listbox option rather than the recreated trigger in this browser run. The remaining listbox disappeared after Escape. Kiro's jsdom focus probe and its final interpretation should be compared before treating this as a confirmed general browser defect.

Physical touch behavior, cameras, real screen readers, print rendering and production application flows were not tested. The parent did not implement fixes.
