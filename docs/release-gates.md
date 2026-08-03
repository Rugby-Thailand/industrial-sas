# Release gate register

Every condition the approved [PROJECT_PLAN.md](../PROJECT_PLAN.md) requires before a
phase completes or the product launches, in one list with an owner, the evidence that
closes it, and its current status.

## How to read this register

- **IDs are stable.** `RG-017` is cited from ADRs, tests, and the
  [coverage matrix](./specification-coverage.md). Never renumber; retire a gate by
  setting its status to `Waived` with a reason.
- **Kind** distinguishes what can be automated from what cannot:
  - `Code` — a code-owned check: a test, a static guard, or a CI job proves it.
  - `External` — evidence from outside this repository: hardware, a cloud
    measurement, counsel, or a tenant's written acceptance. No amount of code closes
    it.
  - `Mixed` — code produces the measurement, a human accepts the result.
- **Status** is one of `Not started`, `In progress`, `Satisfied`, `Waived`.
- **Evidence** names the artefact that must exist. A gate is not satisfied by an
  opinion; it is satisfied by a recorded artefact.
- **Owner** is a role, not a person, until the pilot team is named.

## Current position

Beyond the toolchain scaffold and this documentation set, the repository now contains
the tenant security schema and the guards that read it, the tenant-bound function
wrappers, signed Clerk webhook identity synchronization, the code-owned permission
catalogue with its fail-closed policy evaluator and provisioning seed, and — new —
**mandatory server-side permission enforcement inside those wrappers, with audited
authorization attempts** ([coverage matrix](./specification-coverage.md) §5a). It
closes no gate. Nothing is deployed and no feature function exists to enforce a
permission _for_, so every gate that depends on behaviour in a running environment
still depends on code that does not exist.

Of the 71 gates registered here, **two are satisfied** — `RG-062` (the ADR set) and
`RG-001` (B-01…B-12 accepted, evidenced by the
[approval record](./approval-record.md)) — **six are in progress** (`RG-053`,
`RG-054`, `RG-055`: the standing merge gates; `RG-032` and `RG-033`: the static
guards that now exist but are not required checks; and `RG-026`, whose
wrapper-level matrix is green while its per-function matrix waits for functions),
and the remaining **63 are `Not started`**. That is the accurate picture, not a
pessimistic one.

`RG-013` and `RG-031` deserve a specific note, because the isolation tier now has real
content. They remain `Not started`. The tier proves the schema cannot _express_ a cheap
cross-tenant read, and now that a two-tenant fixture rejects cross-tenant grants,
scopes, and step-up evidence through the real wrappers; it is not a blocking merge
gate by policy, and nothing is deployed.

`RG-071` is new and open by construction: a Convex query cannot write, so a denied
read is enforced but not recorded. It is registered rather than left as a comment,
because "denials are audited" (`INV-0006-10`) is currently true of mutations and
actions only.

The approval record closes `RG-001` only. It supplies no budget, pilot site, vendor,
hardware, or legal approval, so `RG-064` and every other `External` gate stay open.
Those gates govern production and pilot validation and the release itself; local
implementation against fakes is not waiting on them.

## Phase 0 — decide and de-risk

