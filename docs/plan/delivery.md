# Delivery

## State

| Area                                    | State               |
| --------------------------------------- | ------------------- |
| Toolchain and tenant security           | Local code complete |
| Inventory primitives and ledger         | Local code complete |
| Master data and inbound                 | Local code complete |
| Dashboard, occupancy, exports           | Local code complete |
| Order-to-factory Phase 5A               | Local code complete |
| Shared operator platform (full-flow P1) | Local code partial  |
| Opening stock and physical count (P2)   | Local code partial  |
| Stock-ready order to delivery (P3)      | Local code partial  |
| Transfers and replenishment (P4)        | Local code partial  |
| Repeat production execution (P5)        | Local code partial  |
| New-design readiness and impact (P6)    | Local code partial  |
| Operational reports and exceptions (P7) | Local code partial  |
| HR attendance and leave (P8)            | Local code partial  |
| Integration health and recovery (P9)    | Local code partial  |
| Real identity and tenant proof          | Open                |
| Printer and scanner proof               | Open                |
| Load, restore, and pilot proof          | Open                |
| Legal and production approval           | Open                |

**Shared operator platform, exactly.** Local code and local tests cover the device
registry and `deviceId` lifecycle, the task claim/lease/heartbeat/release/reassignment
contract with partial evidence preserved, the shared quantity-entry and UOM contract
including Thai digits, supervisor step-up granted on the operator device as a
single-use, retry-idempotent approval, and the code-owned
`QUEUEABLE`/`BLOCKED_OFFLINE` classification with its bounded browser intent queue
that never evicts an in-flight request. Expired task leases refuse new evidence,
while an identical retry of already-written evidence still replays after expiry.
The shared item scan surface now resolves HID or declared-manual input, previews
the active tenant item, requires explicit confirmation, blocks wrong-task items,
records the resolution and manual reason server-side, and asks for explicit
confirmation of an immediate duplicate. Camera fallback, scanner prefix/suffix
profiles, focus recapture, and physical-device proof remain open. A paged activity
timeline now renders the append-only evidence inherited with a task. The exception
sheet records a reason, observed evidence, proposed disposition/recovery action,
and a different supervisor's maker-checker decision. The shared task header keeps
document, source, owner, due time, progress, server connection, and the irreversible
completion warning visible. Device registration now supports explicit binding of
the current private browser installation without exposing its correlation value.
The quantity surface connects Thai-digit entry and base-UOM evidence to the
same-device supervisor step-up UI, passes the resulting single-use grant back into
the blocked entry, and names the offline, unbound-device, self-approval, expiry,
and refusal paths. Private task evidence now follows the UploadThing capability
chain: held-task authorization, verified digest/size registration, tenant-bound
metadata, and a fresh actor/warehouse-bound one-use download grant; provider keys
never appear in the list UI. The desktop command centre and the complete
state gallery are **not built**. Nothing here has run against a
Convex deployment, a real Clerk identity, or a
physical handheld. Row-level detail is in
[coverage §5b](../specification-coverage.md); the phase exit gate stays open.

**Opening stock and physical count, exactly.** Local code now covers durable
opening batches, row-level validation, exact UOM conversion, independent approval,
bounded balanced posting, count plans and ledger snapshots, blind handheld capture,
movement-aware and frozen-count checks, independent recount, quantity/value risk,
root cause, stepped-up maker-checker adjustment, idempotent replay, and dual-key
paper fallback. Desktop opening/count/reconciliation routes and the handheld count
queue are available in Thai and English; automated unit, property, integration,
tenant-isolation, accessibility, preview E2E, build, and repository guards pass.
The current opening workbench captures one row per controlled import step; full file
mapping, multi-chunk browser orchestration, warehouse map/ABC filters, load proof,
real-device scanning, and staging identity evidence remain open, so P2 is not a
release-complete claim.

**Stock-ready order to delivery, exactly.** Local code now covers fulfillment
orders and lines, ATP with active-reservation subtraction, FIFO/FEFO allocation,
partial/backorder quantities, pick-wave planning, scan evidence, short/damage,
independent checking, packing, staging, ledger-backed issue, shipment and trip
planning, exact package loading, sealing, maker-checker gate release, departure,
POD capture/review, document return, and delivered/backordered reconciliation.
Shipment and trip queues are bounded and resumable; the current UI explicitly warns
when its 100-row operational view is incomplete. POD files use an expiring upload
grant, verified UploadThing callback metadata, tenant-bound attachment, and a fresh
actor/warehouse-bound one-use access grant. Thai/English desktop fulfillment and
transport screens plus handheld pick/load/delivery screens exist, with local domain,
integration, isolation, accessibility, and passing preview E2E journeys. Cancellation
of remaining demand and failed-delivery receipt into QC hold are now ledger-safe,
bounded, replay-safe actions. Exact issue reversal before shipment assignment is
also implemented with maker-checker and step-up enforcement. FEFO override,
substitution, interruption handover, printable Thai delivery/gate/POD documents,
retention/redaction, target-device, weak-network, load, deployed identity, and pilot
evidence remain open. Therefore P3 is partial, not release complete.

**Transfers and replenishment.** The first local P4 vertical slice now covers a
two-warehouse request and line aggregate, maker-checker approval, partial source
dispatch, balanced source and destination `MOVE` transactions through the
code-owned `TRANSFER_IN_TRANSIT` boundary, partial destination receipt, replay
safety, and an owned open discrepancy for missing/damaged/wrong-tag quantity. The
desktop preview exposes request, approval, dispatch, destination receipt, discrepancy
resolution, and both queues. Found-at-destination and returned-to-source discrepancy
resolution post the remaining transit quantity and can close the transfer.
Non-discrepancy return, write-off approval, cancel-remaining, replenishment recommendation scoring, dedicated handheld scan
surfaces, aging/SLA escalation, and deployed/device/load proof remain open. P4 is
partial.

