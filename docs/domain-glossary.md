# Domain glossary and ubiquitous language

Status: **specification.** These terms define the language used in code,
identifiers, tests, and UI copy. Almost none of them are implemented yet; see the
[coverage matrix](./specification-coverage.md) for what exists.

Two groups are now partly real. The pure domain modules under `convex/model/**`
implement the vocabulary of quantity, UOM conversion, identifiers, business dates,
and stock rotation: `G-027`, `G-029`, `G-030`, `G-031` (its code, not the entity),
`G-032`, `G-033`, `G-038`, `G-039`, `G-041`, `G-042`, `G-043`, `G-044`, `G-047`,
`G-048`, `G-049`, `G-063`, `G-064`, `G-105`, `G-106`, and `G-111`. Those are value
objects and algebra only — no table stores any of them, and nothing enforces the
uniqueness or never-reuse rules that belong to a mutation. Every other term is
still specification.

The order-to-ship vocabulary — `G-119` to `G-129` — is implemented in full by the
Phase 5A slice: `convex/model/orderToShip/**`, the eight tables at the end of
`convex/schema.ts`, and the functions under `convex/sales/**`,
`convex/engineering/**`, and `convex/production/**` (`ADR-0013`).

The Phase 4 reporting vocabulary — `G-112` to `G-118` — is implemented in full:
`convex/model/reporting/**`, `convex/lib/rollupStore.ts`, `convex/reporting/**`,
and `scripts/lib/exportEnvelope.mjs`. Those terms describe running code rather
than intent.

Rules for this glossary:

- Code identifiers are English (D-06). Thai appears in UI copy and bilingual master
  data, never in identifiers.
- Each term has a stable ID (`G-001`). IDs are cited from ADRs and tests and are
  never renumbered; a retired term keeps its ID and is marked retired.
- One concept, one word. If two words appear for one concept, one of them is listed
  as a rejected synonym.
- A term that has no place in the MVP is marked **Deferred** with the decision that
  defers it.

## Tenancy and access

| ID      | Term            | Definition                                                                                                                     | Notes / rejected synonyms                                          |
| ------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `G-001` | Organization    | A customer tenant. One Clerk organization maps to exactly one Convex `organizations` document (C-01, `ADR-0001`).              | Rejected: "company", "account", "client".                          |
| `G-002` | `orgId`         | The internal identifier of an organization. First field of every tenant table and tenant index (D-18, `ADR-0002`).             | Never accepted from the client.                                    |
| `G-003` | User            | A person, owned by Clerk. Convex mirrors a profile reference and no credentials (C-03).                                        | Rejected: "operator account".                                      |
| `G-004` | Membership      | A user's participation in an organization, optionally scoped to a warehouse, with a role, effective period, and status (§7.1). | Rejected: "assignment".                                            |
| `G-005` | Role            | A tenant-editable named composition of permissions (D-17, `ADR-0006`).                                                         | Not a Clerk organization role.                                     |
| `G-006` | Permission      | A code-owned capability code checked server-side before an operation ([catalogue](./permissions.md)).                          | Rejected: "right", "privilege".                                    |
| `G-007` | Warehouse scope | The set of warehouses a membership may act in. Part of every authorization decision.                                           | Rejected: "site access".                                           |
| `G-008` | Maker-checker   | A policy where the actor who submits an operation cannot be the actor who approves it (`ADR-0006`).                            | Rejected: "four eyes" in identifiers; use in prose only.           |
| `G-009` | Step-up         | A fresh Clerk reverification required for a privileged operation (§5 Q16).                                                     | Rejected: "re-login".                                              |
| `G-010` | Support grant   | A time-boxed, reason-and-ticket-bound cross-tenant access record. **Disabled by default** in the MVP (`ADR-0006`).             | Rejected: "impersonation", "god mode".                             |
| `G-011` | Entitlement     | A server-enforced plan capability limit (D-30).                                                                                | Distinct from permission: what the tenant bought, not who may act. |
| `G-012` | Actor           | The authenticated user credited with a transaction or audit event.                                                             | Rejected: "operator" when identity matters.                        |
| `G-013` | Device          | A registered handheld or workstation whose context is recorded on transactions (§7.1).                                         | Not an authorization subject.                                      |

## Master data

