# Operating AI usage tracking

The report at `/th/ai-usage` and `/en/ai-usage` opens on **this month** in the organization's timezone. Image scans and AI Search have separate operation counts, confirmed costs and averages. Tracking starts before each provider request and does not depend on saving a ticket. This change has been verified on an isolated local deployment; production has not been deployed or provisioned by this task.

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

If an organization still has the pre-HR planner-only administrator, complete the existing HR provisioning process first (`hr/provisioning:provisionOrganization`, using its Clerk organization ID), then provision AI usage. AI usage provisioning does not silently add unrelated HR grants.

Open the report as an organization administrator and set USD/THB, the source of that rate and the funding-fee estimate. The fee defaults to **5.5%**. Before a rate is saved the report shows USD and explains that THB cannot be estimated. Every save creates an immutable settings version. The report uses the latest saved rate for the entire selected period; CSV records that version, rate and source. Editing the form clears the saved confirmation until another successful save.

## Read and reconcile costs

USD reported by the provider is authoritative. Integer nano-USD values preserve small amounts when totals are combined. THB is an estimate: confirmed USD × the saved FX rate; estimated funding fee = estimated THB × fee percent / 100. Provider inference cost, the funding-fee estimate and the resulting estimate including that fee remain separate.

A scan/search operation can have multiple provider attempts. Image scans retain the existing maximum of two attempts; AI Search sends one. Retries increase attempt counts without increasing photo/query counts. Average cost includes only finished operations for which every attempt has confirmed cost. Missing cost is `UNKNOWN`; an explicitly reported zero is a confirmed free call.

Begin, finalize and summary updates are transactional. Finalize retries only the database write, never the billable request. A pending attempt expires to `INTERRUPTED` after 15 minutes. When an unknown-cost response has a generation ID, a scheduled metadata GET starts after one minute, with at most three lookups and five-minute retry intervals. Each lookup has a ten-second timeout and cannot replay inference.

If all three finalize database writes fail, the server emits the static `aiUsage.finalizeFailed` log with operation reference, attempt number, statuses and nano-USD cost when available. The durable pending event remains visible and later expires. A lost generation ID cannot be recovered from an event that never received it; reconcile such gaps against the provider account statement. Do not assign a guessed zero cost.

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

The command refuses a day with more than 1,000 operation projections, 1,000 summaries or 2,000 attempt rows starting that UTC day. `AI_USAGE_REBUILD_CAPACITY` leaves all rows unchanged. Larger deployments need a separately designed paginated repair job rather than increasing these limits without checking transaction bounds.

## Capacity, history and privacy

The report supports up to 93 days. Reads are capped at 1,000 rows per UTC day and 3,000 rows overall; a capacity limit produces an explicit incomplete-report warning. Narrow the dates when that warning appears. CSV paginates operations, exports up to 3,000 operations, includes each attempt, and refuses a partial download if the cap is exceeded. CSV is UTF-8 with a BOM and escapes spreadsheet formulas.

The first tracking date appears in the report. Usage before this release cannot be reliably reconstructed per photo/user from existing tickets; no synthetic historical events are created. Usage history survives removing a draft or deleting a saved scan. Automatic retention/deletion is not enabled.

The usage tables contain whitelisted billing metadata, counts, statuses and attribution. They do not store images, prompts, search text or raw provider bodies. Existing business ticket fields are outside the usage ledger. The report measures provider AI cost; application infrastructure and database costs are separate.

## Verification evidence

The isolated local deployment recorded one real synthetic image extraction and one real AI Search request before any ticket save. Provider-reported costs were USD `0.000591675` and USD `0.000178425`. At the **local QA estimate** of 33.53 THB/USD plus 5.5%, their estimated amounts including funding fee were approximately THB `0.0209` and THB `0.0063`. These are observed test requests, not promised prices for future images or models.

Automated checks cover missing/free cost, unreadable output with usage, retry counting, finalize idempotency, expiry, metadata-only reconciliation, permission/tenant isolation, forged ticket links, date boundaries, immutable FX, capacity refusal and ledger rebuilds. Typecheck, lint and production build were verified. Browser checks cover the default month, today/custom dates, settings feedback, CSV and desktop/mobile layout. The independent finish review scored the settings-feedback correction resolved; its captured visual scope is Thai in the incumbent dark theme.
