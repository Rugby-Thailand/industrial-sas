# Stock rotation and expiry manual

Status: **Domain library; no pick or scheduled-expiry workflow.** Deterministic FIFO
and FEFO ranking, explanation data, expiry decisions, and balanced expiry
reclassification intent planning are implemented. Nothing selects live stock or
schedules/posts expiry transactions automatically.

## Who this is for

- Warehouse planners and inventory controllers
- Developers building putaway, picking, allocation, or expiry jobs
- Support staff explaining why a lot was ranked or excluded

## Rotation strategies

- `FIFO`: first in, first out, driven by receipt date/sequence.
- `FEFO`: first expiring, first out, driven by the configured date source:
  expiration, best-before, or manufacture date.

Every candidate needs a unique `candidateKey`. It is the final tie-breaker, ensuring
the same inputs always produce the same order on every device/runtime.

## Policy options

| Policy                | Options                  | Default-safe behavior |
| --------------------- | ------------------------ | --------------------- |
| Missing rotation date | `EXCLUDE`, `ORDER_LAST`  | Exclude               |
| Expired stock         | `EXCLUDE`, `ORDER_FIRST` | Exclude               |

Use `ORDER_FIRST` for a dedicated disposal/quarantine workflow, not for normal
allocation.

## Ranking procedure

1. Supply an explicit `asOf` business date; never use an implicit host clock.
2. Validate the item/class rotation policy.
3. Build candidates with receipt data, lot code, and relevant lot dates.
4. Call `orderForRotation`.
5. Display ranked candidates and their ordered explanation criteria.
6. Display exclusions with their explicit reason; do not silently hide them.
7. The consuming workflow still validates availability and authorization before
   posting any movement.

## Expiry semantics

A lot is expired only when its expiration date is earlier than `asOf`. A lot whose
expiration date equals `asOf` remains usable through that date. Manufacture or
best-before date may drive rotation but never substitutes for the expiration test.

## Expiry reclassification planning

`planExpiryReclassification` receives one bounded page of current candidates. For
each eligible positive physical `AVAILABLE` bucket whose expiration date passed, it
creates a balanced pair of ledger lines moving the quantity to the matching
`EXPIRED` bucket.

It reports skipped candidates as:

- `NOT_EXPIRED`;
- `NO_EXPIRATION_DATE`;
- `STATUS_NOT_ELIGIBLE`;
- `NOT_PHYSICAL`;
- `NON_POSITIVE_BALANCE`.

The planner does not write. A future scheduled job must submit each intent through
the ordinary authorized/idempotent ledger mutation. Never update status or balance
rows directly.

## Known limitations

- No live pick/allocation module consumes rotation rankings.
- No Convex cron/Workpool job pages through inventory and posts expiry intents.
- No tenant UI configures rotation policy.
- No operational threshold/approval policy is wired for bulk expiry actions.

## Troubleshooting

- Candidate unexpectedly excluded: inspect expiration status first, then missing
  rotation data and receipt sequence.
- Same candidates rank differently: verify candidate keys are unique and every call
  uses the same explicit policy/as-of date.
- Old manufacture date marked expired: this is an integration bug; expiry must use
  `expirationDate` only.
- Expiry job wants to edit the balance: stop and route its paired lines through the
  ledger posting seam.

## Implementation references

- `convex/model/rotation/stockRotation.ts`
- `convex/model/inventory/expiryReclassification.ts`
- `convex/model/inventory/jobPage.ts`
- `convex/model/inventory/ledgerTransaction.ts`
- [Warehouse and stock identity ADR](../adr/0005-warehouse-location-and-stock-identity.md)
