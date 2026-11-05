# UI improvement loop: whole app, staged

Date: 2026-11-04 · Status: in progress (Stages 1–4 approved for this run) · Owner: Rugby

Runner update (2026-11-05, product owner): use **Codex and Kiro CLI only** because the direct Claude quota is exhausted. Codex orchestrates and runs gpt-6.1-sol audits; Opus 5.5 runs only through Kiro CLI. Do not launch Claude Code or direct Claude-provider agents. Preserve the existing independent audits and scoring gates. The verified Kiro executable is `/Users/macbook/.local/bin/kiro-cli`; the older `/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat` path is absent.

## Goal

Raise every Yongkit screen to **9/10**, measured against comparable products, in two phases per stage:

1. **Phase 1 (sol gate):** loop until gpt-6.1-sol scores every screen in the stage ≥ 9.
2. **Phase 2 (dual gate):** keep looping until Opus 5.5 **and** gpt-6.1-sol both score every screen ≥ 9.

Once a stage scores ≥ 8, produce an **annotated before/after screenshot set every 2 loops**. Each set explains what changed and why.

> **Size warning.** About 55 routes in 7 stages, at an expected 5–8 loops per stage, is roughly 35–55 loops. At 30–50 minutes per loop, that is 25–45 hours of agent time. Run it **one stage at a time**, with a review checkpoint after each stage. Do not start all stages at once.

## Inputs

| Input                    | Path                                                   | Role                                                                                |
| ------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Product context          | `PRODUCT.md`                                           | Users, constraints, naming                                                          |
| Design system            | `docs/plans/design-system.md`                          | Type scale, spacing, 48 px targets, status colours                                  |
| Competitive benchmark    | `docs/research/ui-competitive-benchmark-2026-11-04.md` | Reference patterns per module and the "Audit rubric anchors" auditors check against |
| Rubric                   | `./rubric.md`                                          | Scoring, severity, score caps. Frozen after calibration                             |
| Decisions                | `./decisions.md` (created in Stage 0)                  | Accepted product decisions that auditors must not penalise                          |
| Back-navigation contract | `docs/contracts/back-navigation.{md,json}`             | Every route/foreground change must keep passing it                                  |

## Stages

Order: shared shell first, because it appears in every screenshot. Phone-first warehouse work comes next, then the rest.

| #   | Stage                        | Screens (routes under `/[locale]`)                                                                                                                                                                      | Primary viewport | Compare against (from research)                                              |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| 1   | Shell, navigation, AI Search | Sidebar (desktop + mobile drawer), header/context bar, locale switcher, AI Search dialog (empty, results, AI answer), not-found, error                                                                  | both             | Linear, Vercel, Raycast, GitHub command palette                              |
| 2   | Warehouse scanning           | `finished-goods/scan` (location step, ticket intake, blocker, save), `scan/records`, `packages/scan`                                                                                                    | 390 × 844        | Odoo Barcode, SAP Fiori, SAP EWM RF, Katana, Sortly, ML Kit camera reference |
| 3   | Warehouse records            | `finished-goods`, `new`, `products/[id]`, `products/[id]/packing`, `batches/[id]`, `pallets/[id]` (+ `move`, `storage`, `measure`, `stack`)                                                             | both             | Odoo lots/locations, NetSuite bins, Sortly                                   |
| 4   | Storage layouts              | `master-data/storage-layouts`, `new`, `[buildingId]`, `floors/[floorNumber]`, `review`                                                                                                                  | 1440 × 900       | Odoo locations, SAP EWM bins + graphical layout, Fishbowl                    |
| 5   | People: self-service         | `hr`, `today`, `time`, `time/[date]`, `leave`, `leave/[id]`, `requests`, `requests/[id]`, `payslips`, `payslips/[rowId]`, `announcements`, `announcements/[id]`, `profile`, `notifications`, `holidays` | 390 × 844        | BambooHR, Personio, HiBob, empeo (features only)                             |
| 6   | People: administration       | `review`, `leave/review`, `leave/review/[id]`, `employees`, `periods`, `periods/[id]`, `time/periods`, `time/periods/[versionId]`, `payslips/import`, `announcements/manage`, `settings`, `customize`   | 1440 × 900       | BambooHR approvals, Gusto, Personio, HumanSoft, Prosoft (features only)      |
| 7   | Administration and public    | `ai-usage`, `setup`, `sign-in`, `about`, `privacy`, `terms`                                                                                                                                             | both             | OpenAI usage, Anthropic Console, Vercel usage, Clerk analytics               |

