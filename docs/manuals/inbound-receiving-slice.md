# Purchase orders, receiving, QC, handling units, labels, and putaway

**Current availability: Authenticated read and write surfaces on desktop and
handheld.** The inbound vertical slice exists end to end: schema,
pure domain kernels, permissions, idempotent audited mutations, bounded reads, a
two-tenant isolation suite, and Thai-first operator screens on both shells. With
users without a verified tenant membership are stopped before these screens.

## What exists

### Domain kernels (`convex/model/inbound/**`, no Convex imports)

| Module              | Decides                                                              |
| ------------------- | -------------------------------------------------------------------- |
| `receiptPolicy.ts`  | Over/under/partial classification, tolerance arithmetic, line kinds  |
| `qcPolicy.ts`       | Sampling plans, QC applicability, disposition transitions            |
| `putawayScoring.ts` | Hard filters, preference, scoring, override rules, task claiming     |
| `labelPayload.ts`   | Template substitution and the canonical text an evidence hash covers |
| `poImport.ts`       | Strict delimited parsing, preview, per-row references, chunking      |

### Convex functions

| Function                                               | Permission                           |
| ------------------------------------------------------ | ------------------------------------ |
| `purchasing/orders:createPurchaseOrder`                | `purchasing.po.create`               |
| `purchasing/orders:addPurchaseOrderLine`               | `purchasing.po.update`               |
| `purchasing/orders:cancelPurchaseOrder`                | `purchasing.po.cancel` (M-C)         |
| `purchasing/orders:closeLineShort`                     | `purchasing.po.closeShort` (T)       |
| `purchasing/orders:previewPurchaseOrderImport`         | `purchasing.po.import` (query)       |
| `purchasing/orders:applyPurchaseOrderImportChunk`      | `purchasing.po.import`               |
| `purchasing/orders:listPurchaseOrders` / `…Lines`      | `purchasing.po.read`                 |
| `receiving/receipts:openReceipt`                       | `receiving.receipt.post`             |
| `receiving/receipts:postReceiptLine`                   | `receiving.receipt.post`             |
| `receiving/receipts:raiseReceivingException`           | `receiving.exception.manage`         |
| `receiving/receipts:postExceptionReceiptLine`          | `receiving.receipt.unexpected` (M-C) |
| `receiving/receipts:buildHandlingUnit`                 | `handlingUnit.build`                 |
| `receiving/receipts:listReceipts` / `listReceiptLines` | `receiving.receipt.read`             |
| `masterData/catalogue:listReceivingLocations`          | `masterData.location.read` (query)   |
| `masterData/catalogue:resolveScanToItem`               | `masterData.item.read` (query)       |

Every mutation above also moves the dashboard counter its transition owns —
receipts opened, lines posted, inspections waiting or parked, putaway ready or
claimed — in the same transaction. See
[Dashboard and reporting](./dashboard-and-reporting.md).
| `quality/inspections:submitDisposition` | `quality.disposition.submit` |
| `quality/inspections:approveDisposition` | `quality.disposition.approve` (M-C, step-up) |
| `quality/inspections:listInspections` | `quality.inspection.read` |
| `labels/print:generateLabel` | `label.print.execute` |
| `labels/print:reprintLabel` | `label.print.reprint` |
| `labels/print:listPrintJobsForTarget` | `label.print.read` |
| `putaway/tasks:recommendPutawayLocations` | `putaway.task.read` (query) |
| `putaway/tasks:claimPutawayTask` | `putaway.task.claim` |
| `putaway/tasks:confirmPutaway` | `putaway.task.confirm` |
| `putaway/tasks:listPutawayTasks` | `putaway.task.read` |

M-C = maker-checker; T = threshold.

### Screens

