# Operating AI usage tracking

The report at `/th/ai-usage` and `/en/ai-usage` opens on **this month** in the organization's timezone. Job ticket photos (`JOB_TICKET_SCAN`), location label photos (`LOCATION_LABEL_SCAN`) and AI Search (`AI_SEARCH`) have separate operation counts, confirmed costs and averages in the same ledger. Tracking starts before each provider request and does not depend on saving a ticket. A location label operation can never be linked to a saved job ticket. This change has been verified on an isolated local deployment; production has not been deployed or provisioned by this task.

## Enable on a deployment

Deploy the additive Convex schema/functions and the matching application through the existing release process. Existing scans and older clients remain valid; their operation reference is optional. New organizations receive the two organization-scoped permissions through their default `ORG_ADMIN` role.

Set these variables on the **Convex deployment**, using the existing deployment administration process:

| Variable                       | Purpose                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`           | Existing provider credential; keep server-side.                                         |
| `OPENROUTER_MODEL`             | Optional existing image-scan model override.                                            |
| `OPENROUTER_SEARCH_MODEL`      | Optional existing AI Search model override.                                             |
| `AI_USAGE_ENVIRONMENT`         | Set explicitly to `production`, `staging` or `local`; this is copied into each attempt. |
| `AI_USAGE_BILLING_ACCOUNT_REF` | Optional non-secret account label, at most 80 characters; defaults to `default`.        |

An unset environment remains `unspecified` outside the local fallback. Do not mix deployments by assuming the client selects this value. Demo extraction without a provider call produces no billed event.

For each existing organization, run the internal provisioning command with trusted deployment administration access, selecting the intended deployment using the existing CLI configuration:

```sh
pnpm exec convex run aiUsage/provision:organization '{"orgId":"<Convex organization ID>"}'
```

`UPGRADED` adds `aiUsage.read` and `aiUsage.configure` only to an active, seeded administrator whose grants exactly match the previous planner + HR defaults. `CURRENT` is safe to repeat. `CUSTOMIZED` preserves grants: deliberately assign the desired AI usage permissions through the organization's existing access administration process. Warehouse managers and HR roles do not receive these permissions by default.

Both permissions are organization-scoped and independent of warehouse and HR access. A custom role holding only `aiUsage.read` sees **AI usage** in the menu, lands on the report instead of a storage denial, and reads it without `masterData.warehouse.read`; it receives no warehouse list, storage or HR data. The report shows labels only for the users and warehouses that appear in its usage rows. `aiUsage.configure` adds the baht-estimate settings form; reading the report still requires `aiUsage.read`.

If an organization still has the pre-HR planner-only administrator, complete the existing HR provisioning process first (`hr/provisioning:provisionOrganization`, using its Clerk organization ID), then provision AI usage. AI usage provisioning does not silently add unrelated HR grants.

Open the report as an organization administrator and set USD/THB, the source of that rate and the funding-fee estimate. The fee defaults to **5.5%**. Before a rate is saved the report shows USD and explains that THB cannot be estimated. Every save creates an immutable settings version. The report uses the latest saved rate for the entire selected period; CSV records that version, rate and source. Editing the form clears the saved confirmation until another successful save.

## Read and reconcile costs

USD reported by the provider is authoritative. Integer nano-USD values preserve small amounts when totals are combined. THB is an estimate: confirmed USD × the saved FX rate; estimated funding fee = estimated THB × fee percent / 100. Provider inference cost, the funding-fee estimate and the resulting estimate including that fee remain separate.

A scan/search operation can have multiple provider attempts. Image scans retain the existing maximum of two attempts; AI Search sends one. An HTTP 5xx answer is retried once when the remaining budget allows, whatever its body: the body is read within the response-size and attempt limits only to record usage, and an oversized, malformed or stalled error body records unknown cost for that attempt without preventing the retry. 4xx/429, timeouts, network errors and unusable successful answers are not retried. Retries increase attempt counts without increasing photo/query counts. Average cost includes only finished operations for which every attempt has confirmed cost. Missing cost is `UNKNOWN`; an explicitly reported zero is a confirmed free call.

Begin, finalize and summary updates are transactional. The durable begin precedes each provider request, and no request starts after the total provider deadline: if the begin is still unsettled at the deadline nothing is sent (a row it commits later expires as below); if it settles too late, or leaves too little time for a useful retry, the attempt is removed without a request. Finalize retries only the database write, never the billable request. A pending attempt expires to `INTERRUPTED` after 15 minutes. When an unknown-cost response has a generation ID, a scheduled metadata GET starts after one minute, with at most three lookups and five-minute retry intervals. Each lookup has a ten-second timeout and cannot replay inference.

If all three finalize database writes fail, the server emits one static `aiUsage.finalizeFailed` JSON log line: `orgId`, `operationId`, `attemptNo`, `feature`, `status`, `httpStatus`, `billingStatus`, `usageSource`, `providerGenerationId`, `actualModel`, `costUsdNano` and the input/output/total unit counts (null when unknown). It contains no image, prompt, query, model output, provider body or credential. The durable pending event remains visible and later expires to `INTERRUPTED`.

When the line has a `providerGenerationId`, recover the attempt with trusted deployment administration access. The command reads only the provider's generation metadata and never repeats inference. It is a dry run by default:

```sh
pnpm exec convex run aiUsage/recovery:attempt '{"orgId":"<orgId>","operationId":"<operationId>","attemptNo":1,"providerGenerationId":"<providerGenerationId>","status":"<status>"}'
```

`READY` reports the provider cost that would be recorded. Add `"apply":true` to write it: the attempt receives the generation ID, the provider-reported cost (`usageSource: GENERATION_LOOKUP`) and the logged status (only a pending or interrupted status is replaced), and its operation projection and daily summary are re-derived in the same transaction. Repeating an applied recovery answers `CURRENT` and changes nothing. `NOT_FOUND` (no such attempt in that organization), `CONFLICT` (the attempt already has a different generation ID, or another attempt claims this one), `COST_UNAVAILABLE` (no reported cost yet; retry later) and `PROVIDER_UNCONFIGURED` change nothing. Without a generation ID the attempt cannot be recovered individually; reconcile such gaps against the provider account statement. Do not assign a guessed zero cost.

Report attribution uses the UTC day of the **operation's first attempt**. Each event keeps its own attempt start time/day for comparison with provider records. A retry crossing midnight can therefore differ from a provider's daily attribution. Organization date filters read exact boundary slices around the UTC daily summaries; Bangkok uses UTC+7. Timezone support follows the application's existing fixed-offset calendar rules, and unsupported zones produce an explicit report error.

## Check or rebuild a day's summaries

The internal operator command recomputes operation projections and daily summaries from the event ledger without calling the provider. It preserves existing saved-ticket links. Use a UTC date, not the organization's local report date. The default is a dry run:

```sh
pnpm exec convex run aiUsage/rebuild:day '{"orgId":"<Convex organization ID>","utcDate":"2026-10-10"}'
```

The response contains `operationDriftCount` and `summaryDriftCount`. After reviewing drift, explicitly apply the same bounded rebuild:

```sh
pnpm exec convex run aiUsage/rebuild:day '{"orgId":"<Convex organization ID>","utcDate":"2026-10-10","apply":true}'
```

Applying replaces that day's summaries and updates/recreates operation projections in one transaction. Cross-midnight retries are read by operation ID. It never edits the event ledger, FX history or other tenants. A malformed ledger fails with `AI_USAGE_LEDGER_INVALID`. Missing projections can be recreated; a missing projection's former saved-ticket link is not reconstructed. Existing links are retained.

Live finalization and the rebuild derive operation projections and summary keys through the same pure functions (`convex/model/aiUsage/metrics.ts`), so a rebuilt day matches what the live lifecycle would have written.

The command refuses a day with more than 1,000 operation projections, 1,000 summaries or 2,000 attempt rows starting that UTC day. `AI_USAGE_REBUILD_CAPACITY` leaves all rows unchanged. Larger deployments need a separately designed paginated repair job rather than increasing these limits without checking transaction bounds.

## Capacity, history and privacy

The report supports up to 93 days. **Recent activity** lists the selected period's operations newest first, with time in the organization timezone, feature, user, warehouse, requested and actual model, result, provider calls/retries, confirmed USD with the baht estimate, and unknown or pending cost. It loads in pages through the daily index: each request reads at most 99 index rows (plus one probe row per smaller day), so a narrow filter may need several **Show more** requests and never scans the lifetime ledger. Newer activity is announced with a **Show latest** action rather than reshuffling rows already loaded. Reads are capped at 1,000 rows per UTC day and 3,000 rows overall; a capacity limit produces an explicit incomplete-report warning. Narrow the dates when that warning appears. CSV paginates operations, exports up to 3,000 operations, includes each attempt, and refuses a partial download if the cap is exceeded. CSV is UTF-8 with a BOM and escapes spreadsheet formulas.

The first tracking date appears in the report. Usage before this release cannot be reliably reconstructed per photo/user from existing tickets; no synthetic historical events are created. Usage history survives removing a draft or deleting a saved scan. Automatic retention/deletion is not enabled.

The usage tables contain whitelisted billing metadata, counts, statuses and attribution. They do not store images, prompts, search text or raw provider bodies. Existing business ticket fields are outside the usage ledger. The report measures provider AI cost; application infrastructure and database costs are separate.

## Verification evidence

The isolated local deployment recorded one real synthetic image extraction and one real AI Search request before any ticket save. Provider-reported costs were USD `0.000591675` and USD `0.000178425`. At the **local QA estimate** of 33.53 THB/USD plus 5.5%, their estimated amounts including funding fee were approximately THB `0.0209` and THB `0.0063`. These are observed test requests, not promised prices for future images or models.

Automated checks cover missing/free cost, unreadable output with usage, retry counting, finalize idempotency, expiry, metadata-only reconciliation, permission/tenant isolation, forged ticket links, date boundaries, immutable FX, capacity refusal and ledger rebuilds. Audit fix round 1 added automated checks for the total deadline around a delayed or unsettled begin, 5xx retries with oversized/malformed/stalled error bodies, location label tracking and link refusal, usage-only access, recent-activity pagination and stale answers, the finalize-failure log and its recovery command. Browser checks of the recent-activity list and the usage-only role are pending. Typecheck, lint and production build were verified. Browser checks cover the default month, today/custom dates, settings feedback, CSV and desktop/mobile layout. The independent finish review scored the settings-feedback correction resolved; its captured visual scope is Thai in the incumbent dark theme.