| ID       | Gate                                                                                           | Kind     | Owner            | Evidence required                                                                                    | Status      |
| -------- | ---------------------------------------------------------------------------------------------- | -------- | ---------------- | ---------------------------------------------------------------------------------------------------- | ----------- |
| `RG-001` | Written acceptance or replacement of B-01…B-12 (plan §4)                                       | External | Product owner    | [Approval record `AR-001`](./approval-record.md) — B-01…B-12 accepted without exceptions, 2026-08-03 | Satisfied   |
| `RG-062` | ADR-0001…ADR-0012 written and accepted (plan §10 Phase 0, §11)                                 | Code     | Engineering lead | [ADR set](./adr/README.md) committed and reviewed                                                    | Satisfied   |
| `RG-002` | Bangkok-to-Convex latency benchmark, US East vs EU West, from the pilot warehouse network      | External | Engineering lead | Benchmark report: p50/p95/p99 per region, per operation, with network conditions and date            | Not started |
| `RG-003` | Scanner spike on the actual rugged device, browser, and WebView                                | External | Engineering lead | Spike note: device model, OS/WebView version, HID terminator behaviour, failure cases, video or log  | Not started |
| `RG-004` | Physical ZPL label printed in Thai and English on the actual printer and stock, then rescanned | External | Engineering lead | Printed sample retained, ZPL payload, printer model, rescan result, Thai glyph confirmation          | Not started |
| `RG-005` | Sample supplier barcode corpus and parser test fixtures                                        | Mixed    | Engineering lead | Fixture file of real scans (anonymized), expected parse results, list of unparseable formats         | Not started |
| `RG-006` | PDPA/legal gap assessment and cross-border-transfer decision                                   | External | Product owner    | Gap assessment document and a recorded region/transfer decision with its lawful basis                | Not started |
| `RG-007` | Vendor and unit-economics worksheet for pilot and ten-tenant scenarios                         | External | Product owner    | Worksheet with per-vendor cost drivers, pilot total, ten-tenant projection, and budget approval      | Not started |
| `RG-008` | Baseline receiving-time and inventory-accuracy measurement plan                                | External | Product owner    | Measurement plan plus recorded pre-implementation baseline from the pilot site                       | Not started |
| `RG-009` | Pilot tenant written acceptance of degraded-online behaviour (B-04)                            | External | Product owner    | Written acceptance naming the blocked-offline operations                                             | Not started |
| `RG-010` | A realistic scan round trip meets the accepted latency target                                  | Mixed    | Engineering lead | Measured p95 scan-to-ack from the pilot network against the accepted target (§5 Q5)                  | Not started |
| `RG-063` | Pilot tenant and site confirmed, with hardware, label stock, sample labels, and warehouse map  | External | Product owner    | Site confirmation listing hardware inventory, supplied samples, and a warehouse map                  | Not started |
| `RG-064` | Phase 0 budget and authorization to initialize recorded (plan §16)                             | External | Product owner    | Approval record entry                                                                                | Not started |
| `RG-067` | MVP success-criteria targets confirmed (§5 Q5)                                                 | External | Product owner    | Recorded target values for completion rate, latency, accuracy, drift, and defect thresholds          | Not started |
| `RG-068` | ERP dependency confirmed as non-launch-critical (B-07, §5 Q25)                                 | External | Product owner    | Written confirmation that CSV/XLSX import plus in-app authoring suffices at launch                   | Not started |
| `RG-069` | Volume, concurrency, and budget envelope confirmed (B-11, §5 Q41)                              | External | Product owner    | Confirmed peak scanners, inbound lines/day, and annual ledger volume                                 | Not started |
| `RG-070` | Handheld and browser fleet confirmed (D-03, §5 Q11)                                            | External | Product owner    | Device and browser inventory, including any iPad supervisory use                                     | Not started |
| `RG-066` | Notification channel need (email/SMS) confirmed (§5 Q47)                                       | External | Product owner    | Written statement of required channels for the pilot                                                 | Not started |

## Phase 1 — project and security foundations