| Route                              | Shell    | What it does                                                   |
| ---------------------------------- | -------- | -------------------------------------------------------------- |
| `/{locale}/purchasing/orders`      | Desktop  | Order register; create an order                                |
| `/{locale}/purchasing/orders/{id}` | Desktop  | Lines, close-short, add a line, open a receipt against it      |
| `/{locale}/purchasing/import`      | Desktop  | Check a file, then write it in chunks with progress and resume |
| `/{locale}/receiving`              | Desktop  | Receipt register; open a receipt; raise an exception           |
| `/{locale}/receiving/{id}`         | Desktop  | Received lines, capture, pallet build, label evidence          |
| `/{locale}/quality`                | Desktop  | Inspection queue, disposition, second-actor approval           |
| `/{locale}/putaway`                | Desktop  | Task board, recommendation explanation, confirmation           |
| `/{locale}/handheld/receive`       | Handheld | Pick an order, open a receipt, scan lines                      |
| `/{locale}/handheld/quality`       | Handheld | The inspection queue and its decisions                         |
| `/{locale}/handheld/putaway`       | Handheld | Claim, read the recommendation, confirm                        |

Both shells share the routes' data, the write contract, the status vocabulary,
and the formatters (UX plan §1). What differs is the shell: the handheld screens
are touch-sized, scan-first, and step-gated, and the desktop screens are
registers with detail pages.

## The journey, and what each step guarantees

### 1. The order

Authored (`createPurchaseOrder` then `addPurchaseOrderLine`) or imported. An
order is created `DRAFT` and becomes `OPEN` when it gets its first line: an order
with nothing on it is not receivable, and putting one in the receiving queue
gives somebody at a dock nothing to do.

`orderedQuantity` is stored in the unit the _order_ was written in, and
`orderedBaseMinorUnits` alongside it in the item's base unit. A supplier selling
cases and a ledger storing eaches is the normal case; the conversion goes through
the item's own UOM profile and `convertToBase`, and a conversion that does not
land on a whole minor unit is **refused rather than rounded** — a rounded order
quantity disagrees with the supplier's paperwork by a unit nobody can account
for.

### 2. The import

`previewPurchaseOrderImport` is a **query**. It parses, reports, and cannot
write; an operator approving three hundred lines is approving a parse whose only
effect was to produce the list in front of them.

The parser refuses rather than recovers. A row with the wrong column count is
reported by its spreadsheet line number, not guessed at — guessing puts a
quantity in the item column and orders a product that does not exist. Bad rows do
not sink the file: the accepted rows are still shown and still written, because
an import that refuses everything over one bad line teaches people to fix the
file by deleting rows.

`sourceRowRef` is `<batchRef>:<lineNumber>` and it is the row's idempotency key.
`applyPurchaseOrderImportChunk` writes at most `MAX_CHUNK_SIZE` lines per call,
returns a cursor, and skips any row whose reference already exists — so a chunk
replayed after a crash creates nothing and says how many it skipped
(`INV-0007-12`).

`papaparse` is installed and remains unused. Its error recovery is exactly the
behaviour this path must not have.

### 3. The receipt

One mutation does the whole posting inside **one transaction**: convert, assess,
decide QC, post the ledger, write the receipt line, advance the running total,
open the putaway task. A receipt line without a `transactionId` is impossible —
the column is required — because a receipt the ledger never saw is the drift
`ADR-0003` exists to prevent.

**Tolerance is assessed against the line total, not the posting.** Two postings
of 60 against an order of 100 is an over-receipt; a rule that asked "is _this_
posting over?" answers no twice and lets 120 units in. Over-tolerance is refused
by `postReceiptLine` rather than accepted, because the approval is a different
permission with maker-checker on it (`INV-0007-02`).

The tolerance itself is an exact `Ratio` and the allowance **rounds down**.
Rounding up would make a tenant's configured tolerance larger than the number
they configured, by a different amount at every order quantity.

`OPS-0007-02` — confirming the tolerance with the pilot tenant — is open, so
every deployment today runs with no tolerance configured. That is the fail-closed
reading: every extra unit needs an approval.

**Lot capture** is required for a `LOT`-tracked item and refused for an untracked
one. Manufacture and expiry dates are captured on the way in and stored as
business dates in the organization's timezone.

**Every reference the form offered is revalidated by the mutation.** A picker is
a suggestion, not a constraint: the browser chose from a list, and nothing stops
a caller from sending something else. So `postReceiptLine` re-checks, and refuses
by naming the field:

