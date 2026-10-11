# AI usage accounting and monthly statement delivery

## Identity and dependency boundary

Worktree: `/Users/macbook/Development/industrial-sas-ai-usage-delivery-20261011`.
Branch: `codex/ai-usage-delivery-20261011`.
PR base: `codex/hr-module-delivery-20261011` (stacked upper PR).
Source: `4ddbf080c6967f114fb21b5181674f14dcd5371a`.
Integrated main: `9ac5da0e5ffc681e19a7dc5ad83da5d26bb61320`.
Specification: `docs/plans/ai-usage-tracking-2026-10-10.md`.
Operational contract: `docs/operations/ai-usage-tracking.md`.

Deliver durable provider-attempt accounting for job ticket scan, location image
scan, and AI Search; idempotent aggregation/recovery; authorized monthly usage
statement with filters/export; and explicitly labeled currency/fee estimates.
Preserve the selected statement design. Do not add budget enforcement, model
switching, customer billing, or unrelated HR/UI redesign.

Own AI usage backend/models/schema, provider instrumentation, report/export
screens, permissions/provisioning, translations, and supporting tests/docs.
Shared navigation/provider changes must be minimal integration with the HR
base. The base owns pure Search intent logic and uninstrumented HTTP transport;
the upper task adds durable recorder hooks. It must not undo HR fixes.

## Four-agent roster and handoffs

| Role                  | Runtime                             | Deliverable                                                              |
| --------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| Implement             | Kiro `claude-opus-5.5`, high effort | Integrate finalized HR base, retain accounting hooks, inspect upper diff |
| Audit code            | Codex, read-only                    | Accounting, tenant security, privacy, bounds and lifecycle audit         |
| Audit spec and fix    | Codex                               | Spec audit, reproduced defects, scoped fixes and regressions             |
| Test and computer use | Codex coordinator                   | Independent automated checks and live usage/report workflows             |

Wait for the HR branch's final validated commit, then merge it into this branch.
Resolve provider conflicts by retaining the HR pure/transport boundary and
adding the AI recorder behavior. Do not copy whole source files over newer HR
fixes. Verify all upper changes belong to usage accounting or its integration.
Remove accidentally tracked generated visual-review artifacts from the new
branch; preserve source artifacts in existing checkouts and ignored local QA.

Kiro returns a scoped implementation report. Freeze a candidate; code and
spec audits run in parallel. Codex fix agent reproduces confirmed issues,
patches them, and writes focused regressions. Independent tester exercises
the actual user flow and changed boundaries. Repeat as needed, then validate
the final entire tree including the HR base.

## Acceptance scenarios

1. Organization admin opens the statement, sees today/month totals and unknown
   costs clearly, filters by period/user/warehouse/feature, paginates, and
   exports CSV matching the displayed authorized scope. Ordinary warehouse or
   HR role cannot query the report or configure settings by calling backend
   functions directly. Organization switching clears stale data/exports.
2. Real provider invocation records usage at invocation time, before a ticket
   is saved. Discarding a draft, closing the page, failed upload, deleting a
   saved ticket, or retrying save does not erase or duplicate the attempt cost.
3. A retry creates separate attempt accounting but one user operation. Database
   recording retries do not resend the provider request. Finalize/reconcile/
   rebuild are idempotent, use deltas, and remain tenant-scoped and bounded.
4. Provider success, 5xx retry, 4xx, unreadable payload, timeout, network failure,
   response with missing cost/model, and interruption between begin/finish are
   represented accurately. Unknown cost is not zero. Decimal cost parsing,
   large values and malformed metadata do not corrupt totals.
5. Manual/barcode/QR input produces no provider-attempt charge. Job scans,
   location scans and AI Search are attributable to the correct feature,
   warehouse, actor and environment. Record linking enforces same operation,
   actor, organization and feature; invalid linking is rejected.
6. Monthly/today boundaries use organization timezone, including UTC boundary
   slices and attempts across midnight. Complete/unknown denominators and
   operation/attempt counts are explicit; partial data is not shown as a full
   total. Report queries and exports remain bounded under large local fixtures.
7. Currency conversion and top-up fee estimates are labeled separately from
   provider-reported charges. Authorized setting changes persist. CSV values
   are formula-safe and contain currency, environment and status context.
8. Selected Thai/English statement design works on desktop/mobile, filters and
   cancellation remain usable, and no raw prompt/image/token/key is exposed
   through the ledger, logs, UI, CSV, or client-visible errors.

## Verification and evidence

Use isolated local Convex and Clerk test identities, dedicated dev/build state,
and synthetic usage records where necessary. T3 browser walkthroughs must open
the report, change filters, configure a setting when authorized, export, and
refresh. Exercise at least one available real development provider call and
then observe its ledger contribution through the UI. If provider credentials
are unavailable, report that scenario BLOCKED; do not label a fixture as live
provider billing. Controlled retries/errors use labeled local fixtures.

Automated gates: formatting/typecheck/lint, all Vitest projects, production
build, Convex codegen freshness, relevant browser suites and required GitHub
checks. Targeted accounting tests must assert externally meaningful invariants
rather than mirror implementation. Validate on the exact final source.

Evidence directory: `output/delivery-20261011/` (ignored). Required files:
`implementation.md`, `standards-audit.md`, `spec-audit.md`, `findings.md`,
`fixes.md`, `verification.md`, and logs/screenshots referenced by that report.

## PR gate

Create the AI usage PR against the finalized HR branch after acceptance and
checks pass. Explain the stack dependency and link both PRs in the description
and T3. Compare upper PR changes to the HR base, not only main. This run does
not merge/deploy. After HR merges later, retarget the upper PR to main and run
fresh checks before merging. Preserve combined PR #62 and explicitly identify
the replacement stack to prevent duplicate integration.

Status: worktree created; awaiting finalized HR base and four-role verification.
