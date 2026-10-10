---
version: 1
slug: "ai-usage"
primary_target: "src/features/aiUsage/AiUsageScreen.tsx"
related_targets: ["src/app/[locale]/(desktop)/ai-usage"]
---

# AI usage reporting

Mode: Operate. A scoped extension of the incumbent application. The user requested real AI usage tracking in a new worktree and confirmed **this month** as the default report period, with cumulative spend and average per photo. Organization administrators review image scans and AI Search separately. Thai and English; desktop and mobile.

## Direction contract

THESIS: Show actual AI calls and their confirmed costs without adding steps to scanning.
OWN-WORLD: Preserve the app shell, sans-serif typography, black/white surfaces, subtle borders, existing controls, panels and blue actions. Existing source is the visual authority; no identity or token changes.
STORY: Choose a period, compare job-ticket photos, location-label photos and AI Search, inspect user/warehouse/model contributions and recent operation outcomes, and export detailed attempts. USD is authoritative; THB and the funding fee are estimates using only the administrator-saved FX rate and fee (5.5% in the designated QA settings, never fixed in code).
FIRST VIEWPORT (selected Design 1): a compact toolbar with the period selector (this month by default), a Filters button opening the existing Sheet, and Export CSV; the real date range, timezone and tracking start. Then a statement strip with the confirmed USD total, the estimated THB total including the configured funding fee with inference and fee labelled separately, and unknown/pending coverage. Below it, one card each for job-ticket photos, location-label photos and AI Search: counts, provider calls and retries, confirmed cost, the fully-priced average and coverage. Counts are never combined across features. Totals sum the features shown and are labelled as filtered when any filter applies. Mobile stacks the strip and cards; filters use the same Sheet.
LOWER REPORT: the average/estimate note, the user/warehouse/model contribution breakdown, Recent activity and, for configurers, baht estimate settings.
FORM: The user selected Design 1 of a throwaway three-layout prototype; production reimplements only that design on the real summary and export APIs. No prototype switcher, sample data or alternatives.
FINISH: Valid desktop/mobile evidence, independent finish review and incumbent-system documentation.

## Quality bar

- Preserve incumbent appearance and all surrounding workflows.
- Real provider usage appears before Save; retry counts cannot inflate photo counts. Location-label photos keep their own classification.
- Month boundaries use organization timezone. Unknown cost is distinct from zero.
- USD and estimated THB are clear; no assumed FX rate or fee. Without saved settings the strip says baht is not estimated.
- Averages use only fully priced operations. The incomplete-summary warning and tracking start stay visible above the totals.
- Filters, settings, CSV and permission-denied states work; narrow mobile pages have no horizontal overflow.

## Evidence

The local report contains one real synthetic photo extraction and one real AI Search call. The FX source is explicitly a local QA estimate. Seeded business data and accounts are designated local test fixtures. The shell uses an internal scrolling main pane, so paired top/lower captures represent the real app instead of changing its scroll architecture for evidence.
