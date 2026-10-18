# Measurement and UX review — October 10, 2026

Reviewer: Codex, alongside four independent Kiro CLI audits. Scope: measurement
readiness, existing performance protections, and acceptance criteria. Application
code and business data were not changed. No new runtime latency measurements were
collected. The local application was not listening on port 3100, and the T3
preview remained unavailable after initialization.

## Evidence

- `src/components/system/WebVitals.tsx:13–26` already uses a stable callback with
  `useReportWebVitals`. `src/lib/observability/webVitals.ts:13–30` serializes
  metric values, deltas, ratings, and navigation type, without route attribution.
- `src/lib/observability/port.ts:9–17,59–65` supports only `none` and browser
  `console`. This establishes neither central delivery nor a field baseline.
  `src/lib/observability/event.ts` and `dimensions.ts` explicitly allowlist
  payloads; new journey timings need reviewed event codes and dimension rules.
- `scripts/storage-workspace-preview/main.tsx` exposes React Profiler results.
  The harness renders real components but has no authentication or live backend.
  `tests/e2e/workspace/workspace.spec.ts:251–341` already checks one React update
  for a 50-move drag. Preserve that existing contract.
- `tests/fixtures/document-reads.ts`,
  `tests/integration/catalogue-pagination.integration.test.ts`, and
  `tests/integration/storage-occupancy.integration.test.ts` provide existing read
  instrumentation and cost assertions. Extend these instead of creating a
  parallel fake benchmark that counts requested limits rather than actual reads.
- Installed Convex 1.46.0 exposes `ctx.meta.getTransactionMetrics()` in
  `node_modules/convex/dist/esm-types/server/meta.d.ts`, with documents/bytes read,
  writes, query count, and remaining transaction headroom. Use local or synthetic
  staging diagnostics where supported by the deployment; avoid returning
  diagnostics or sensitive request metadata in public application responses.
- `docs/reviews/codebase-optimization-2026-10-08.md` records completed test
  environment separation, blank-search optimization, and product/catalogue
  module separation. Its Node and analyzer observations are historical evidence,
  not the current application's browser latency baseline.
- `docs/reviews/product-barcode-non-ai-2026-10-10.md` and its raw artifacts record
  a seven-unique-image experiment. Timings exclude image loading, AI, and lookup;
  the decoder is not integrated into the application. Do not turn these results
  into a production scan speed or accuracy claim.

## First implementation task: establish a comparable baseline

Use a fixed revision including the intended HR/search work, frozen dependencies,
and an isolated production build connected to local or synthetic staging data.
Do not benchmark concurrent Kiro processes, development compilation, or a changing
working tree. Keep cold and warm runs separate. Record the machine/device,
browser, network, fixture sizes, build identifier, and cache state.

Measure these user journeys:

| Journey                                                | Record                                                                                           | Correctness and UX check                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Sign-in to usable warehouse/HR page                    | TTFB, LCP, permission/workspace readiness, JS transfer and execution                             | Correct accessible destination for storage-only, HR-only, mixed, and no-access members   |
| Catalogue search, paging, row expansion                | Keystroke-to-feedback, settled results, query round trips, documents/bytes read, commit duration | Complete matching and ordering, stable focus, retained filters, no misleading zero state |
| Storage floor open, pan, zoom, selection, 2D/3D switch | Scene payload, derivation time, long tasks, frame intervals, React commits                       | Camera center, keyboard operation, exact geometry and occupancy                          |
| Camera scan and photo job extraction                   | Camera-ready time; capture, decode/upload/provider/lookup/review timings separately              | Success rate, cancellation, duplicate prevention, retained manual/retry paths            |
| HR today, history, review, period preview/export       | Query/action duration, reads, payload, conflicts, UI feedback                                    | Server clock rules, consistent period output, permissions and draft safety               |
| Search open, record results, optional AI               | Dialog feedback, result readiness, reads, AI stage time                                          | Thai/English result parity, permitted destinations, obsolete-result suppression          |

Cover desktop and a representative physical phone, Thai/English, slow network,
cold/warm navigation, and small/large fixtures. Test identity/warehouse/site
switches and permission revocation. Reuse existing pagination fixtures; add
larger fixtures in the isolated environment where a finding needs them.

For smoke comparisons use repeated paired runs and retain raw observations;
collect enough repetitions before claiming p95. Report deterministic cost changes
even when timings are noisy. A 20% journey improvement is a proposed experiment
target, not a promise or a reason to accept UX loss.

Core Web Vitals goals are p75 LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1, segmented by
device class. These are field goals; a handful of lab traces cannot establish
them. See [Web Vitals](https://web.dev/articles/vitals). Route-to-usable timings
remain necessary for this authenticated, interactive application.

## Delivery gate

Keep a patch only when its improvement exceeds observed variation or removes a
verified deterministic cost, with equivalent results and no UX regression.
Measure first-open latency when splitting optional features, not just the entry
bundle. Validate cancellation, focus, drafts, freshness, authorization and
concurrent writes for affected journeys. Reuse targeted regression suites and
run the repository's required checks before delivery.

Begin with local measurements. A durable telemetry destination can follow as a
separate owned task; preserve the documented nonblocking sink and redaction
rules. Never log search text, photos, payroll data, identities, or tokens.

Primary guidance: [Convex best practices](https://docs.convex.dev/understanding/best-practices),
[Next lazy loading](https://nextjs.org/docs/app/guides/lazy-loading), and the
installed Next 16.3.8 guides under `node_modules/next/dist/docs/`.
