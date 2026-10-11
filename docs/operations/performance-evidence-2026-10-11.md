# Performance and selective TanStack evidence — 2026-10-11

Scheduled job: October 11, 06:00 Asia/Bangkok. Work is confined to
`industrial-sas-performance-20261011-0600`, branch
`codex/performance-tanstack-20261011-0600`, from main
`c64a882239696122e593e493aea771a1792841e5`. Main already contains the barcode
worker/image-picker changes from PR #61. Open HR/search PR #62 and the original
checkout's unrelated uncommitted work were excluded. Main was rechecked before
publication and had not advanced.

## Measurement conditions

Apple Silicon/macOS, Node 24.19.0, pnpm 10.33.2, installed Next 16.3.8,
React 19.2.8 and locked Playwright Chromium. Optimized Next production builds,
a fresh loopback Convex backend and the existing synthetic
`--pagination --storage-ui` fixtures; test Clerk authentication only. Desktop
1440×900 and mobile 390×844, Thai/English, three runs each. Values below are
medians of six observations per viewport (both locales); no CPU/network
throttling. Cold means a new browser context, warm means same-context reload;
OS, browser and backend caches are not forcibly cleared. These lab samples do
not establish production field percentiles or causal percentage improvements.

The baseline is frozen `git archive` source, inside this worktree, with the
same installed dependencies. A separate candidate copy changes only
`reactCompiler: true` to `false` for the compiler control. Measurement runs are
sequential. Earlier direct-decoder scanning results were discarded from the
current UI comparison after checking the actual worker-backed picker path.
The final UI fixture comparisons run without simultaneous builds/test suites.
The final Next comparison uses the same 129 synthetic products in both runs
(126 seed products plus three earlier verification records). Later behavior
verification creates a separate fourth record after this measurement pair.

The scripts in [scripts/performance](../../scripts/performance/README.md)
record numeric JSON, never tokens, browser auth state or business row contents.
Raw candidate/baseline/control JSON is in ignored `output/performance` and the
scheduled job's evidence copy. Usable content means actual catalogue rows,
product form fields or a map zone, rather than a page shell. Decoded JavaScript
includes the browser-exposed third-party sizes and normal Next prefetch; cross-origin resources without timing permission can report zero; transfer bytes and
buffered browser long tasks are recorded separately. Telemetry flags are off
for these local comparisons; the hosted Speed Insights script is an additional
12,567 uncompressed bytes when enabled.

## Production-build comparison

| Flow / viewport                     | Baseline usable ms | Candidate usable ms | Baseline decoded JS bytes | Candidate decoded JS bytes |
| ----------------------------------- | -----------------: | ------------------: | ------------------------: | -------------------------: |
| Catalogue cold / desktop            |              961.0 |               969.5 |                 2,135,555 |                  2,251,590 |
| Catalogue warm / desktop            |              864.8 |               864.1 |                 2,135,555 |                  2,251,590 |
| Catalogue cold / mobile             |              988.1 |               952.2 |                 1,934,160 |                  2,174,318 |
| Catalogue warm / mobile             |              862.0 |               856.6 |                 2,058,283 |                  2,174,318 |
| Product click / desktop             |               37.9 |                40.2 |                         — |                          — |
| Product click / mobile              |               26.7 |                37.9 |                         — |                          — |
| Product route-warm reload / desktop |              857.0 |               850.4 |                 2,135,555 |                  2,251,590 |
| Product route-warm reload / mobile  |              854.3 |               869.1 |                 2,058,283 |                  2,174,318 |
| Storage cold / desktop              |              858.3 |               860.7 |                 2,553,477 |                  2,445,990 |
| Storage cold / mobile               |              861.8 |               882.7 |                 2,476,205 |                  2,368,718 |

Storage's client locale imports were unnecessarily making both entire locale
bundles reachable. Context translations remove that duplication. Its net
initial JS reduction is 107,487 bytes. Warm catalogue JS **increases by 116,035
bytes** with the selected libraries/compiler. Loading/navigation differences
are small and mixed; no consistent speedup is claimed. Existing UX, server
semantics and confirmation behavior take priority over a small timing delta.

Cold mobile baseline prefetch did not finish at every usable-content marker;
its byte median differs from warm loading. Prefetch contributes variability.

The earlier compiler-only experiment, before the stable table header fix, has 2,193,913 catalogue desktop bytes and 2,328,958
storage desktop bytes, versus 2,250,226 and 2,445,140 with the compiler. Its cold
usable times are 977.0/955.5 ms (catalogue desktop/mobile) and 865.7/861.2 ms
(storage). Stable compiler integration adds 56,313 catalogue bytes and 116,182
storage bytes in this comparison; loading effects are inconclusive. Existing
memoization remains intact. Production builds and behavior checks found no
compatibility defect requiring annotation-only opt-in. The table uses a fresh
memoized, manually controlled TanStack engine rather than a mutable React hook
that the compiler cannot safely memoize.

Browser long-task medians are zero across these route samples. The baseline
has one 77 ms cold-catalogue task; the candidate has one 94 ms cold-storage
task. This machine/protocol cannot establish mobile-device frame budgets.

Bounded Convex HTTP queries: blank search median 28.9 → 52.0 ms, response
31,041 bytes; sparse complete-results search per-request median 25.9 → 26.7 ms,
response 2,137 bytes. Each sparse run requires 136 bounded continuation
requests (408 across three runs). No backend query optimization or globally
faster search is claimed. The UI retains its existing bounded scan/continuation
protocol; no all-row fetch or client page-only global sort was added.