| Refusal                     | When                                                                          |
| --------------------------- | ----------------------------------------------------------------------------- |
| `LOCATION_NOT_RECEIVABLE`   | the location is inactive, in another warehouse, or not a dock or staging lane |
| `LINE_NOT_ON_RECEIPT_ORDER` | the order line belongs to a different purchase order than the receipt         |
| `ITEM_NOT_ON_LINE`          | the item is not the one that line ordered, on the ordinary path               |

The last one matters most: an unexpected item is not an ordinary posting, it is
the exception a second person decides on (`INV-0007-06`), and accepting it here
would have routed round maker-checker without anybody noticing.

**The dock list is index-served, not scanned.** `listReceivingLocations` reads
through `by_orgId_warehouseId_status_locationType_code`, one bounded read per
receiving type. The type is in the index prefix, so a warehouse with thousands of
rack bins cannot hide its own dock behind them — which a bounded scan filtered
afterwards did, and would have told an operator standing on a dock that the site
has none.

### 4. Exceptions, and why they need a table

`receiving.receipt.unexpected` and `receiving.receipt.blind` carry maker-checker
in the catalogue, and maker-checker needs a **maker**. The evaluator denies
fail-closed when there is none — correctly — which would have made every
exception receipt impossible.

So exceptions are raised: one actor calls `raiseReceivingException` with a reason
under `receiving.exception.manage`, and a _different_ actor posts against it. The
raised row is the maker. The exception moves to `CONSUMED` when a line is posted
against it, so one raised exception authorizes one posting rather than standing
open as a permanent bypass.

The **kind is decided by the server** from the rows it read — never from a
client-supplied label. A handheld that could declare its own posting `ORDERED`
would route an unexpected delivery around the permission built to catch it.

### 5. Quality control

A receipt lands in `QC_HOLD` when a QC profile matches, and the **more specific
profile wins**: an item profile beats a supplier profile. With no profile the
answer is _not controlled_, which is the honest default for an unconfigured
tenant — inventing a hold nobody configured would strand stock at the dock on day
one. `OPS-0007-03` is the open gate that says which items and suppliers are
actually gated.

The sample plan is **computed and stored at receipt**, not resolved later. A
profile changes; the plan applied to this delivery does not, and it is the
evidence an auditor reads. `ALL`, `FIXED`, and `PERCENT` only — `AQL` is refused
**by name** rather than falling back, because a silent fallback would let a
regulated customer believe a sampling plan had been applied that never was.

A disposition is a **balanced ledger transition**, never a status edit: the held
quantity out of `QC_HOLD` and into the target status, at the same location, in
one `STATUS_CHANGE` transaction. `RELEASE` and `SCRAP` are parked for a second
person; `QUARANTINE`, `REJECT`, and `REWORK` post immediately, so a delivery is
not blocked waiting for a supervisor over a decision that keeps the stock
unavailable anyway.

**The putaway task is created by the release**, not by the receipt, for stock
that was held. A putaway queue entry for `QC_HOLD` stock would be an invitation
to the exact bypass `INV-0007-05` forbids.

### 6. Handling units

`buildHandlingUnit` creates the pallet and attaches the named receipt lines. It
posts **no ledger transaction**: the stock is already in the bucket it was
received into, and a pallet is a way of referring to it rather than a movement of
it. Posting a movement to "build" a pallet would double the transaction count for
no change in balance.

### 7. Labels — and where this stops

The payload is rendered from a **published** template version, stored, and
hashed. The hash is over the _canonical text_ — template code, version, format,
then payload — not the payload alone, because two versions can render
byte-identical payloads and a hash that could not tell them apart would defeat
the versioning it exists to prove (`INV-0007-07`).

An unfilled placeholder is an **error**, not a blank: a label with an empty lot
code looks exactly like a correct one from two metres away on a forklift.

Then it stops, and the boundary is the point:

- **No printer transport.** `INT-04` does not exist. Nothing is transmitted.
- **No physical print, application, or rescan.** `RG-004` and `RG-029` are open.
- **No PDF.** `pdf-lib` is installed and unused; the PDF fallback of `ADR-0007`
  §10 is not implemented.