`storage-layouts/demo` and `[...rest]` are out of scope.

## Stage 0: setup (once, before Stage 1)

1. **Clean base.** `wip/hr-search-shell` has uncommitted brand-rename and search work that touches public pages, icons and the manifest. Land or park it first, then branch every stage from `main` in its own worktree: `ui-loop/s<N>-<slug>`.
2. **Capture harness** (`scripts/ui-loop/capture.mjs`, new). It reuses the Clerk sign-in-token → `storageState` pattern from `scripts/performance/measure.mjs`. It then:
   - runs against the local stack (`pnpm dev`) with seeded data (`ALLOW_LOCAL_TEST_SEED=true pnpm dev:seed --hr`, plus `--pagination` for long lists);
   - reads a per-stage `screens.json` (route, persona, state setup steps, viewports);
   - writes screenshots, an accessibility snapshot, axe results, console errors and horizontal-overflow checks to `output/ui-loop/s<N>/loop-<k>/` (gitignored);
   - uses a Chromium fake camera feed built from `scripts/generate-job-scan-test-assets.py` output for scan screens.
3. **Personas.** Confirm the local seed provides an org admin, a warehouse worker, an HR employee (self-service only) and an HR reviewer. Add any that are missing to the local seed. Self-service screens must be judged as an employee sees them, not as an admin.
4. **States per screen:** populated, empty, loading (network-throttled capture) and error/blocked where a path exists. Long Thai names come from the pagination seed.
5. **Calibration.** Run the sol auditor **twice** on the unchanged Stage 1 baseline, and the Opus auditor once. If the two sol runs differ by more than 1 point on any screen, tighten the rubric anchors and repeat. Then freeze `rubric.md`.
6. **Decisions file.** Seed `decisions.md` with standing product decisions. Example: never reject AI Job-number reads by FO/FOM pattern; use the barcode cross-check. Auditors receive it, so known decisions are not scored down every loop. **Needs your call first:** the benchmark expects the main scan button to have a text label, which departs from SAP Fiori's icon-only rule. Confirm or reject it before Stage 2.

## The loop (one iteration)

```
capture ─▶ audit ─▶ triage ─▶ implement ─▶ verify ─▶ commit + ledger ─▶ (annotate?) ─▶ next
```

| Step            | Who                                                                        | What                                                                                                                                                                                                                                                                                               |
| --------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture         | script                                                                     | `capture.mjs --stage N --loop k`. Matrix each loop: Thai × {390, 1440} × light × all states.                                                                                                                                                                                                       |
| Audit           | Phase 1: gpt-6.1-sol. Phase 2: gpt-6.1-sol **and** Opus 5.5, independently | Blind audit. Inputs: rubric, benchmark section for the module, PRODUCT.md, design system, decisions, screenshots, a11y/axe JSON and read-only source. **Not given:** implementer notes or earlier scores. Output: JSON per `rubric.md` → `audit-<model>.json`.                                     |
| Triage          | orchestrator (Codex, main session)                                         | Merge findings. Accept up to ~8 per loop (P0 → P1 → P2). Reject findings that conflict with PRODUCT.md, the navigation contract or decisions, and log the reason. **Behaviour changes** (scan routing, validation, data rules) go to the user; they are not auto-implemented.                      |
| Implement       | Codex or Kiro CLI in the existing stage worktree                           | Fix accepted findings using existing components (PageHeader, EmptyState, Notice, StatusBadge, Dialog/Sheet). Record each change as `{screen, locator, summary, findingId}` for annotation. Must not edit the rubric, benchmark, decisions, capture script, seed or test expectations just to pass. |
| Verify          | script                                                                     | `pnpm typecheck`, `pnpm lint`, Vitest for touched features plus `test:a11y`. Add `pnpm check:navigation` when routes or foregrounds change. Capture-time checks: 0 console errors, 0 page overflow at 390, 0 serious/critical axe issues. Failures are fixed before the next audit.                |
| Commit + ledger | orchestrator                                                               | One commit per loop: `ui-loop(s<N>, loop <k>): …`. Append to `stages/s<N>/ledger.json`: commit, per-screen scores per auditor, fixed / rejected / deferred findings, checks.                                                                                                                       |

