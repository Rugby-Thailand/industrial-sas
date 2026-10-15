# UX flow corrections — 15 October 2026

## Scope and baseline

The user requested multiple Kiro implementation agents, an independent Codex audit with correction loops, a PR, and merge after passing checks. The originating review examined an older local working tree. All findings must be revalidated against pinned base `faca0cf5927dbe3e72da572cf1290d57d7d91511`; retain newer behavior already shipped on main. This spec records the review requirements without importing unrelated local work or intentionally failing audit probes.

Upstream integration baseline: `b62999f1efa86ecaf43d6d40a175fc5de27dad8f` includes the subsequent floor-map readability fix (#98); retain it when combining the isolated fixes.

## Acceptance criteria

- **FG-UX-01:** Simple dimensionless packing has a usable pallet-label-to-placement path. Scan Packages opens the package workflow; existing measurement and batch restrictions remain consistent.
- **FG-UX-02:** Unsent photos are retained or explicitly guarded across intake mode changes, foreground closure, and navigation. Preserve existing nested camera Back/Forward behavior.
- **FG-UX-03:** Barcode-image intake exposes feedback and announces refusal when the ticket group reaches its 50-item limit.
- **FG-UX-04:** Manual unit-code entry matches backend case-insensitive behavior; SCAN verification still requires the matching QR.
- **FG-UX-05:** A warehouse change in another tab does not silently discard or reassign unsent tickets/photos. The old same-tab header-switch claim was not an established user path.
- **SS-01:** A detail/task direct link with no selected warehouse offers selection and retains its target. Existing task drafts remain protected.
- **SS-02:** Missing/failed storage building or review views retain a local safe Back/parent recovery; transient failures offer a usable retry where appropriate.
- **SS-03:** Loading and no-accessible-warehouse states are distinguished from a missing organization.
- **SS-04:** A warehouse with no buildings and no active filter shows first-use copy, distinct from an empty filtered result.
- **SS-05:** Successful compact location create/edit closes using the live write completion owner, shows a receipt, and does not trigger a false dirty prompt or dead next-Back step.
- **K-UX-HR-01:** Employee/supervisor linking identifies missing HR access and provides an authorized handoff to the existing access settings. Linking must not automatically grant roles.
- **K-UX-HR-02:** Review decisions retain a stable receipt when reactive queries remove the completed form, including Return, Certify, and disposition paths.
- **K-UX-HR-03:** Attendance History period/filter and Requests status/page survive detail navigation and return/remount, with locale/query/hash preserved.
- **K-UX-HR-04:** Returned-correction feedback is visible before editing. Preserve existing proposal/original-punch initialization semantics; changing that policy is outside this repair.
- **K-UX-HR-05:** Employee save provides modest visible success feedback. This was an optional UX observation, not evidence of failed persistence.

## Verification and constraints

For each finding, record either a scoped fix with regression evidence or evidence that current main already satisfies it. Follow AGENTS.md and the Back navigation contract, including exact inventory declarations and real caller evidence. Tests should exercise relevant production callers or handlers, with hardware/network substitutions stated. Keep English/Thai copy and accessibility intact. No silent privilege expansion, new product modules, unrelated dependency changes, or imported uncommitted work.

Run relevant caller regressions, navigation gate, formatting, both pinned type checkers, lint, and full tests. Required GitHub CI/security checks must pass on the mergeable PR head. Codex reviews standards and this spec separately; Kiro addresses actionable findings and Codex re-audits until no unresolved blocking issues remain. Browser fixture evidence is explicitly distinct from authenticated production end-to-end verification.
