# ADR-0013 — Order to ship: design authority, exact matching, and the factory packet

- ID: `ADR-0013`
- Status: **Accepted**
- Date: 2026-08-15
- Decision baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §2.4, §7.6, Phase 5A;
  [order-to-ship operating plan](../figma-order-to-ship-operating-plan.md) §2.1,
  §2.2, §3, §4.1, §4.2, §7 Phase 5A
- Covers plan ADR backlog (§11) items: none — this is a slice ADR, not one of the
  26 cross-cutting topics
- Implementation status: **Implemented (Phase 5A only).** The eight tables, the
  pure decision kernel under `convex/model/orderToShip/**`, and the functions under
  `convex/sales/**`, `convex/engineering/**`, and `convex/production/**` exist and
  are enforced by the tenant boundary guard, the schema policy contracts, and the
  test tiers. Phases 5B–5F — factory orders, material requirements, production
  execution, production QC, reservation, and shipment — are **not** implemented and
  are deliberately out of scope here.

## Context

The FigJam board describes an order-to-ship flow whose first increment is narrow
and whose failure modes are expensive. A customer sends a purchase order; sales
records it; each line is classified as an existing design or a new one; new designs
go to engineering, get approved, and come back; and the line eventually reaches the
factory floor as a printed document (operating plan §2.1, §2.2).

Three facts about that flow drive every decision below.

**The factory builds from paper.** A packet is printed and carried to a machine.
Whatever the system says afterwards, the operator builds what the paper says. So
the identity a packet cites has to name one immutable thing, forever.

**"Have we made this exact box before" is the question the slice exists to answer.**
Getting it wrong in the permissive direction — treating a near match as a match —
re-uses a dieline nobody chose for this order. Getting it wrong in the strict
direction merely creates a design request that engineering closes quickly.

**Sales and engineering disagree about what "done" means, and both are right.**
Sales needs a date; engineering needs the design to be correct. The mechanism that
resolves this cannot be a permission an engineer can grant themselves.

A fourth fact is structural rather than domain: the repository already has a
supplier-facing `purchaseOrders` table from the inbound slice (`ADR-0007`). The
words "purchase order" mean opposite directions on the two sides of the business,
and reusing the table would put customer demand inside every receiving read.

## Decision

### Documents and naming

1. **`customerOrders` is the customer PO and the internal sales order, as one
   document** (`G-120`). Supplier `purchaseOrders` (`G-060`) are untouched and are
   never reused for customer demand (operating plan §3).
2. **`customers` is a separate register from `suppliers`.** The same legal entity
   may appear in both; a customer product code is unique per customer, and merging the two
   registers would make that contract mean "per party in either direction", which
   is not a rule anybody stated.
3. **A master card (`G-126`) is identity; a revision (`G-127`) is content.** The
   card holds no specification, so nothing downstream can point at a card and mean
   a design.

### The design decision

4. **The exact match is the customer's identity, not inferred geometry.** The lookup
   is an indexed equality on `(orgId, customerId, customerProductCode)` against the
   customer's master cards, resolved to that card's released revision. `designKeyOf`
   remains a structural fingerprint used only to rank suggestions for a person.
5. **The design source is decided by the system, never supplied by the caller**
   (`G-124`). `addCustomerOrderLine` takes a specification, not a decision.
6. **A near match is `NEW` until a person confirms it.** Similarity scores are
   advisory and never enter the automatic decision path.
7. **A `NEW` line raises its design request in the same transaction as the line.**
   An `AWAITING_DESIGN` line with no request is invisible work: not in engineering's
   queue, not blocking anything in sales.
8. **One line raises at most one design request**, enforced as a uniqueness contract
   on `(orgId, customerOrderLineId)`. The link lives once, on the request; the line
   does not carry a request pointer, because the two inserts would have to be
   circular for it to.

### Revision lifecycle and maker-checker

9. **Revision numbers are gap-free from 1, unique per card, and never reused**,
   including after a rejection. "Rev 3" names one document forever, including on
   paper.
10. **A `RELEASED` revision is immutable in every field except
    `supersededByRevisionId`.** That one exception records that a later revision now
    exists; it changes no dimension, no grade, and no file.
11. **The author cannot approve their own revision, and neither can the submitter.**
    Enforced twice, deliberately: `engineering.masterCard.release` carries
    `MAKER_CHECKER`, so the authorization evaluator denies and records a denial; and
    `checkRevisionDecision` refuses in the domain kernel, naming which field made the
    actor the wrong person. Neither check substitutes for the other.
12. **The default approver role cannot draft or submit.** A checker who can become a
    maker is one person with two hats.
