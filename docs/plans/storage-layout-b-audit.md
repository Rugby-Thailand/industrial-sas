# Storage Layout B audit

Date: 2026-10-01
Base: `origin/main` at `ccc5c8e`.
Scope: responsive Layout B, canvas palette and local review fixture. Original working tree with warehouse/import work remains intact; review and merge use an isolated worktree.

## Standards

No hard documented-standard breaches found. Installed Next.js CSS guide was read before conflict resolution. Scoped semantic CSS tokens remain consistent across workspace, portal menu and mobile sheet.

Nonblocking judgment call: mobile/grid sort controls repeat UI markup in `FloorLocationTable.tsx`. They share state correctly; extracting the controls can reduce future divergence. No broad renderer refactor is needed for this merge.

## Spec

Four gaps found and fixed:

- Compact inspector/sheet had lost the zone QR image. Restored it inside the shared QR disclosure, retaining distinct child-position QRs.
- Compact archive action/disclosures were below the 44px mobile target. Added minimum 44px height.
- Mobile reused a wide desktop drawing frame, making its initial fit too small. It now uses a narrower drawing frame, retaining metric scale and the same pan/zoom geometry.
- Mobile sheet repeated the inspector clear-selection X beside the sheet close X and inherited a global overlay color. It now has one close button and uses the shared canvas overlay token.

Selection scope, map/list state, permissions, editor handoff and Slate/Teal/Lime palette match the intended flow on inspection. Rebase preserves current main's approved geometry, imported area selection, stairs/platform rendering and roving keyboard focus.

## Dependency audit

`pnpm audit:prod` found Next.js 16.3.3 affected by [GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j). Upgraded Next.js and its ESLint config to 16.3.6, the advisory's patched version. Dependency audit then reported no known vulnerabilities. This package finding does not establish that this application exposes the vulnerable ImageResponse path.

## Validation

- Full suite: **123 files / 1049 tests passed**. Final affected UI suite after mobile polish: **81 tests passed**.
- Typecheck, lint, production build, dependency audit and diff/format checks passed. CI validates the final PR head before merge.
- Chromium browser matrix: **360, 390, 428, 768, 1024, 1280, 1440px**, Thai/English, light/dark (**28 combinations**): no document horizontal overflow.
- Verified map/list selection, preserved search across tabs, Escape retaining selection and returning focus to the opener, one editor after sheet handoff, cancel/close, and resizing to desktop removing the sheet/modal lock. No page errors in these flows.
- QR image, a single sheet close button and computed dark sheet background verified in the running app.
- Browser evidence: [desktop](assets/storage-layout-b-audit/desktop.png), [mobile map](assets/storage-layout-b-audit/mobile-map.png), [mobile list](assets/storage-layout-b-audit/mobile-list.png), [sheet](assets/storage-layout-b-audit/mobile-sheet.png).
- T3 preview reported no connected automation host, so the matrix used installed headless Chromium against the isolated running app and existing local fixtures. Login uses the designated local Clerk test account.
- Actual iOS/Android keyboard and camera checks still require a physical device. This audit does not claim full application WCAG certification.

Summary: Standards — 0 hard breaches / 1 nonblocking duplication heuristic. Spec — 4 resolved gaps; QR preservation was the most significant. Dependency — 1 critical package advisory resolved.