| ID       | Gate                                                                                              | Kind     | Owner            | Evidence required                                                                                                            | Status      |
| -------- | ------------------------------------------------------------------------------------------------- | -------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `RG-011` | Organization creation, invitation, organization switch, and warehouse restriction work in staging | Mixed    | Engineering lead | Staging walkthrough record with screenshots or E2E run against staging                                                       | Not started |
| `RG-012` | Every exported tenant Convex function uses the auth/tenant wrapper                                | Code     | Engineering lead | Passing static guard in CI                                                                                                   | Not started |
| `RG-013` | Cross-tenant document IDs are rejected in automated tests                                         | Code     | Engineering lead | Green isolation tier covering every exported function family                                                                 | Not started |
| `RG-014` | No secret or real tenant data exists in demo or preview environments                              | Mixed    | Platform         | Environment audit note plus tracked-file secret scan result                                                                  | Not started |
| `RG-024` | Permission catalogue reviewed with the pilot tenant (§5 Q14)                                      | External | Product owner    | Reviewed [catalogue](./permissions.md) with tenant comments resolved                                                         | Not started |
| `RG-015` | Support-access policy confirmed, including whether grants are enabled at all (§5 Q15)             | External | Product owner    | Written policy: enablement, approval path, read-only default, audit visibility                                               | Not started |
| `RG-030` | Shared-device and privileged-session policy confirmed (§5 Q16)                                    | External | Product owner    | Written policy: session lifetimes, step-up scope, user-switching expectations                                                | Not started |
| `RG-071` | Denied read attempts are recorded, not only denied                                                | Code     | Engineering lead | A write-capable sink for query authorization attempts, plus an isolation test that finds the `DENIED` row for a refused read | Not started |
| `RG-059` | Production environment, secrets, and vendor projects separated from non-production                | External | Platform         | Environment inventory showing separate identity, data, file, and telemetry projects                                          | Not started |

## Phase 2 — inventory foundation and master data

| ID       | Gate                                                                        | Kind     | Owner            | Evidence required                                                    | Status      |
| -------- | --------------------------------------------------------------------------- | -------- | ---------------- | -------------------------------------------------------------------- | ----------- |
| `RG-016` | Random valid transaction sequences always replay to the projection          | Code     | Engineering lead | Green property suite with recorded seed range and case count         | Not started |
| `RG-017` | Reversal restores exact prior balances                                      | Code     | Engineering lead | Green property suite                                                 | Not started |
| `RG-018` | Ledger/projection drift is zero during a seven-day automated soak           | Mixed    | Engineering lead | Soak report: window, transaction count, drift checks, zero findings  | Not started |
| `RG-019` | No direct inventory-balance edit path exists                                | Code     | Engineering lead | Passing static guard plus integration test asserting absence         | Not started |
| `RG-020` | UOM conversion property suite green (exactness, rejection, precision bound) | Code     | Engineering lead | Green property suite                                                 | Not started |
| `RG-021` | Pilot location vocabulary and hierarchy reviewed and accepted (§5 Q22)      | External | Product owner    | Accepted location-type list and sample hierarchy from the pilot site | Not started |
| `RG-022` | Tenant GS1 prefix status confirmed (D-15)                                   | External | Product owner    | Written confirmation of prefix ownership or internal-LPN decision    | Not started |
| `RG-023` | Lot rotation-date policy confirmed per item class (§5 Q23)                  | External | Product owner    | Written rotation policy and shelf-life exception rules               | Not started |

## Phase 3 — inbound vertical slice