13. **A revision cannot enter review without a complete structured specification and
    at least one retrievable verified private file.** Metadata alone is not evidence.

### The factory packet

14. **A packet pins exactly one released revision** and refuses every other status.
15. **A packet carries a snapshot of the pinned specification, production route,
    approved-file IDs, release evidence, SO, and customer-PO references**, not a live read.
    Combined with decision 10 the snapshot can never disagree with the revision — it
    is belt and braces, and it is what makes decision 16 possible.
16. **Production roles hold no `engineering.*` permission.** The floor reads the
    packet, so an unreleased revision cannot reach it at all.
17. **Cancelling a packet returns the line to `DESIGN_READY` and leaves the pinned
    revision alone.** Nothing about the design changed; only the decision to build it
    now.

### Files

18. **Master-card files are private and every access is a fresh permission check**
    (`ADR-0008`). Access is a **mutation**, not a query, because a Convex query
    cannot write and a denied read would therefore go unrecorded (`RG-071`).
19. **Phase 5A uses the private Convex-storage adapter behind `PrivateFileStoragePort`.**
    Upload authorization, retrievability verification, and every download happen
    only after the tenant wrapper authorizes and audits the request. The browser
    receives a one-use gateway URL, never a generic storage upload URL. The
    gateway atomically claims the tenant/revision grant, stores the bytes, and
    binds the resulting `_storage` ID to that exact grant before attachment can
    accept it. Submission and packet issue re-inspect every `AVAILABLE` object so
    a file removed after attachment fails closed. The external UploadThing
    `INT-03` rollout remains gated by `RG-035`.

### Scope boundary

20. **Phase 5A stops at an acknowledged factory packet.** No factory order
    aggregate, no material requirements, no route execution, no production QC, no
    reservation, no shipment (operating plan §7). A packet is not an `FO`, and
    Phase 5B decides whether the `FO` is a new aggregate or an expansion of
    `productionRelease`.

## Invariants

### Code-owned guarantees

- `INV-0013-01` A customer order line's design source is derived, not supplied: it
  is `EXISTING` exactly when customer + normalized customer product code resolves
  to a `RELEASED` revision of that customer's master card, and `NEW` otherwise, in
  which case a design request is written in the same transaction.
  `(orgId, customerId, customerProductCode)`
  is unique on `masterCards`, so the match is never ambiguous.
- `INV-0013-02` A `RELEASED` master-card revision is immutable except for
  `supersededByRevisionId`; `(orgId, masterCardId, revisionNumber)` is unique and
  numbers are never reused; and anything that resolves to a revision — a fulfilment,
  a packet — must match the customer product identity it was raised for, so a different box can
  never be substituted silently.
- `INV-0013-03` The decider of a revision is never its `authoredByUserId` and never
  its `submittedByUserId`, enforced independently by the authorization evaluator
  (`MAKER_CHECKER`, `INV-0006-05`) and by `checkRevisionDecision`.
- `INV-0013-04` Every factory packet pins exactly one `RELEASED` revision and stores
  its specification, route, approved files, release evidence, SO/PO references, and
  revision number; no production permission
  grants read access to any engineering table.
- `INV-0013-05` Every design obligation resolves to exactly one artefact: one order
  line raises at most one design request (`(orgId, customerOrderLineId)` unique), and
  a revision cannot leave `DRAFT` for `IN_REVIEW` without a complete specification
  and a retrievable verified file.

### Operational assumptions

- `OPS-0013-01` The tenant's customer and customer product codes are stable enough that
  an exact match is the right default; the pilot confirms this before `WF-04`
  similarity work is scheduled.
- `OPS-0013-02` Engineering has enough approvers that maker-checker does not
  deadlock a one-person department. A tenant with a single engineer cannot release
  anything, and that is the intended behaviour, not a defect.
- `OPS-0013-03` The pilot confirms whether Convex private storage remains the
  Phase 5A adapter or external `INT-03` is required before production rollout.
- `OPS-0013-04` Printed packets are treated as controlled documents by the tenant —
  a superseded revision's paper is withdrawn from the floor. The system records the
  supersession; it cannot collect the paper.

## Consequences

- Two registers for parties means a dual-role entity is maintained twice. Accepted:
  the alternative puts sales demand in every receiving read.
- Exact matching will create design requests that an engineer closes by pointing at
  an existing revision. That is cheap; the reverse error is not.
- Immutable released revisions mean a typo in a released specification costs a new
  revision number. That is the point: the number is what the floor cites.
- Maker-checker on release means a one-engineer tenant cannot release. Documented as
  `OPS-0013-02` rather than softened with a self-approval escape hatch.
