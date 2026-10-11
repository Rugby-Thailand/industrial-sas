---
version: 2
slug: "ai-usage"
primary_target: "src/features/aiUsage/AiUsageScreen.tsx"
related_targets: ["src/app/[locale]/(desktop)/ai-usage"]
---

# AI usage reporting

Mode: Operate. A scoped extension of the incumbent application. The user requested real AI usage tracking in a new worktree and confirmed **this month** as the default report period, with cumulative spend and average per photo. Organization administrators review image scans and AI Search separately. Thai and English; desktop and mobile.

## Direction contract

THESIS: Show actual AI calls and their confirmed costs without adding steps to scanning.
OWN-WORLD: Preserve the app shell, sans-serif typography, black/white surfaces, subtle borders, existing controls, panels and blue actions. Existing source is the visual authority; no identity or token changes.
STORY: Choose a period, compare job-ticket photos, location-label photos and AI Search, inspect user/warehouse/model contributions and recent operation outcomes, and export detailed attempts. USD is authoritative; THB and the funding fee are estimates from the automatic daily USD/THB reference rate and OpenRouter's published card funding policy (5.5%, US$0.80 minimum on 2026-10-11), each cached for one day, never fixed in code and never user-entered. Long-open reports automatically refresh after expiry with a bounded retry.
FIRST VIEWPORT (2026-10-11 reference layout, supersedes Design 1's boxed cards): a compact header with the menu control, the organization name as brand, the language selector and one theme icon button; warehouse code/name and switching live in the sidebar, never the phone header. The report uses offcanvas desktop navigation so its content spans the reference width; other routes retain the icon rail. Title and short subtitle, then one toolbar row: period picker with calendar icon, filter icon button (count badge when filtered), the date range and timezone, and right-aligned Export CSV; on phones picker/filter/export share the first row and the range wraps below. Three open summary columns separated by hairlines, each with a tinted icon disc (blue dollar, teal chart, teal shield): confirmed USD with ≈ baht, estimated total with inference and fee estimate parts, and coverage with an info tooltip. No card shells. A feature strip: one horizontal row of three on desktop, three separated rows on phones; each entry is a toggle that applies its feature filter.
LOWER REPORT: Usage breakdown (with range and timezone) and Recent activity (time ↓, expandable call details) as headed tables that keep their headers and a centred document icon when empty and scroll inside their section on phones; then the read-only Automatic baht estimate section (rate and date, fee percent and minimum, source links, check time/status, last-updated time and the estimate explanation). No settings form or save.
FORM: The user selected Design 1 of a throwaway three-layout prototype; production reimplements only that design on the real summary and export APIs. No prototype switcher, sample data or alternatives. This precisely specified local extension is exempt from a concept roll under `reference/new-work.md`: “Never run the script for a local extension or a precisely specified narrow request; shape those directly.” No seed is required or claimed.
FINISH: Valid desktop/mobile evidence, independent finish review and incumbent-system documentation.

## Quality bar

- Preserve incumbent appearance and all surrounding workflows.
- Real provider usage appears before any ticket save; retry counts cannot inflate photo counts. Location-label photos keep their own classification.
- Month boundaries use organization timezone. Unknown cost is distinct from zero.
- USD and estimated THB are clear; no assumed FX rate or fee. When a source is unavailable or stale the strip and estimate section say so; a missing fee is never shown as 0%.
- Averages use only fully priced operations. The incomplete-summary warning and tracking start stay visible above the totals.
- Filters, the automatic estimate, CSV and permission-denied states work; narrow mobile pages have no horizontal overflow (tables scroll inside their section).

## Evidence

The local report contains one real synthetic photo extraction and one real AI Search call. The FX source is explicitly a local QA estimate. Seeded business data and accounts are designated local test fixtures. The shell uses an internal scrolling main pane, so paired top/lower captures represent the real app instead of changing its scroll architecture for evidence.

The 2026-10-11 layout pass is evidenced by the loopback visual fixture (`pnpm preview:ai-usage`, production components with in-memory sample data); see `docs/reviews/ai-usage-layout-2026-10-11.md`. Fixture captures are not authenticated runtime evidence.