- **No `PRINTED` status.** A print job reaches `GENERATED`. `DISPATCHED` and
  `FAILED` are declared so the state machine is complete and are unreachable
  until a transport exists. A status claiming a label came out of a printer would
  be the single most misleading row in the database.

Reprints are a distinct permission and a distinct stored `reason`, because three
labels for one pallet is either a jammed printer or a label being applied to
stock that moved, and the two must be tellable apart.

### 8. Putaway

The recommendation is **deterministic** (`INV-0007-10`): hard filters first, then
preference, then scoring, with a total order that breaks ties by location code.
Without that tiebreak the same warehouse would rank differently depending on how
the database returned rows.

Hard constraints **remove** candidates rather than scoring them down: a rejected
bin that were merely scored low could be floated back to the top by a high enough
preference score. Docks and staging lanes are never targets — stock left on a
working surface has not been put away, and the task would "complete" without the
pallet moving.

The trace is stored on the task when it is **claimed**, and the confirmation
validates against _that_ trace. Recomputing at confirmation would validate
against a warehouse that may have changed while the operator walked to the rack,
silently turning a legitimate choice into an override or the reverse.

Claiming is compare-and-set against the row as re-read inside the transaction, so
two handhelds pressing at once resolve on the write (`INV-0007-11`).
Re-claiming a task you already hold succeeds — an operator whose screen
reconnected should not be told they lost their own task.

An override may take any **ranked** location with a reason, and may never take a
location a hard constraint rejected (`INV-0007-08`). The task records the
recommended location, the chosen one, the actor, and the reason — all four,
because any three of them make override analytics a count with no content.

## A defect this slice found

`MAX_TRANSACTION_LINES` was 200 while the tenant-bound reader refuses a `take`
above `TENANT_INDEX_MAX_PAGE_SIZE` (100). A transaction's lines are read back on
every **replay** (`INV-0003-01`) and every detail read, so the ledger could write
transactions it could never read: every idempotent retry of a posting failed with
`INVALID_LIMIT`.

Nothing had exercised a ledger replay through a mutation before, so the defect
was latent from the day the ledger landed. The cap is now 100 — equal to the read
cap, with the coupling stated at the constant — and
`tests/integration/inbound-slice.integration.test.ts` replays a real posting
through a real mutation to keep it that way.

## Cross-tenant behaviour

Proved in `tests/isolation/inbound-slice.isolation.test.ts`, a blocking merge
gate (`RG-031`, `RG-026`):

- Both tenants may hold the same PO number and the same receipt number.
- An order whose supplier belongs to another tenant is `REFERENCE_NOT_FOUND`.
- A line whose item belongs to another tenant is refused, and no row is written.
- A posting into another tenant's receipt is refused, and no receipt line exists
  afterwards.
- A disposition against another tenant's inspection is `NOT_FOUND` — the same
  answer a nonexistent inspection produces.
- A label from another tenant's template is refused by field name.
- Another tenant's putaway tasks never appear in a list, and claiming one is
  `NOT_FOUND` with the task left untouched.
- Every row written carries the writing tenant's `orgId`, derived from the
  resolved context and never an argument (`INV-0001-02`).

## What the screens say, and why

Two states are worded rather than implied, because each has a version that
misleads:

- **A parked disposition is not a failure.** Release and scrap wait for a second
  person, and the QC screen explains that before the operator submits, so the
  `PENDING_APPROVAL` state reads as the rule working.
- **A claimed task is not a permission problem.** The board shows a claimed task
  as claimed and still offers the control, because re-claiming your own task
  after a reconnect succeeds and claiming somebody else's is refused with a
  message that says which (`INV-0007-11`).

The approval control is shown to everybody, including the person who submitted
the disposition. They will be denied, and the denial with its request ID is what
teaches that a second person is required; hiding the control would make a
maker-checker rule look like a missing feature (`INV-0002-07`).

### No screen asks for a document ID

