# Plan: AI usage layout and automatic daily estimates

Date: 2026-10-11

## Requested outcome

Match the supplied desktop and mobile reference layouts for AI usage. Preserve the existing usage ledger, authorization, filtering, CSV export, and cost completeness semantics. Use Kiro for implementation, then independently review the code, inspect screenshots, fix discrepancies, verify again, and open a PR against main.

The preview annotations take precedence over the manual settings fields pictured in the examples: exchange rates and funding fee estimates should load automatically and cache for one day; warehouse context belongs in the sidebar; the theme control should be a compact icon button. Improve English and Thai copy.

## Layout acceptance criteria

- Compact header with sidebar/menu control, a clear organization brand, language selector, and one theme icon button. Put selected warehouse code/name and switching in sidebar, preserving workspace switching permissions and empty states. Do not cram warehouse text into the mobile header.
- Page title and short subtitle, followed by period picker, icon filter button, date/timezone, and right-aligned export. On phones keep the picker/filter/export in one row where possible, with the range below.
- Three open summary columns separated by fine rules: confirmed USD cost with baht equivalent, estimated total, and coverage. Use the reference's blue/teal icons and strong values without boxed card shells. Keep unknown/pending costs distinct from zero and keep completeness warnings visible.
- Feature counts in one horizontal strip on desktop and three separated rows on mobile: job ticket photos, location label photos, AI search. Each row/count can apply its feature filter; preserve metric details accessibly when useful.
- Usage breakdown and recent activity follow in this order. Always retain column headers and a centered document icon/empty message when empty. Mobile tables scroll horizontally within their section, never widening the page. Preserve nonempty data, pagination, timezone, expandable attempt details and export accuracy.
- Replace the editable Baht settings form with a small read-only automatic estimate section containing rate, funding fee estimate, source and date/status. No save action or user-entered rate/fee/source.
- Preserve light/dark tokens, meaningful loading/error states, keyboard operation and readable Thai labels. Target desktop 1440px, phone 390px and medium-width 539px; use screenshots to compare topology, alignment, density and hierarchy.

## Automatic data and caching

- Fetch USD/THB server-side from `https://api.frankfurter.dev/v2/rate/usd/thb`, validated as USD/THB with finite positive rate and valid date. Documentation: https://frankfurter.dev/.
- Fetch published card funding policy server-side from `https://openrouter.ai/docs/faq.md`. On 2026-10-11 its `getTotalFeeString` stripe branch publishes `5.5% ($0.80 minimum)`. Parse narrowly and validate; never execute MDX. Documentation: https://openrouter.ai/docs/faq.md.
- OpenRouter's credits API reports total credits and usage, not an actual top-up fee. Label the percentage as an estimate based on card funding policy; explain the minimum purchase fee and that actual charges vary by purchase/payment method. Do not imply that adding the percentage to inference is an actual invoice.
- Cache upstream data persistently for 86400 seconds using documented Next.js APIs or the existing backend's durable cache; avoid a browser-only or process-only cache. Deduplicate/constrain refreshes. Show source dates and check times in the UI; retain the cache version and timestamps in CSV. Read relevant installed Next.js guides before changes.
- Protect report access with existing organization permissions; no server credentials reach the browser. Do not share tenant usage in a global cache. Automatic configuration should work for read-only usage readers too. Ensure CSV freezes the same estimate snapshot visible at export start.
- On timeout, invalid payload or upstream failure, preserve confirmed USD and show unavailable/stale estimate status honestly. No fabricated rate, zero fee substitution or fallback to old manually saved settings presented as automatic data.

## Implementation and verification

1. Work only in this isolated worktree; leave original workspace changes intact. Kiro must inspect AGENTS.md, local Next.js docs, design tokens, current components and supplied PNG references before editing.
2. Implement scoped backend data/cache, automatic UI, responsive report layout, header/sidebar/theme and localized copy. Add meaningful regression coverage for invalid upstream data, cache behavior, snapshot export, permissions and unknown costs; update affected existing tests.
3. Run formatting, typecheck, lint, relevant unit/integration tests and production build as appropriate. Independently audit the complete diff for authorization, caching, monetary semantics and responsive regressions.
4. Run real app or a faithful development fixture importing actual production components. Capture desktop/mobile, light/dark and English/Thai states through T3 preview; distinguish fixture evidence from authenticated runtime evidence. Compare against supplied images, fix all observed issues, repeat as necessary until retained layout matches. Record results and screenshots under docs/reviews.
5. Commit scoped changes and evidence, push the branch, create a reviewable PR against main and register it with this T3 thread. Report checks and any material limitations candidly.

## Status

- Kiro implementation complete, followed by independent code and screenshot audits and fixes.
- Daily sources, unavailable/stale handling, frozen CSV, retired manual configuration, reference report structure, sidebar warehouse context and compact theme button implemented.
- Desktop, phone and medium-width screenshots verified in English/dark and Thai/light; populated, unavailable, stale and sidebar states captured. The report keeps the references' layout structure; the annotations replace the manual settings form and warehouse header.
- Final verification: formatting, pinned Bun typecheck, zero-warning lint, 254 test files / 3,054 tests, production build and credential-free Convex codegen passed. See [review and screenshots](docs/reviews/ai-usage-layout-2026-10-11.md).
- Delivery branch: `codex/ai-usage-layout-daily-rates-20261011`, targeting `main`. Original workspace changes remain untouched.