## Storage and scanning fixture interactions

Production Vite builds of the existing real components, reduced motion,
198 map positions, 25 visible list rows and eight pages; six observations per
viewport. The fixture includes its own full bilingual messages and differs
from the authenticated Next shell, so its JS bytes are not a route estimate.

| Flow / viewport                     | Baseline ms | Candidate ms |
| ----------------------------------- | ----------: | -----------: |
| List cold / desktop                 |       129.4 |        131.3 |
| List warm / desktop                 |        38.5 |         38.3 |
| Page change / desktop               |        47.8 |         48.4 |
| Map switch / desktop                |        67.5 |         67.5 |
| List cold / mobile                  |       127.3 |        126.3 |
| List warm / mobile                  |        38.4 |         37.3 |
| Page change / mobile                |        48.4 |         44.6 |
| Map switch / mobile                 |        62.5 |         62.9 |
| Scanning load / desktop             |        91.5 |         92.0 |
| Scanning load / mobile              |        91.2 |         91.8 |
| Six photos through picker / desktop |     6,044.9 |      6,033.4 |
| Six photos through picker / mobile  |     6,297.4 |      6,080.2 |

All photos decode to the expected values. Worker-picker long-task medians are
zero; one candidate sample records 51 ms. Maximum interval delay is
135.4 → 182.3 ms across the series; it includes browser preview/automation work
and does not identify remaining synchronous decoder work. The current owned
worker already handles image decoding and cancellation. No additional worker
was warranted by this comparison. Physical camera speed, real phone thermal
behavior and recognition under warehouse lighting still require a real device.

## Retained changes and conditional decisions

- Stable React Compiler, exact `babel-plugin-react-compiler@1.0.0`, using the
  installed Next guide; no existing manual memoization removed.
- Optional batch manager and its pallet scene load on demand. Parent intent,
  draft ownership and editor key remain unchanged. Actual app opening deferred
  90,123 decoded JS bytes and took 889.3 ms to usable edit fields in one desktop
  observation; dialog focus and Escape return to the opener passed. The default
  floor map stays eager: adding a loading boundary there would delay a primary
  view. Barcode decoding remains dynamically imported as it was on main.
- One finished-goods catalogue uses TanStack Table 8.21.3, with manual filtering,
  sorting and cursor pagination. Convex stays authoritative. Existing mobile
  expansion, appearance, accessible controls and complete-result semantics stay.
- One product-details form uses TanStack Form 1.33.5 for fields, dirty/submission
  state and draft listeners. Backend authorization/validation, request identity,
  translated rejection, pending guards and post-confirmation navigation remain.
- Convex optimism updates only cached descriptions/references of existing active
  products. SKU/unit/storage condition, inventory, occupancy, status, permissions
  and success stay authoritative. Confirmation, normalization and business
  rejection rollback were exercised with the real installed client/local backend.
- Speed Insights 2.0.0 uses the existing route allowlist and a bounded same-origin
  relay to strip DOM attribution and credentials before forwarding. Existing CSP
  is sufficient and was not weakened.
- Sentry 11.6.0 is disabled by default, with separate client/server configuration,
  strict post-enrichment event/span and envelope-header privacy gates, no replay and only 5% manual client
  route-shell tracing. Remote activation remains incomplete, as detailed below.
- TanStack Virtual: deferred; existing bounded/paginated lists show no slow long
  list in this profile. Query/Devtools: deferred; Convex is reactive and external
  provider HTTP remains behind server actions, without a client HTTP cache need.
  Pacer/Store: deferred; no measured queue/shared-state problem beyond existing
  hooks. Charts/Hotkeys await a product feature. No Elysia, Start/Router or DB.
- The new SDK build dependency exposed a moderate brace-expansion advisory.
  The existing exact security override was advanced to patched 5.0.12; no audit
  threshold, test or safeguard was relaxed.

## Verification and external activation

Local `pnpm check` passed: formatting, types, zero-warning lint, 206 test files,
2,352 tests. Existing regression assertions were retained; live filter draft/focus preservation has a dedicated regression check, and asynchronous lazy
editor tests now wait for the editor to load. The full workspace matrix passed
94 tests, with two existing optional cases skipped. It covers Thai/English,
320/768/1024/1440 widths, themes, map camera retention, focus, keyboard controls,
reduced motion, image choices and simulated camera lifecycle. Authenticated
production-app checks passed six flows, including lazy dialog focus, including all four locale/viewport
combinations and real optimistic reconciliation/rejection. Final committed-head
release gates and protected PR checks are recorded in the job's final evidence.

The production Vercel project service exists (`hasData: false` at inspection)
and its hosted script returns 200. The CLI configured the production opt-in
flag for the next normal gated release. A configuration/API response alone is
not active delivery. The job's final release evidence must record the actual
relay and ingestion outcome; no manual production deploy is authorized.

Sentry organization/project DSNs and upload credentials were absent from the
available configuration. No account, plan or credentials were invented. The
real SDK's local fake transport verifies privacy, but remote delivery, uploaded
source-map matching/symbolication, private artifact access and alert routing
remain unconfigured/unverified. Convex centralized log delivery is also outside
this client/Next integration. See the [activation runbook](release-runbook.md).

PR URL and normal release outcome are persisted in the scheduled job's final
report. T3 `link_pull_request`/`list_thread_pull_requests` tools were unavailable
in this separate CLI run; registration could not be performed.