**Repeat production execution.** The local P5 seam routes customer demand before
factory handoff, records available-stock commitment and exact production shortage,
and refuses a factory packet without a linked production route. Each production run
is pinned to the acknowledged packet, fulfillment line, exact released revision,
route, BOM, output item, remaining-shortage target, and due date. A completed run
with scrap or rejected output may create one non-overlapping recovery run for only
the unreleased remainder. Independent release, exact-lot
material issue through the inventory ledger, immutable issue genealogy, operation
good/scrap/rework and downtime reports, FG receipt into `QC_HOLD`, and independent
release/reject status movement are implemented. Quantity conservation and retry
safety are covered by pure-domain and Convex integration tests, and Thai/English
desktop plus responsive handheld surfaces show the five-step flow and six guarded
actions. Material shortage/purchase-demand handoff, capacity, material return and
reversal, WIP tags/moves, backflush/substitution/over-production policy, partial
close, dedicated scan ergonomics, event-driven automatic allocation resumption, and external
device/deployment/load/pilot proof remain open. P5 is partial.

**New-design readiness and revision impact.** The first local P6 vertical slice
adds immutable requirement-checklist versions, an explicit `INCOMPLETE`/`READY`
gate on every newly created design request, and structured presence checks for
print, packing, route, BOM, and quality facts. Exact or human-confirmed similar
design fulfilment is blocked while the current checklist is incomplete. Releasing
a newer revision creates a semantic change-impact obligation for each active
production order pinned to the prior revision, while leaving that order's pin
unchanged. Production can acknowledge the impact with an audited note without
silently repinning. Thai/English Engineering readiness and Production impact
surfaces, pure-domain tests, and Convex integration evidence are local. File-level
diffs, waiting-order projections, sample/first-article and customer approval,
controlled replan/repin, automatic production demand and Path A/POD continuation,
external identity/device/load/pilot proof, and Thai domain-speaker approval remain
open. P6 is partial.

**Operational reports and exception command center.** The first local P7 vertical
slice adds warehouse-scoped Stock Balance, Stock SKU, Stock Lot, and Stock Movement
views. The SKU view separates available, committed, ATP, QC hold, rejected, and
other stock; the Lot view exposes expiry and restricted quantity; Movement retains
the immutable transaction, exact signed quantity, source bucket dimensions, actor,
device, and reversal reference. A severity/age-ranked command center combines open
operator-task, receiving, production QC-hold, and design-change obligations with
links to their owning workflow. Every view exposes an `asOf` instant and whether
its bounded source set is complete. Pure aggregation, Convex integration, tenant
isolation, accessibility, and Thai/English preview evidence pass locally.
Historical as-of, scalable full projections and running balance, broader operational
exception sources/SLA ownership, URL filters, cost controls, dedicated exports,
exact-record deep links, load/deployment/pilot proof, and projection rebuild remain
open. P7 is partial.

**HR attendance and leave.** The first local P8 vertical slice now separates an
employee from login identity; records immutable clock/break/correction evidence and
a current attendance-day projection; uses server receipt time plus tenant timezone;
and makes a repeated clock command replay-safe. Employees can request traceable time
corrections and non-overlapping leave, while an independently verified team
supervisor can approve/reject under maker-checker. Self reads include the employee's
private reason, but the team inbox exposes only identity, request kind, dates/capacity
summary, and timing. Team membership is checked in addition to warehouse RBAC, and
system administrators do not inherit team, employment, period-close, or payroll HR
permissions. Thai/English desktop and handheld flows, unit, Convex integration,
isolation, accessibility, and preview E2E evidence exist locally. Employee/team admin,
shift/holiday/OT rules, leave balances, private evidence upload, closed periods and
post-close adjustment, payroll output, offline queue persistence, kiosk privacy,
projection rebuild, device/load/deployment/retention/pilot proof remain open. P8 is
partial.

**Integration health and recovery.** The first local P9 vertical slice adds a
provider-neutral transactional outbox seam with stable event keys, versioned payload
metadata, digest conflict detection, bounded delivery leases, exponential retry,
dead-letter handling, and immutable attempt history. Adapter registration stores a
configuration reference rather than credentials; claim, result, and manual retry are
tenant-bound and replay-safe. Failure degrades the adapter without reversing the
first-party business transaction. A Thai/English supervisor workbench presents
available, delayed, blocked, disabled, bounded-count, safe-next-action, and sanctioned
manual-fallback states without exposing payload or response bodies. Pure domain,
Convex integration, tenant isolation, accessibility, preview E2E, build, and local
guard evidence exist. Real source-transaction wiring, worker/machine identity,
provider ADRs and contracts, credential storage/rotation, inbound ordering/dedupe,
timeout and partial-response drills, source/correlation drill-down, real ERP/webhook/
notification/GPS/printer adapters, load/deployment/pilot proof, and rollback rehearsal
remain open. P9 is partial.

## Next

1. Configure Clerk and Convex staging.
2. Prove tenant isolation with real identities.
3. Test target scanners and printers.
4. Run load and conflict tests at target scale.
5. Prove backup, restore, export, and retention.
6. Complete Thai operator accessibility tests.
7. Run one-factory pilot.
8. Close legal, security, and release gates.

## Change rule

- New scope changes [Project goal](./project-goal.md).
- New domain behavior changes [Business logic](./business-logic.md).
- New data shape changes [Database](./database.md).
- New architecture requires an [ADR](../adr/README.md).
- Every release claim needs gate evidence.

The [release gate register](../release-gates.md) owns status and proof.
