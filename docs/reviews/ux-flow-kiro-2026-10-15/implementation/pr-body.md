Repairs the remaining UX failures found across HR, storage, and package workflows, revalidated against current main.

- HR now preserves History dates/status across detail visits, retains decision and employee-save receipts, and identifies missing HR roles with an explicit Settings handoff. Returned-correction feedback appears before the editing fields.
- Storage detail links offer warehouse selection when none is selected, missing/denied pages retain local Back recovery, empty warehouses get first-use guidance, and successful spot saves close without a false draft prompt while keeping their receipt visible.
- Package recovery notices link to the working label-storage flow; manually typed pallet codes match case-insensitively while camera verification still requires the QR label. New regressions cover existing photo-draft and cross-tab warehouse protections.

Scope: `docs/plans/ux-flow-fixes-2026-10-15.md`. No automatic role grants or changes to simple-batch dimension policy.

Validation: navigation contract/fixtures, formatting, Bun/TypeScript 7 checking, TypeScript 6 checking, ESLint, Convex code generation, test discovery, and clean-tree checks passed. Targeted coordinator replay passed FG 147, storage 171, and HR 47 cases. The combined local Vitest run passed 4,921 cases and reproduced one pre-existing process-cancellation timing failure also recorded on unchanged main; that suite passed all 8 cases when rerun alone. All three CI test shards, all four browser suites, and every mandatory quality/security gate passed on the reviewed head: [Planner quality](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38763334030), [CodeQL](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38763334492).

The first Codex review caught a History date-editing regression; Kiro corrected it and strengthened EN/TH Back/Forward/remount coverage. Independent final reviews at `5e58673b` both passed: Standards — no verified violations or actionable smells; Spec — no unresolved actionable findings.

Browser fixtures exercised photo retention and mobile/desktop warehouse selection and recovery with production components and substituted transport/context. These checks do not claim authenticated production writes or physical-camera verification. The guarded JobScan Forward limitation predates this change; its no-guard Forward test is supplemental only.