- The packet snapshot duplicates the specification. The duplication is what lets
  production hold no engineering permission at all.
- A file row becomes `AVAILABLE` only after the adapter can resolve its stored
  object; submission and packet issue fail closed otherwise.
- A legacy row may import as `RELEASED` only when it carries explicit author,
  optional submitter, independent decider, decision time, and decision note from
  the source authority. The importer is never substituted for those actors; a
  missing, foreign-tenant, or self-approved provenance keeps the row in `DRAFT`.

## Rejected alternatives

| Alternative                                           | Why rejected                                                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reuse `purchaseOrders` for customer orders            | "Purchase order" names opposite directions on the two sides of the business; every receiving read would have to filter customers.                             |
| One `parties` table with a supplier/customer flag     | Makes design-key uniqueness mean "per party in either direction" — a rule nobody stated (operating plan §3).                                                  |
| Let the caller declare `EXISTING` or `NEW`            | The decision is the slice's whole value; a caller-supplied answer is a caller-supplied dieline.                                                               |
| Automatic fuzzy/similarity matching                   | A near match may be ranked for a person, but only the explicit authorized confirmation path may pin it, and that path records score, actor, time, and reason. |
| Specification on the master card, revisions as a diff | Something downstream would eventually point at the card and mean "the current design", which is exactly the ambiguity paper cannot survive.                   |
| Mutable released revisions with an edit audit trail   | The printed packet and the record would describe different boxes, and the audit trail would say which — after the run.                                        |
| Self-approval with a "confirmed twice" checkbox       | Not a second pair of eyes; it is the same pair, twice.                                                                                                        |
| Maker-checker only in the permission evaluator        | A denial names a permission, not which field disqualified the actor. The domain refusal is what a person can act on.                                          |
| Packet reads the live revision instead of a snapshot  | Forces `engineering.masterCard.read` onto every production role, putting drafts one URL away from the floor.                                                  |
| `designRequestId` on the order line as well           | The line and the request would each need the other's ID at insert time. The link lives once, on the request.                                                  |
| A query for file access                               | A Convex query cannot write, so a refused access to a private dieline would leave no record (`RG-071`).                                                       |
| A fabricated download URL until `INT-03` lands        | A URL that resolves to nothing is worse than a named refusal, and it would make the gate look satisfied.                                                      |
| Model the factory packet as an `FO`                   | The `FO` aggregate is Phase 5B and carries demand, dates, route, and execution state. Naming it early would fix the wrong shape.                              |

## Verification

Present and enforced today:

- Pure decision kernel — `convex/model/orderToShip/**` — under unit and property
  tests: illegal transitions, the design-source decision, revision numbering,
  supersession, maker-checker refusals, and packet issue preconditions.
- Convex functions under `convex/sales/**`, `convex/engineering/**`, and
  `convex/production/**` — integration tests for idempotent retries, cross-tenant
  refusal, pinned-revision stability, and permission denial.
- `pnpm verify:tenant-boundary` reads the eleven new tables' declarations, index
  prefixes, and bounded reads.
- Schema policy contracts in `convex/lib/schemaPolicy.ts` state every uniqueness and
  bounded-lookup key above, and are asserted against `convex/schema.ts`.

Not verified by code: `OPS-0013-01` through `OPS-0013-04`.

## Release gates

- `RG-072` Both an existing-design and a new-design order line reach an acknowledged
  factory packet, with tenant isolation, revision pinning, permissions, idempotency,
  Thai/English UX, and private-file enforcement (operating plan §7 Phase 5A).
- Private files use verified Convex storage metadata, gateway-bound one-use
  tenant/revision upload grants, current-object checks at submission and packet
  issue, and audited one-use five-minute download-gateway grants; raw storage
  URLs are never returned to the browser.
- Register: [release gates](../release-gates.md).

## References

- Plan §2.4, §7.6, Phase 5A.
- [Order-to-ship operating plan](../figma-order-to-ship-operating-plan.md) §2, §3,
  §4, §7.
- [ADR-0002 — Convex tenant boundary and index discipline](./0002-convex-tenant-boundary-and-index-discipline.md)
- [ADR-0006 — Authorization and support access](./0006-authorization-and-support-access.md)
- [ADR-0007 — Inbound slice scope](./0007-inbound-slice-scope.md) (the supplier
  `purchaseOrders` this slice must not reuse)
- [ADR-0008 — Adapter ports and release gates](./0008-adapter-ports-and-release-gates.md)
  (`INT-03` file storage)
- [Domain glossary](../domain-glossary.md) `G-119`…`G-129`
- [Permission catalogue](../permissions.md)