| ID      | Term                      | Definition                                                                                                                            | Notes                                                                                   |
| ------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `G-020` | Warehouse                 | A physical site containing a location hierarchy.                                                                                      | Rejected: "plant", "DC".                                                                |
| `G-021` | Location                  | A node in a warehouse's materialized location tree with a semantic location type (§5 Q22, `ADR-0005`).                                | Rejected: "bin" as the general term; a bin is one location type.                        |
| `G-022` | Location type             | The semantic classification of a location: dock, staging, rack bin, floor block, quarantine, overflow, virtual boundary.              | —                                                                                       |
| `G-023` | Virtual boundary location | A location representing the world outside the warehouse so ledger transactions balance (`ADR-0003`).                                  | Rejected: "external account".                                                           |
| `G-024` | Storage class             | A compatibility classification restricting which items may occupy which locations. A hard constraint (D-13).                          | Rejected: "storage group".                                                              |
| `G-025` | Capacity                  | Advisory volumetric/weight limit of a location in the MVP; it warns, it does not block (D-13).                                        | —                                                                                       |
| `G-026` | Item                      | A stock-keeping definition with one base UOM and a tracking mode.                                                                     | Rejected: "product", "material", "SKU" as the identifier term.                          |
| `G-027` | SKU                       | The tenant's human item identifier, normalized and distinct from the Convex document ID (§5 Q4).                                      | Use "item" for the entity, "SKU" for the code.                                          |
| `G-028` | Tracking mode             | `NONE`, `LOT`, or `LOT_SERIAL`. Only `NONE` and `LOT` are implemented (D-09).                                                         | —                                                                                       |
| `G-029` | Base UOM                  | The single unit in which an item's inventory is stored, as integer minor units (D-08, `ADR-0004`).                                    | Rejected: "stock unit".                                                                 |
| `G-030` | Alternate UOM             | A packaging unit with an exact rational conversion to the base UOM (`ADR-0004`).                                                      | Rejected: "pack UOM" in identifiers.                                                    |
| `G-031` | Lot                       | A production batch of an item, unique per item, with manufacture, expiry, and best-before business dates (§5 Q23).                    | Rejected: "batch" in identifiers; acceptable in Thai/English copy.                      |
| `G-032` | Rotation date             | The configurable date used for FEFO **ordering** (§5 Q23). It never decides expiry: stock is expired when its expiry date has passed. | Rejected: rotation date as the expiry date.                                             |
| `G-033` | FEFO                      | First-expired-first-out ordering with deterministic tie-breakers (§5 Q23).                                                            | —                                                                                       |
| `G-034` | Supplier                  | The counterparty a purchase order is placed with.                                                                                     | Rejected: "vendor" (reserved for software vendors).                                     |
| `G-035` | Owner                     | The legal owner of stock, an optional bucket dimension. Consigned stock stays disabled unless a tenant needs it (D-11).               | Distinct from custodian/warehouse.                                                      |
| `G-036` | Reason code               | A tenant-configurable coded justification attached to exceptions, overrides, and reversals.                                           | Rejected: free-text reason only.                                                        |
| `G-037` | Serial                    | A uniquely identified single unit. **Deferred**: schema-ready, flows disabled (D-09).                                                 | —                                                                                       |
| `G-038` | Base-UOM minor unit       | One thousandth of an item's base UOM: the integer in which every quantity is stored (B-12, `ADR-0004`).                               | Rejected: "decimal quantity". Implemented in `convex/model/uom/quantity.ts`.            |
| `G-039` | Conversion ratio          | An alternate UOM's exact factor to the base UOM, as a reduced fraction of positive integers (`INV-0004-03`).                          | Rejected: "conversion factor" as a decimal. Implemented in `convex/model/uom/ratio.ts`. |

## Handling units and identifiers

| ID      | Term                        | Definition                                                                                                                    | Notes                                                                            |
| ------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `G-040` | Handling unit (HU)          | A physical logistic unit, typically a pallet, that holds stock and moves as one thing (D-10, `ADR-0005`).                     | Rejected: "pallet" as the model name; a pallet is one HU type.                   |
| `G-041` | LPN                         | Licence plate number: the unique, never-reused identifier of a handling unit (§5 Q24).                                        | Rejected: "pallet ID".                                                           |
| `G-042` | SSCC                        | GS1 serial shipping container code, used as the LPN when the tenant has a GS1 prefix (D-15).                                  | —                                                                                |
| `G-043` | GTIN                        | GS1 trade item number used to resolve an item from a supplier barcode (§5 Q29).                                               | —                                                                                |
| `G-044` | Application Identifier (AI) | A GS1-128 data element prefix parsed from a scan (§5 Q29).                                                                    | —                                                                                |
| `G-045` | Nesting                     | One handling unit contained in another. Maximum depth is one level (D-10).                                                    | —                                                                                |
| `G-046` | Relabel                     | Issuing a new LPN for an existing handling unit as an audited transaction; the old LPN is retained in history (§5 Q24).       | Rejected: "reprint" (a reprint reuses the same LPN).                             |
| `G-047` | Raw scan                    | The exact string emitted by the scanner, stored alongside its parsed interpretation (§3.3).                                   | —                                                                                |
| `G-048` | GS1 element string          | The concatenation of AI-prefixed data elements a GS1 symbol carries, with FNC1 terminating variable-length fields (§5 Q29).   | Rejected: "barcode payload". Implemented in `convex/model/gs1/elementString.ts`. |
| `G-049` | LPN namespace               | An organization's LPN prefix. One prefix belongs to one organization, so a foreign label is refused before any lookup (D-15). | Rejected: "LPN series". Implemented in `convex/model/identifiers/lpn.ts`.        |

