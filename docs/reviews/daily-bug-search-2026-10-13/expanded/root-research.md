# Additional root research

This extends the prior three findings without editing application source. Diagnostic probes are separate from the normal test suite.

## ROOT-01 — Time-dependent HR subscriptions have no clock invalidation (P2, source-demonstrated)

Primary evidence: `convex/hr/shared.ts:62–73` reads `Date.now()` in `orgClock`; `convex/hr/access.ts:34` and `convex/hr/self.ts:163` call it from zero-argument queries; `src/features/hr/TodayScreen.tsx:60` and `src/components/providers/HrAccessProvider.tsx:62` subscribe with unchanged arguments. Searches of the HR client code found no clock bucket, timer, visibility refresh, or scheduled HR clock document. The repository has no `convex/crons.ts`.

Convex explicitly documents that advancing `Date.now()` does not rerun a subscribed query: [official best practices](https://docs.convex.dev/understanding/best-practices#dont-use-datenow-in-queries). Combining that documented behavior with these callers demonstrates an idle-subscription defect: a page left open across midnight, a shift deadline or the transition from in-progress to exception can keep its previous date/status until another dependency changes or it is reloaded. This is a source-based deduction, not a simulated overnight browser reproduction. Mutations read authoritative server time again, so this finding does **not** claim that client clock staleness changes the actual event timestamp.

Affected families: Today, access-derived date/range defaults, personal history/day detail, review queue and close readiness previews. Count these as one root cause, not separate bugs per page. Validate with an actual subscription whose relevant database rows remain unchanged while a clock boundary passes. Remediation should invalidate a coarse server-derived clock dependency or resubscribe on a bounded client clock bucket/visibility event, retaining server authority for every write.

## ROOT-02 — Personal request malformed deep links throw before NOT_FOUND (P2, runtime reproduced)

Primary evidence: `src/app/[locale]/(desktop)/hr/requests/[requestId]/page.tsx:12` passes the unvalidated route string to `HrRequestDetailScreen`; `src/features/hr/RequestsScreen.tsx:225` sends it directly to the query; `convex/hr/self.ts:359` declares `correctionId: v.id("hrCorrectionRequests")`. The intended NOT_FOUND branch is inside the handler and therefore cannot handle malformed IDs. Compare the deliberately tolerant `v.string()` in `convex/hr/review.ts:199` and `convex/hr/periods.ts:212`.

Repro: an authenticated registered `hr/self:requestDetail` call with `correctionId: not-a-convex-id` rejects with `Validator error: Expected ID for table "hrCorrectionRequests"` instead of returning the domain's NOT_FOUND outcome. In the application this thrown query reaches the shared query boundary instead of the detail view's missing-item state; a reload resends the same invalid route parameter.

Probe: `expanded/probes/root-request-id.probe.ts`; it invokes `world.t.query` and actual registered argument validation. No browser error-boundary walkthrough is claimed. Expected-correct assertion fails. Remediation: validate/recover at the route or use a tolerant string read through the existing tenant-safe lookup, preserving identical outcomes for missing/foreign records. Ordinary well-formed IDs remain protected.

## ROOT-03 — Old async completion is stamped with the new operation generation (P2, runtime reproduced at actual caller)

Primary evidence: `src/hooks/useAsyncOperation.ts:54–67` increments generation when scope changes, but `:107–108` stamps `.complete()` with `generation.current` at the time the old callback invokes it. `src/features/storageLayouts/StorageLayoutScreens.tsx:369–416` renders `NewBuildingContent` without a warehouse key and calls `operation.complete` from inside an async `.run()` callback after awaiting the create mutation.

Repro: submit a dirty NewStorageBuildingForm for warehouse A, rerender the actual QueryGate caller with warehouse B while the response is pending, then resolve A's success. `router.replace("/master-data/storage-layouts/building-in-a")` runs while B is current. The guard inside `.run()` protects its returned value and busy/error handling but does not protect `.complete()` or caller-side state changes inside the supplied callback. The new-generation stamp accepts the stale completion.

Probe: `expanded/probes/root-async-completion.probe.tsx` uses the actual form and shared operation hook, replacing query transport and router with observation seams. It asserts both the original submitted warehouse and the late navigation. No ordinary user-driven pending departure is claimed: that action is already guarded. The relevant precondition is a forced external workspace change, such as selected-warehouse availability changing after an administrator update. A browser reproduction of that availability update has not been run.

Remediation: attach the completion to the invocation's captured owner/generation, and reject caller-side receipt/error/reset effects after that owner is stale. Where a form's uncontrolled draft belongs to a warehouse, give its lifecycle explicit workspace identity too. Regression coverage must exercise an actual caller doing work inside `.run()`, rather than only checking the promise's returned value.

## Commands actually run

```sh
pnpm exec vitest run --config docs/reviews/daily-bug-search-2026-10-13/expanded/probes/root.config.mts --reporter=verbose
```

Result: 2 files / 2 expected-correct assertions failed, with registered ID-validation rejection and one stale warehouse navigation. Initial compilation took 34.85 seconds; test execution was 5.43 seconds. Log: `expanded/evidence/root-probes-red.log`.

## Rejected leads

- Moving an employee with existing attendance to a new site could have used the wrong site's closed period. Current `saveEmployee` explicitly refuses the site move with EMPLOYEE_SITE_LOCKED, so this is not an active bug.
- Unsupported daylight-saving zones and the 50-employee/31-day period limit are declared pilot constraints with visible refusal; they were not counted as defects.
- Generic AI/tenant security worries were excluded: every relevant write/query has server authorization, and no bypass was demonstrated.
- Historical UI bugs marked fixed in earlier reports were not imported into the current backlog.
