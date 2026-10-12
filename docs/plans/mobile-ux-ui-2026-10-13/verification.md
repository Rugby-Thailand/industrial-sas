# Implementation and independent verification

Kiro implemented the approved 17 requirements on `codex/mobile-ux-ui`, based on `11c8c2cc65173e252b2464150cccdda092b0235d`. Codex reviewed the implementation, repaired findings and ran independent checks. Original screenshots remain unchanged: all nine SHA-256 hashes and byte counts match [images.json](./images.json).

## Requirement coverage

| Requirements | Result and verification                                                                                                                                                                                                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX-01        | One Pen trigger after the building heading opens the existing settings dialog. Archived/draft guards remain. Unit tests and eight browser cases, including a long Thai name at 360px.                                                                                                                           |
| UX-02–05     | Mobile detail banner, duplicated area heading and inner clear control removed. Same area/location reopens its sheet without resetting selection or camera. Desktop/compact reopening remains. FloorMap workspace and label tests; browser workspace suite.                                                      |
| UX-03        | Display-only suffix helper compares written precision against real dimensions. Codex tightened half-rounding boundaries; unknown suffixes and unrelated numbers remain unchanged. Helper regression tests pass.                                                                                                 |
| UX-06        | Active mobile menu reveals after grants settle, only inside its scroll container; manual interaction retains control. Codex fixed rapid reopen during the closing animation, including a manually collapsed active submenu. Unit regression and the exact Chromium reproduction pass.                           |
| UX-07        | Export moved beside Usage breakdown; screen-owned CSV scope, snapshot, dates, timezone and busy/error lifecycle remain. Unit tests and eight actual CSV downloads in the synthetic browser fixture.                                                                                                             |
| UX-08–10     | Requested disclosure and generic Open page labels removed; specific action labels and keyboard/IME behavior remain. Search title/close center difference ≤1 CSS px in all eight browser cases. Existing focus/search tests pass.                                                                                |
| UX-11–12     | Catalogue summary removed; one shared + Building action is outside the search border in either view. Tests and eight browser cases verify spacing at 360px/1440px; the new-building page's full wording remains.                                                                                                |
| UX-13        | Thai/UK flags accompany language names. Names drive option accessibility/typeahead; flags are decorative. Unit tests and browser typeahead checks pass.                                                                                                                                                         |
| UX-14–15     | Expanded barcode frame and compact ImagePlus picker apply only to JobScanScreen's location step. Feed aspect ratio and object-contain survive portrait/landscape and 360/390/430px widths. Default scanners retain their controls. Browser/unit regression tests pass.                                          |
| UX-16–17     | One centered reread control replaces the full-width retry/lower retake control only in the opted-in Job flow. Browser requests have identical image SHA-256, dimensions and payload length; one click adds one request. Busy hides retry and retains Cancel. Existing stale-response/default-reader tests pass. |

## Review disposition

- [Standards review](./codex-standards-review.md): zero documented-standard violations and zero actionable baseline smells.
- [Spec review](./codex-spec-review.md): one finding at `b90281c4`, fixed and reproduced successfully afterward. Active submenu now expands on every fresh mobile opening, including a reopen before exit animation completes; manual collapse during that opening still works.
- Codex additionally repaired sidebar shortcut contrast found by axe, and the label helper's rounding boundary. React component/hook/accessibility/performance/TypeScript checklist reviewed; no remaining actionable issue.
- One Impeccable detector pass on the changed UI sources returned [no findings](./evidence/impeccable-findings.json).

## Local checks

| Check                                 | Result                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm test --maxWorkers 2`            | 301 files / 3,902 tests passed before the final submenu regression was added.     |
| Final sidebar regression suite        | 18 tests passed, including the added persistent-drawer reopen case.               |
| `pnpm typecheck`                      | Pinned Bun 1.4.3 / TypeScript 7.0.2, 910 files, no errors after the final repair. |
| `pnpm lint`                           | Passed with zero warnings.                                                        |
| `pnpm build`                          | Optimized Next.js production build passed after the final repair.                 |
| `pnpm test:e2e`                       | 94 smoke tests passed.                                                            |
| `pnpm test:e2e:workspace --workers 2` | 46 passed / 2 intentional desktop-only skips on the mobile project.               |
| `pnpm audit:prod`                     | No known vulnerabilities.                                                         |
| `pnpm ci:codegen`                     | Generated bindings match pinned CLI output; throwaway local backend only.         |
| `pnpm ci:test-discovery`              | 301 Vitest files and 13 Playwright specs discovered.                              |

The final PR reruns format/type/lint/audit/codegen, all Vitest shards and browser suites through the repository merge gate. Merge requires its `check` and CodeQL results to pass.

## Browser evidence and limits

[Shell/report checks](./evidence/shell-browser-checks.json) cover Thai/English × light/dark × 390px mobile/1440px desktop. [Building controls checks](./evidence/building-browser-checks.json) cover the same language/theme combinations at 360px and 1440px. [Screenshots](./evidence/screenshots/) show actual production components rendered with synthetic fixtures.

The shell/report fixture uses in-memory grants/report responses. Building verification composes production filters, heading and settings dialog with an empty-floor synthetic building; it opens but never submits settings. Scanner tests use a canvas camera, public barcode fixtures and synthetic AI responses. They verify acquisition, geometry, request identity and UI lifecycle, not physical-device camera hardware or AI recognition quality. No production identity, inventory or upstream AI request was used.

Kiro's [handoff](./kiro-implementation.md) and [implementation request](./audit/kiro-implementation-request.md) preserve implementation provenance. The earlier [image audit](./kiro-audit.md) is a historical input; the approved plan and subsequent user clarifications define the final scope.
