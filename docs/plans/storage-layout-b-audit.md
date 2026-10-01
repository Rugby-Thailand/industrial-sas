# Storage Layout B audit

Date: 2026-10-01
Base: `origin/main` at `ccc5c8e`.
Scope: responsive Layout B, canvas palette and local review fixture. Original working tree with warehouse/import work remains intact; review and merge use an isolated worktree.

## Standards

No hard documented-standard breaches found. Installed Next.js CSS guide was read before conflict resolution. Scoped semantic CSS tokens remain consistent across workspace, portal menu and mobile sheet.

Nonblocking judgment call: mobile/grid sort controls repeat UI markup in `FloorLocationTable.tsx`. They share state correctly; extracting the controls can reduce future divergence. No broad renderer refactor is needed for this merge.

## Spec

Two gaps found and fixed:

- Compact inspector/sheet had lost the zone QR image. Restored it inside the shared QR disclosure, retaining distinct child-position QRs.
- Compact archive action/disclosures were below the 44px mobile target. Added minimum 44px height.

Selection scope, map/list state, permissions, editor handoff and Slate/Teal/Lime palette match the intended flow on inspection. Rebase preserves current main's approved geometry, imported area selection, stairs/platform rendering and roving keyboard focus.

## Dependency audit

`pnpm audit:prod` found Next.js 16.3.3 affected by [GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j). Upgraded Next.js and its ESLint config to 16.3.6, the advisory's patched version. Dependency audit then reported no known vulnerabilities. This package finding does not establish that this application exposes the vulnerable ImageResponse path.

## Validation

Final check and browser results will be recorded here before merge.