## Inventory and ledger

| ID      | Term                  | Definition                                                                                                                                        | Notes                                                                         |
| ------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `G-050` | Inventory transaction | The immutable header of a stock change: type, request ID, actor, device, occurrence time, source, reason (§7.4).                                  | Rejected: "movement" for the header.                                          |
| `G-051` | Ledger line           | An immutable signed posting against one bucket. Lines of a transaction sum to zero (§7.4, `ADR-0003`).                                            | Rejected: "entry".                                                            |
| `G-052` | Bucket                | The identity a balance is kept against: org, warehouse, item, location, lot?, serial?, HU?, stock status, owner? (§7.4).                          | Rejected: "slot".                                                             |
| `G-053` | Stock status          | The quality/availability dimension of a bucket, for example `AVAILABLE`, `QC_HOLD`, `QUARANTINE`, `REJECTED`, `SCRAP` (D-11).                     | Orthogonal to owner.                                                          |
| `G-054` | Balance projection    | A narrow document holding the current quantity for one bucket, written in the same mutation as the ledger lines (§5 Q21).                         | Rejected: "cache" — it is authoritative for reads.                            |
| `G-055` | Available quantity    | The quantity in a bucket usable for work. Never negative unless an explicit tenant policy allows it (D-12).                                       | No reservations in the MVP (§2.3).                                            |
| `G-056` | Request ID            | A client-generated UUIDv7 unique per organization that makes a posting idempotent (§7.5, `ADR-0003`).                                             | Rejected: "correlation ID" (that is the trace concept).                       |
| `G-057` | Reversal              | A compensating transaction referencing exactly one original; it cannot reverse a reversal (§7.5).                                                 | Rejected: "cancel", "delete", "void".                                         |
| `G-058` | Reconciliation        | A scheduled ledger replay proving projections equal the ledger (§7.5).                                                                            | Rejected: "recalculation".                                                    |
| `G-059` | Drift                 | Any inequality between a projection or rollup and the ledger replay. Always an alert (§7.5).                                                      | —                                                                             |
| `G-060` | Rollup                | A pre-aggregated figure used by dashboards and reports, derivable from the ledger (`ADR-0011`).                                                   | Rejected: "summary table".                                                    |
| `G-061` | Audit event           | An append-only record of an action with actor, entity, request, device, and support context, written in the same mutation as the change (§5 Q37). | Distinct from a log line: audit is tenant-visible truth.                      |
| `G-062` | Reservation           | A claim on stock for future outbound work. **Deferred** (§2.3, §3.4).                                                                             | —                                                                             |
| `G-063` | FIFO                  | First-in-first-out ordering by receipt, with the same deterministic tie-breakers as FEFO (§5 Q23).                                                | Distinct from FEFO (`G-033`): a different criterion order over the same lots. |
| `G-064` | Rotation candidate    | One rankable unit of stock offered to a rotation decision, carrying its dates, receipt order, and a unique key (`INV-0005-10`).                   | Rejected: "pick candidate" (no picking in the MVP).                           |

## Inbound flow

