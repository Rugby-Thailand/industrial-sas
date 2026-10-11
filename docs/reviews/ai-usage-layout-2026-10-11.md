# AI usage layout and daily estimate review

Baseline: `d07f6282` (`origin/main`) in an isolated worktree. The original workspace's in-progress Bun/Elysia and AI Search changes are outside this PR.

## Reference and scope

[Desktop reference](assets/ai-usage-layout-20261011/reference-desktop.png) and [phone reference](assets/ai-usage-layout-20261011/reference-mobile.png) define the desktop and mobile report structure: open summary columns, feature count strip/rows, visible empty table headers, and fine section rules. The annotations supersede the pictured editable settings form: automatic daily cached rate and funding policy, warehouse controls in the sidebar, compact theme button, and clearer English/Thai copy.

Before evidence was captured from the authenticated deployed report through the T3 collaborative preview:

- [Desktop, dark](assets/ai-usage-layout-20261011/before-desktop-dark.png)
- [Phone, dark](assets/ai-usage-layout-20261011/before-mobile-dark.png)

## Data sources

- [Frankfurter documentation](https://frankfurter.dev/) and `https://api.frankfurter.dev/v2/rate/usd/thb` provide daily USD/THB reference rates. A direct request on 2026-10-11 returned the USD/THB pair with a source date and positive numeric rate.
- [OpenRouter's published FAQ source](https://openrouter.ai/docs/faq.md) exposes its card funding policy in the `stripe` branch of `getTotalFeeString`. On 2026-10-11 it states 5.5%, with a US$0.80 minimum. The percentage estimates allocated funding overhead; it is not the actual fee of a top-up or a provider inference charge.
- [OpenRouter credits API](https://openrouter.ai/docs/api/api-reference/credits/get-credits) returns total credits and usage, without a top-up fee field. No undocumented billing API or management key is used to invent an actual fee.

## Independent review and evidence

The initial data-loader pass was independently exercised: 44 tests passed, covering day-long reuse, concurrent loads, invalid payloads, timeouts, independent failures, stale cache recovery, and absence of tenant credentials in upstream requests.

## Implementation

- **Automatic estimate.** `src/lib/aiUsage/estimateSources.ts` parses and validates both sources (exact USD/THB, finite rate in (0, 1000), real date not after tomorrow; exactly one stripe branch inside `getTotalFeeString`, matched as text). `estimateLoader.ts` caches each source separately with `unstable_cache` for 86,400 s under versioned keys, deduplicates concurrent requests per process, applies a 4 s deadline, a 512 KiB limit and a 10-minute failure back-off, never caches a failure and re-validates cached values. The AI usage page (a Server Component) streams the snapshot to the report; no credential or tenant data is involved.
- **Backend.** `summary` no longer returns saved settings. `configure` stays registered for previous-frontend tabs, writes nothing and answers `SETTINGS_RETIRED`; the public contract snapshot is unchanged. `aiCostSettings` rows remain as history and are never read as automatic data.
- **Report layout.** Toolbar (period with calendar icon, filter icon button with count badge, range and timezone, right-aligned Export CSV; range wraps below on phones); three open summary columns with icon discs and hairline dividers; a feature strip whose entries toggle the feature filter; Usage breakdown (six columns, feature as row detail) and Recent activity (expandable call details) as headed tables with a centred document-icon empty row and in-section horizontal scroll; the read-only Automatic baht estimate section. The settings form is deleted.
- **Money semantics.** Unknown cost is never zero; partial totals keep their warnings. A missing fee policy shows the estimated total as _Not estimated_ (the baht equivalent of confirmed USD remains under the first column); it is never computed at 0%. Stale sources are labelled, including a page left open past the refresh window. A long-open page refreshes the server snapshot at source expiry and retries unavailable/stale sources at most once per ten minutes, preserving filters and scroll; fake-clock tests cover expiry, focus deduplication and cleanup. All displayed timestamps use the organization timezone. CSV freezes the snapshot visible when export starts and records version, load time, both values, dates, fetch times, statuses and source URLs.
- **Shell.** The header holds the menu control, the organization name, language selector and one ghost icon theme button (`aria-pressed`). Warehouse code/name moves to the sidebar: a selector on the storage and finished-goods pages (as before), read-only code/name elsewhere, nothing without storage access, and one rail icon that expands the collapsed sidebar. AI usage hides the desktop rail offcanvas for the reference's full-width report; other routes retain their rail. The hidden report sidebar is inert and hidden from assistive technology until expanded. Phone search remains in the sidebar.

The earlier open items are resolved: the breakdown keeps the reference's six columns; the empty-row message is sticky-centred in the visible scroll area; a missing funding policy is distinct from a zero or inference-only total; icon discs sit left of each summary column as in the references.

## Final verification

Run independently in this worktree on 2026-10-11 after the audit fixes:

| Check                                   | Result                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm check`                            | Formatting, pinned Bun 1.4.3 / TypeScript 7.0.2, zero-warning lint, and 254 files / 3,054 tests passed |
| `pnpm build`                            | Credential-free production build passed; AI usage is dynamic                                           |
| `pnpm ci:codegen`                       | Credential-free loopback check passed; generated files unchanged                                       |
| `git diff --check`                      | Passed                                                                                                 |
| Impeccable detector, changed UI targets | No findings (`[]`)                                                                                     |

Coverage includes independent source validation/cache failure handling, organization permissions and tenant isolation, frozen CSV/export cancellation, unknown versus zero costs, filters and report states, retired configuration, theme/sidebar behavior, and automatic daily refresh/retry cleanup.

## Visual fixture

`pnpm preview:ai-usage` (loopback 127.0.0.1:3191, see `scripts/ai-usage-preview/README.md`) renders the production shell, providers and report with in-memory sample data. Only `convex/react`, `@clerk/nextjs`, `next/navigation`, `next/link` and `@/i18n/navigation` are replaced; there is no sign-in, auth bypass, backend, upstream request or write. Verified without a browser: Vite resolves and transforms all 100 modules with no errors, none of them the real Convex client, and the same tree rendered in jsdom in English and Thai with zero console errors.

### Screenshot comparison and fixes

Kiro implemented from the supplied PNGs; Codex then independently compared actual browser captures through T3. The first pass found undersized headings, phone summary icons above values, excessive empty-state explanations, extra table columns, and a persistent desktop rail. The fixes keep the reference's open report structure: large heading, one toolbar, three summary columns, desktop feature strip/phone rows, six-column breakdown, seven-column recent activity, centered document empty states, and fine section rules. Feature and status information remain in row detail. The read-only estimate replaces the reference's editable form as requested.

| Evidence                                                                                                                                                                        | Viewport / state                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [Desktop](assets/ai-usage-layout-20261011/after-desktop-dark.png)                                                                                                               | 1440 × 1240, English/dark, complete report                                |
| [Phone](assets/ai-usage-layout-20261011/after-mobile-dark.png)                                                                                                                  | 390 × 1800, English/dark, extended viewport for the full report           |
| [Medium Thai](assets/ai-usage-layout-20261011/after-medium-thai-light.png)                                                                                                      | 539 × 1550, Thai/light                                                    |
| [Sidebar](assets/ai-usage-layout-20261011/after-mobile-sidebar-light.png)                                                                                                       | 390 × 844, English/light, warehouse context in menu                       |
| [Populated report](assets/ai-usage-layout-20261011/after-desktop-populated-dark.png) and [lower report](assets/ai-usage-layout-20261011/after-desktop-populated-lower-dark.png) | 1440 × 1140, synthetic usage, pending/unknown cost and operation outcomes |
| [Unavailable sources](assets/ai-usage-layout-20261011/after-medium-unavailable-dark.png)                                                                                        | 539 × 1550, no storage access, confirmed USD preserved                    |
| [Stale sources](assets/ai-usage-layout-20261011/after-medium-stale-dark.png)                                                                                                    | 539 × 1550, source check times and stale labels                           |

Measurements confirmed page width equals viewport width at 390, 539 and 1440 px, table column counts are six/seven, and empty icons center at x=720 on a 1440 px viewport. Desktop section headings start at x=36; breakdown y≈491, activity y≈729 and estimate y≈967, close to the reference's rhythm. Table overflow remains inside focusable scroll regions. Normal 390 × 844 interaction checks verified theme switching, menu open/close, filter sheet selection and locale switching to Thai. The reference structure is matched; the automatic estimate, organization header and compact theme button intentionally follow the annotations.

All **after** images render production components with synthetic in-memory providers and the fixture label. They are visual fixture evidence, not authenticated deployment/cache evidence. The **before** images are from the signed-in deployment. Initial failed preview interactions during overlay transitions were retried after the overlay settled; final menu/filter/language actions succeeded.

## Limitations

- No authenticated-runtime or deployed verification; the live upstream sources were read once (2026-10-11: 33.583 THB/USD, 5.5% with US$0.80 minimum) but the production data cache is untested.
- On Vercel the data cache is shared and durable; a self-hosted multi-instance deployment would need a shared cache handler for the one-per-day bound to hold across instances.
- OpenRouter could change the FAQ wording; the parser then reports the policy unavailable rather than guessing.
- `aiUsage.configure` remains provisioned but no longer grants anything in the report.

## Compact estimate follow-up

The estimate now starts as one “Baht estimate” disclosure row. Click or keyboard activation opens/closes the rate, card funding fee, update time, source links and shorter explanatory copy. English and Thai keep the daily reference-rate, per-purchase fee and confirmed-USD distinctions. Expanded details stack on phones and use three columns on desktop.

T3 browser checks confirmed the default closed state, click expansion and Enter collapse at 1440 px, and Thai/light expansion at 390 px with no page overflow. The row has a 44 px target. These captures use the same sample-data fixture:

- [Desktop, closed](assets/ai-usage-layout-20261011/estimate-collapsed-desktop-dark.png)
- [Desktop, expanded](assets/ai-usage-layout-20261011/estimate-expanded-desktop-dark.png)
- [Phone, Thai/light expanded](assets/ai-usage-layout-20261011/estimate-expanded-mobile-thai-light.png)

Validation: all 29 report tests passed, including default collapse, expansion and collapse; targeted ESLint, formatting, pinned Bun typecheck and `git diff --check` passed. Impeccable detector returned no findings.
