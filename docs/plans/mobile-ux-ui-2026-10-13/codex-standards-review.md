# Codex Standards review

Snapshot: `11c8c2cc65173e252b2464150cccdda092b0235d...b90281c4`.
Commit: `b90281c4 Improve mobile storage controls and Job location scanning`.

**Findings: 0 documented-standard violations; 0 actionable baseline smells.**
Confidence: high for the reviewed source contracts; browser, CI and physical-camera results require separate verification.

Standards consulted: `AGENTS.md`; `README.md` development/release rules;
`docs/plans/design-system.md` color, hierarchy, interaction and shared-control rules;
`docs/plans/design-sheet-system-adoption-2026-10-11.md` surviving domain/accessibility contracts;
and the installed Next.js Server and Client Components guide. Explicit user instructions and the current approved plan override historical presentation choices.

- `SidebarNavigation.tsx`: the reveal hook changes only the drawer's `scrollTop`, cancels its animation frame/listeners, waits for grants and yields to manual input. It preserves the documented keyboard/focus and permission boundaries.
- `FloorMap.tsx` and `areaDisplayLabel.ts`: mobile reselection avoids resetting camera/selection; the label helper is presentation-only, checks dimensions at written precision and preserves unknown labels. No saved geometry or physical-area identity changes.
- `StorageLayoutScreens.tsx` and `StorageLocationCatalogue.tsx`: existing buttons, links and settings forms retain guards and localized accessible names. The small shared creation action removes duplicate markup without moving domain rules into presentation.
- `CameraFrame.tsx`, `BarcodeImagePicker.tsx`, `LocationPicker.tsx` and `LocationImageReader.tsx`: explicit opt-in presentation preserves shared scanner defaults and existing acquisition/request lifetimes. The new overlay uses the existing accessible `IconButton`; retry reuses the selected file/crop.
- Search, locale and usage changes retain existing navigation/keyboard contracts, text-based option names and screen-owned CSV scope/handler. Synthetic HR access and photo digests remain confined to preview fixtures.

Reviewed all twelve Fowler baseline smells as heuristics. No changed abstraction, repeated shape or naming issue justified an actionable finding. Formatting/type/lint concerns were excluded because tooling owns them. No source files were changed during this review.
