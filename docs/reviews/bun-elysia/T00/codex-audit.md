# T00 Codex audits and fixes

Base originally ca8c296b2364fcbca33df81a5b18f9e1a213ac16; final integration base 9675ae7b77c7e2a1369e4ef5c520531e14b8d823. Independent standards and specification reviewers inspected the scoped documentation; no runtime or source changes proposed.

## Standards

- Fixed missing Python fixture-generator Node/Playwright and pnpm/Convex children in the command manifest (T06/T19 inventory).
- Fixed Clerk provider attribution: production operators set Convex admin identity; guarded dev-login actually calls Clerk Backend APIs.
- Fixed formatting of coordinator external-prerequisites.md.
- Reviewer verified all 20 source hashes and unchanged asset measurements after documented path normalization. Local links resolved; installed Next links intentionally require dependencies.

## Specification

- Fixed Phase 2 gates to preserve historical guarantees through current delivered commands, including both guarded audit scopes and explicit release-contract coverage.
- Explicitly applied the required Kiro Opus 5.5/high → Codex audit/fix → Kiro refactor → final Codex verification cycle to Phase 2, with independent separate-worktree performance reproduction before PR.
- Coordinator fixed inappropriate cross-base git-diff hash equality and required preservation of relevant AI scenarios when obsolete tests have no current target.
- Recorded normal frozen root install probe (exit 0, clean dependency directory, warm store, unchanged manifests).
- Fast-forwarded to latest main and repeated discovery: 248 Vitest files / 2,965 collected cases, 11 Playwright specs. Original ca8c296 manifests remain historical, with integration-checks.json for the new base.

## Remaining verification

Kiro scoped refactor, Codex final audit/checks, exact-head protected PR checks and automatic merge/release verification remain pending. Tests were discovered, not executed locally for this docs-only task. T00 does not deliver Bun/Elysia runtime changes. Provider configuration is for later per the user's clarification. Rollback is a protected documentation revert.