**Stage score** = the **lowest** screen score in the stage; the median is reported alongside. A stage passes a gate only when every screen meets it. In Phase 2, each auditor's minimum is tracked separately, and both must be ≥ 9.

### Annotated screenshots (from score ≥ 8)

- **When:** at the first loop where the stage score reaches 8 (loop _m_), then at _m_+2, _m_+4, …, plus once at each gate pass (sol 9, dual 9).
- **What:** for each screen that changed since the previous annotated set (or since the baseline, for the first set): a side-by-side **before | after** at the same viewport. The after image carries numbered markers anchored to each changed element: the capture script resolves the recorded locator to a bounding box and draws an outline and a badge. A legend explains each marker: _what changed · why (finding ID, auditor, benchmark product) · score change_.
- **How:** Playwright only, so no new dependencies. Markers are drawn on the live page; an HTML template then composes before/after and legend, and Playwright screenshots it to PNG.
- **Where (committed):** `docs/plans/ui-improvement-loop-2026-11-04/stages/s<N>/annotated/loop-<k>-<screen>.png`, plus `stages/s<N>/index.html`. That gallery lists all sets with the score timeline.

## Gates and stopping rules

| Rule                           | Action                                                                                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 passes (sol min ≥ 9)   | Run the Opus audit on the same commit, then enter Phase 2.                                                                                                                                                                                                       |
| Phase 2 passes (both min ≥ 9)  | **Gate check:** re-capture with English + dark mode added. If any screen drops below 9, continue Phase 2. Otherwise run Codex interactive browser QA of the stage's real flows (Back, Close/Cancel then Back, direct links, drafts, refresh), then `pnpm check`. |
| Stage done                     | Stop. Show the user the gallery and score timeline. Open the stage PR only after the user approves.                                                                                                                                                              |
| Loop budget                    | Phase 1: at most 6 loops. Phase 2: at most 4 loops. If exceeded, stop and bring the blocking findings to the user.                                                                                                                                               |
| Plateau                        | Stage score unchanged for 2 loops: stop and escalate. Usually a product decision or an auditor disagreement.                                                                                                                                                     |
| Regression                     | Any screen drops ≥ 1 point: fix the regression first in the next loop.                                                                                                                                                                                           |
| Auditor disagreement (Phase 2) | When findings conflict (e.g. denser vs. sparser), the orchestrator decides from PRODUCT.md and the benchmark. The decision goes into `decisions.md`, so both auditors see it next loop.                                                                          |
| Score noise                    | A score jumps ≥ 2 with no related change: re-run that audit once and keep the lower score.                                                                                                                                                                       |

## Running it

- **Default:** orchestrate from the main Codex session, one stage per run. Capture and gpt-6.1-sol audits run through Bash: `codex exec -c model="gpt-6.1-sol" -s read-only -i <screens…> --output-schema audit.schema.json -o audit-sol.json`, in the background with an explicit timeout, one call per group of ≤ 12 images. The Opus implementer and independent Opus auditor run through Kiro CLI only, using `claude-opus-5.5 --effort high`.
- **Optional:** one Workflow script per stage phase. Say "run it as a workflow" to opt in. A phase is about 2 agents per loop × 4–6 loops, which fits the under-10-agents guideline.

## Exit criteria (whole plan)

All 7 stages pass the dual 9/10 gate in Thai/English and light/dark, with the navigation contract and `pnpm check` green. Each stage has a gallery of annotated before/after sets and a merged PR.

## Open risks

- **Scores are model judgments.** Calibration, severity caps and blind audits reduce the noise but do not remove it. Real-device and field checks with warehouse workers stay out of scope unless added.
- **Camera realism.** Scan screens use a fake camera feed, so decoder timing and glare are not represented.
- **HR parity work in flight.** Some HR routes from `docs/plans/hr-parity` are still `test.fixme`. Stages 5–6 cover only routes that exist when each stage starts.