Every inbound field whose name ends `Id` is a `select` fed by a tenant-scoped
catalogue read, or — for the item on a carton — a scan the server resolves.
Supplier, item, order, order line, receiving location, reason code, label
template, inspection, and putaway location are all chosen; the operator sees a
code they recognise and the mutation receives the identifier it needs.

This is not cosmetic. A free-text `supplierId` produces `REFERENCE_NOT_FOUND` on
a field nobody could have filled correctly, which reads as a broken screen rather
than as a missing choice. `tests/integration/inbound-real-mode.integration.test.ts`
asserts the rule structurally over the feature source, because the failure is
invisible to the type checker — `"prv_loc_DOCK-IN-1"` is a perfectly good
`string` — and can be missed when tests use a valid fixture value.

The approver's inspection is chosen from the pending queue for the same reason
with a sharper edge: the approver is by construction _not_ the person who
submitted, so an inspection ID typed into their screen would have to have reached
them by screenshot.

## What is deliberately absent

**GS1 element strings, and the rest of the scan ladder.** The capture screen does
resolve a scan: `masterData/catalogue:resolveScanToItem` answers the item behind
an active barcode or SKU, indexed and tenant-scoped, and the form selects the
matching order line from it. What it does **not** do is read a GS1 element string
into item, lot, and expiry at once, or resolve an LPN to a handling unit.

The missing contract is exact. `convex/model/identifiers/scanResolution.ts`
decides _what a string is_ — GS1, internal LPN, GTIN, SKU — and says in its own
header that resolving an interpretation _to a document_ belongs to the Convex
layer. Binding it needs three things this slice does not have: a per-tenant LPN
namespace policy (prefixes and the `bareSscc` flag), a mutation argument that
accepts a raw scan rather than resolved IDs so `INV-0005-12` can persist the scan
next to its interpretation, and a decision about which of a GS1 string's fields
outrank what the operator typed. Until then the two rungs a local catalogue can
answer — barcode and SKU — are served, and the rest is refused rather than
guessed. The camera fallback of `INT-03` is also absent.

**QC photo attachments.** `ADR-0007` §7 requires evidence attachments stored
privately. That needs the file-storage port (`ADR-0008`) and a retention
decision this slice has not made.

**Over-tolerance approval as its own entry point.** `receiving.receipt.overTolerance`
exists in the catalogue and no mutation declares it; over-receipt is currently
refused rather than approvable. Making it approvable needs the same
raised-exception shape the unexpected path uses, and the threshold policy table
(`RG-030`) that does not exist.

**Mixed-content limits on a pallet.** `handlingUnit.mixedContent` carries a
threshold and no policy table exists (`RG-030`), so `buildHandlingUnit` declares
`handlingUnit.build` and mixing is unrestricted. Stated rather than silently
allowed.

**Degraded-connectivity queued intents.** `ADR-0009`'s queued-intent UI is a
client concern and arrives with the screens.

## External gates this slice cannot close

| Gate     | What it needs                                                    |
| -------- | ---------------------------------------------------------------- |
| `RG-003` | A scanner spike on the actual rugged device and browser          |
| `RG-004` | A physical ZPL label printed in Thai and English, and rescanned  |
| `RG-029` | Printed labels still scannable after real handling               |
| `RG-051` | A real PO completing the journey on pilot hardware               |
| `RG-027` | Over-receipt tolerance and blind-receipt policy confirmed        |
| `RG-028` | QC gating and AQL expectations confirmed                         |
| `RG-030` | A threshold policy table, for over-tolerance and mixed content   |
| `INT-04` | A printer transport adapter                                      |
| Clerk    | A configured instance, before any of this runs for a real tenant |

## Related

- [Inventory ledger](./inventory-ledger.md)
- [Master-data catalogue](./master-data-catalogue.md)
- [Master-data entities](./master-data-entities.md)
- [Quantities and UOM](./quantities-and-uom.md)
- [Barcode and identifier processing](./barcode-and-identifiers.md)
- [Roles, permissions, and audit](./roles-permissions-and-audit.md)
- [ADR-0007 — Inbound vertical slice scope](../adr/0007-inbound-slice-scope.md)