| ID      | Term                   | Definition                                                                                                                      | Notes                                                         |
| ------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `G-070` | Purchase order (PO)    | An expectation of goods from a supplier, authored in-app or imported from CSV/XLSX (B-07).                                      | Rejected: "order" alone (ambiguous with sales orders).        |
| `G-071` | PO line                | One expected item, quantity, and UOM on a purchase order.                                                                       | —                                                             |
| `G-072` | Receipt                | The recorded arrival of goods against a PO or as an exception, producing ledger postings (§7.3).                                | Rejected: "GRN" in identifiers; usable in tenant-facing copy. |
| `G-073` | Partial receipt        | A receipt covering less than the ordered quantity. Normal, not an exception (§5 Q26).                                           | —                                                             |
| `G-074` | Over-receipt           | A receipt exceeding the ordered quantity; permitted within configured tolerance, otherwise requires approval (§5 Q26).          | —                                                             |
| `G-075` | Under-close            | Closing a PO line short of its ordered quantity, requiring a reason code (§5 Q26).                                              | Rejected: "short close" in identifiers.                       |
| `G-076` | Unexpected receipt     | Receiving an item not on the referenced PO. An explicit exception flow (§5 Q26).                                                | —                                                             |
| `G-077` | Blind receipt          | Receiving without a referenced PO. An explicit exception flow (§5 Q26).                                                         | —                                                             |
| `G-078` | Plausible duplicate    | A submission that looks like a repeat of recent work; warned about, and blocked from double-posting by the request ID (§5 Q30). | —                                                             |
| `G-079` | QC profile             | Per item and supplier configuration deciding whether and how received stock is inspected (§5 Q27).                              | —                                                             |
| `G-080` | Sampling               | All, fixed-count, or percentage selection for inspection. Statistical AQL is **deferred** (§5 Q27, §2.3).                       | —                                                             |
| `G-081` | `QC_HOLD`              | The stock status of received stock awaiting inspection (§2.1).                                                                  | Rejected: "pending QC" as a status value.                     |
| `G-082` | Disposition            | The explicit QC outcome: release, quarantine, reject, scrap, or rework. Always a balanced transaction (§2.1).                   | Rejected: "decision".                                         |
| `G-083` | Label template version | The versioned definition a printed label was generated from; retained with the payload hash as evidence (D-16).                 | —                                                             |
| `G-084` | ZPL                    | The primary label payload language; PDF is the preview/fallback (D-16).                                                         | —                                                             |
| `G-085` | Print job              | A record of a label rendering and print attempt, including reprints (D-16).                                                     | —                                                             |
| `G-086` | Putaway task           | Work to move received stock from a dock or staging location into storage (§7.3).                                                | —                                                             |
| `G-087` | Putaway recommendation | The stored, explainable ranked location suggestion with its filters and score components (D-14).                                | Rejected: "suggestion" in identifiers.                        |
| `G-088` | Override               | An operator's audited choice of a different location than recommended (D-14).                                                   | —                                                             |
| `G-089` | Overflow               | The fallback location class used when no preferred location qualifies (D-14).                                                   | —                                                             |
| `G-090` | Task claim             | A compare-and-set assignment of a task to exactly one actor (§5 Q30).                                                           | Rejected: "lock".                                             |

## Order to ship

The Phase 5A vocabulary (`ADR-0013`). Numbering continues from the platform block
rather than filling the gap after `G-090`, so later order-to-ship phases can extend
this section without renumbering anything.

| ID      | Term                 | Definition                                                                                                                                                              | Notes / rejected synonyms                                                                                                            |
| ------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `G-119` | Customer             | A party the tenant sells boxes to. A separate register from supplier (`G-051`), even when the same legal entity is both.                                                | Rejected: "party", "account". One table with a direction flag would put sales demand inside every receiving read.                    |
| `G-120` | Customer order       | What a customer asked the tenant to make: the customer PO and the internal sales order, as one document (`ADR-0013` §1).                                                | **Never** a `purchaseOrders` row (`G-060`), which is supplier-facing procurement. Rejected: "sales order" in identifiers.            |
| `G-121` | Customer order line  | One box, in one quantity, on one customer order. The unit that carries a design decision and reaches a factory packet.                                                  | Rejected: "order item".                                                                                                              |
| `G-122` | Design key           | A canonical structural fingerprint of a box specification (`G-125`), used to rank similar designs for a person. It is never the automatic reuse identity.               | Rejected: "exact-match key". Customer + customer product code is the authoritative exact identity.                                   |
| `G-123` | Design request       | Work engineering owes on exactly one order line, raised by the system when no released revision matches (`INV-0013-01`).                                                | Rejected: "design ticket", "ECR". Never created by hand: a request behind no line is a drawing nobody ordered.                       |
| `G-124` | Design source        | Where a line's design came from: `EXISTING` (customer + customer product code resolved to a released revision) or `NEW` (a design request was raised). Decided by the system. | Rejected: "match type". A structural near-match stays `NEW` until a person explicitly confirms it.                                 |
| `G-125` | Box specification    | The structured description of one box: dimensions, board grade, flute, print colours, and finishing. Values only; no identity of its own.                               | Rejected: "spec sheet" (a document), "BOM" (a standing non-goal, plan §2.3).                                                         |
| `G-126` | Master card          | The stable identity of one design across every revision of it. Holds no specification itself.                                                                           | Rejected: "SKU" (`G-040` is the inventory item, a different thing), "design", "product".                                             |
| `G-127` | Master-card revision | One version of a design, and the only thing a factory packet may pin. `RELEASED` is immutable in every field but `supersededByRevisionId` (`INV-0013-02`).              | Rejected: "version" in identifiers. "Rev 3" names one document forever, including after a rejection and including on paper.          |
| `G-128` | Master-card file     | A dieline, artwork file, or photo attached to one revision. Private, and every access is a fresh permission check (`ADR-0008`).                                         | Rejected: "attachment" when the revision link matters.                                                                               |
| `G-129` | Factory packet       | The one document that crosses from the office to the shop floor, pinned to exactly one released revision and carrying a snapshot of it (`INV-0013-04`).                 | Rejected: "work order" and "job" — both are standing non-goals (plan §2.3). Not yet a factory order (`FO`), which is Phase 5B.       |