| ID       | Gate                                                                                              | Kind     | Owner            | Evidence required                                                                    | Status                                                                                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------- | -------- | ---------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RG-051` | A real PO completes receive → QC → pallet → print → putaway → inventory history on pilot hardware | External | Product owner    | Recorded run on pilot hardware with resulting ledger history exported                | Not started                                                                                                                                                                                                                                                       |
| `RG-025` | Duplicate scans and retries never duplicate stock                                                 | Code     | Engineering lead | Green integration and property tests plus a hardware double-scan trial               | Not started                                                                                                                                                                                                                                                       |
| `RG-026` | Unauthorized warehouse actions fail server-side                                                   | Code     | Engineering lead | Green permission and scope matrix tests                                              | In progress — `tests/isolation/authorization-enforcement.isolation.test.ts` proves wrapper-level refusal for ungranted codes, archived roles, cross-tenant grant rows, and out-of-scope or absent warehouses; the per-function matrix waits for feature functions |
| `RG-027` | Over-receipt tolerance and blind-receipt policy confirmed (§5 Q26)                                | External | Product owner    | Written tolerance values and blind-receipt authorization rules                       | Not started                                                                                                                                                                                                                                                       |
| `RG-028` | QC gating and AQL expectations confirmed (§5 Q27)                                                 | External | Product owner    | Written QC profile expectations and acknowledgement that AQL is out of scope         | Not started                                                                                                                                                                                                                                                       |
| `RG-029` | Printed labels remain scannable and Thai text correct after real handling                         | External | Engineering lead | Handled-sample rescan results and photographs                                        | Not started                                                                                                                                                                                                                                                       |
| `RG-037` | Measured concurrency ceiling safely exceeds the pilot peak with headroom                          | Mixed    | Engineering lead | Load-test report including worst hot-bucket contention and headroom factor           | Not started                                                                                                                                                                                                                                                       |
| `RG-035` | UploadThing data region and private-ACL capability confirmed on the purchased plan (§5 Q32)       | External | Platform         | Vendor confirmation of region and ACL behaviour, plus a private-download test result | Not started                                                                                                                                                                                                                                                       |

## Phase 4 — pilot hardening and release

| ID       | Gate                                                                                              | Kind     | Owner            | Evidence required                                                                     | Status      |
| -------- | ------------------------------------------------------------------------------------------------- | -------- | ---------------- | ------------------------------------------------------------------------------------- | ----------- |
| `RG-038` | Accepted p95/p99 scan-to-ack latency across the pilot window                                      | Mixed    | Engineering lead | SLI report over the pilot window against the accepted target                          | Not started |
| `RG-039` | ≥95% receipt-line completion on handheld without desktop fallback                                 | Mixed    | Product owner    | Completion-rate report over the pilot window                                          | Not started |
| `RG-040` | ≥99% sampled inventory accuracy, or the tenant-agreed threshold                                   | External | Product owner    | Sampling method, sample size, and measured accuracy                                   | Not started |
| `RG-041` | Zero ledger/projection drift across the pilot window                                              | Mixed    | Engineering lead | Reconciliation job history showing no drift events                                    | Not started |
| `RG-052` | Measurable receiving-cycle improvement over the recorded baseline                                 | External | Product owner    | Before/after cycle-time comparison referencing the `RG-008` baseline                  | Not started |
| `RG-042` | WCAG 2.2 AA and warehouse ergonomics audit completed and remediated                               | Mixed    | Engineering lead | Audit report, remediation list, and green a11y tier                                   | Not started |
| `RG-043` | Thai/English content completion and BE display requirements confirmed                             | External | Product owner    | Reviewed catalogues and the list of documents requiring Buddhist Era display          | Not started |
| `RG-044` | Thai operator and supervisor training materials delivered                                         | External | Product owner    | Training pack in Thai, acknowledged by the pilot site                                 | Not started |
| `RG-045` | Observability vendors selected, adapters wired, and alerts routed to an on-call recipient         | External | Platform         | Vendor selection note, alert routing configuration, and a test alert record           | Not started |
| `RG-046` | Aggregate-backed dashboard and accessible 2D occupancy map delivered                              | Code     | Engineering lead | Shipped widgets with rollup-backed queries and a green a11y assertion                 | Not started |
| `RG-065` | Backups and independent encrypted exports operating on schedule                                   | Mixed    | Platform         | Backup schedule evidence and an export artefact inventory with encryption details     | Not started |
| `RG-047` | Restore completed within the accepted RTO                                                         | External | Platform         | Restore rehearsal record: start time, completion time, data checks, RTO comparison    | Not started |
| `RG-048` | PDPA documentation pack complete with Thai counsel sign-off (B-09)                                | External | Product owner    | DPA, subprocessor register, ROPA, lawful basis, transfer safeguards, counsel sign-off | Not started |
| `RG-049` | Ledger/audit retention confirmed with legal and accounting (D-27)                                 | External | Product owner    | Written retention decision per data class                                             | Not started |
| `RG-050` | No unresolved P0 defects and ≤2 P1 defects in the final pilot week                                | External | Product owner    | Defect register extract for the final week                                            | Not started |
| `RG-056` | Privacy notice and operator disclosures exist in Thai and English (§14)                           | External | Product owner    | Published notices in both languages                                                   | Not started |
| `RG-057` | Data inventory / ROPA covers identity, device, audit, photos, support, and exports                | External | Product owner    | Completed ROPA                                                                        | Not started |
| `RG-058` | Tenant export and deletion procedures distinguish retained records from erasable personal data    | External | Product owner    | Documented procedure plus a rehearsed export/deletion run                             | Not started |
| `RG-060` | Support access, restore, onboarding, offboarding, incident, and key-rotation runbooks rehearsed   | External | Platform         | Rehearsal records per [runbook](./runbooks/README.md)                                 | Not started |
| `RG-061` | Contracts promise no unsupported region, offline operation, PITR, or unmeasured latency/RPO (§14) | External | Product owner    | Contract review note                                                                  | Not started |

## Standing merge gates

These run on every pull request rather than at a phase boundary
([ADR-0012](./adr/0012-delivery-release-and-quality-gates.md), plan §12).

| ID       | Gate                                                                        | Kind  | Owner            | Evidence required                                 | Status                                                                                                                                                                                                                                                                                         |
| -------- | --------------------------------------------------------------------------- | ----- | ---------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RG-053` | Formatting, lint, strict typecheck, and dependency audit                    | Code  | Engineering lead | Green `Static analysis` job                       | In progress — audit job absent                                                                                                                                                                                                                                                                 |
| `RG-054` | Unit, a11y, property, integration, and isolation tiers green                | Code  | Engineering lead | Green test matrix                                 | In progress — integration and isolation tiers assert the schema; unit, a11y, property, and e2e remain placeholders                                                                                                                                                                             |
| `RG-055` | Playwright smoke journey green                                              | Code  | Engineering lead | Green E2E workflow                                | In progress — placeholder journey                                                                                                                                                                                                                                                              |
| `RG-031` | Tenant-isolation tier is a blocking merge gate                              | Code  | Engineering lead | Isolation job required for merge and non-waivable | Not started                                                                                                                                                                                                                                                                                    |
| `RG-032` | No exported Convex function bypasses access wrappers                        | Code  | Engineering lead | Passing static guard                              | In progress — `verify:tenant-boundary` runs in CI and denies every registration path outside the three wrappers, plus any wrapper call with no code-owned, non-`PLATFORM` `permissionCode`; no exported feature function exists yet and branch protection is not configured in this repository |
| `RG-033` | No mutation updates or deletes ledger or audit tables                       | Code  | Engineering lead | Passing static guard                              | In progress — the `audit-append-only` rule fails any `patch`, `replace`, or `delete` naming `auditEvents`; the ledger tables it must also cover do not exist yet                                                                                                                               |
| `RG-034` | No tenant list query uses an unbounded scan or a tenant `.filter()`         | Code  | Engineering lead | Passing static guard                              | Not started                                                                                                                                                                                                                                                                                    |
| `RG-036` | Production Convex tier sized from load-test evidence, not assumption (D-25) | Mixed | Platform         | Sizing note referencing the `RG-037` load test    | Not started                                                                                                                                                                                                                                                                                    |

`RG-053`, `RG-054`, and `RG-055` are marked `In progress` because the jobs exist and
pass today, while most of what they assert is placeholder scaffolding rather than domain
behaviour. The integration and isolation tiers are the exception: their placeholders are
gone, replaced by assertions over the tenant security schema and, now, over server-side
authorization across two tenants. They close when real suites replace the remaining
placeholders and the dependency audit is added.

`RG-032` and `RG-033` are `In progress` rather than `Satisfied` for the same kind of
reason: the guards exist, run in CI, and are proved to fail on each bypass by
`tests/isolation/tenant-boundary-guard.isolation.test.ts` — but a guard over a
codebase with no feature functions and no ledger tables has not yet guarded the thing
the gate names.

## Updating this register

1. Change only the `Status` and, where needed, the `Evidence` cell. Do not renumber.
2. Link the evidence artefact when it exists. A satisfied gate with no linked
   artefact is not satisfied.
3. Mirror the change in the [coverage matrix](./specification-coverage.md) if the
   related implementation status also changed.
4. `Waived` requires a reason and the approver's role recorded in the Evidence cell.