## Platform and delivery

| ID      | Term                  | Definition                                                                                                                           | Notes                                                                    |
| ------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `G-100` | Port                  | An internally-defined interface for an external capability (`ADR-0008`).                                                             | Rejected: "service", "client".                                           |
| `G-101` | Adapter               | A vendor-specific implementation of a port. The only place a vendor SDK is imported.                                                 | —                                                                        |
| `G-102` | Tenant-bound accessor | The wrapper through which all tenant document reads and writes pass (D-18, `ADR-0002`).                                              | Rejected: "repository".                                                  |
| `G-103` | Outbox                | A row written in the same mutation as a domain change, delivered at least once to an external consumer (D-21).                       | —                                                                        |
| `G-104` | Dead letter           | A durable record of a job or delivery that exhausted its retries (`ADR-0011`).                                                       | —                                                                        |
| `G-105` | Business date         | `YYYY-MM-DD` in the organization timezone, default `Asia/Bangkok` (D-05).                                                            | Never derived from the UTC date.                                         |
| `G-106` | Buddhist Era (BE)     | A display-only calendar representation used on documents where requested; never stored (D-06).                                       | —                                                                        |
| `G-107` | Degraded-online       | The connectivity contract: pending queued safe intents, blocked correctness-sensitive work, no offline execution (B-04).             | Rejected: "offline mode".                                                |
| `G-108` | Pending intent        | A user action queued client-side, displayed as not yet posted (`ADR-0009`).                                                          | Rejected: "draft".                                                       |
| `G-109` | Release gate          | An external or code-owned condition that must be satisfied before a phase or launch ([register](./release-gates.md)).                | —                                                                        |
| `G-110` | Scan-to-ack           | Elapsed time from a scan to a server-confirmed acknowledgement; the primary latency SLI (§5 Q5).                                     | —                                                                        |
| `G-111` | Instant               | A point in time as UTC epoch milliseconds. Converted to a business date (`G-105`) only through an explicit organization zone (D-05). | Rejected: "timestamp" when the distinction from a business date matters. |
| `G-112` | Maintained counter    | A number kept current by the transaction that changes it, and recomputable from the tables it summarises (`ADR-0011` §6).            | Rejected: "aggregate" when the Convex component is not meant.            |
| `G-113` | Rollup drift          | A maintained counter (`G-112`) that disagrees with a fresh derivation of the same fact.                                              | Rejected: "stale count" — drift is a disagreement, not an age.           |
| `G-114` | Suspect counter       | A counter whose decrement once clamped at zero, so it may read low until verified.                                                   | —                                                                        |
| `G-115` | Occupancy band        | One of `EMPTY`, `LIGHT`, `BUSY`, `FULL`: how full a location is, by distinct stock buckets rather than by quantity.                  | Rejected: "utilisation %" — quantities are not comparable across items.  |
| `G-116` | Stock bucket          | One (item, lot, serial, status, handling unit, owner) combination at a location; the unit occupancy counts.                          | Rejected: "SKU at location", which omits lot and status.                 |
| `G-117` | Export job            | An asynchronous, chunked, resumable walk that renders tenant rows into a private artifact (`ADR-0011` §7).                           | Rejected: "download" — the artifact is produced, then fetched.           |
| `G-118` | Export envelope       | The independent, encrypted, checksummed archive an operator can restore without the platform (`ADR-0021`).                           | Rejected: "backup file", which does not imply verifiability.             |

## Deliberately absent vocabulary

These words must not appear as domain concepts in MVP code, because the underlying
capability is a standing non-goal (plan §2.3): pick, pack, ship, wave, POD, return,
cross-dock, work order, BOM, WIP, yield, RFID, NFC, catch-weight, invoice,
subscription, storage billing, and 3D/rack visualization.
