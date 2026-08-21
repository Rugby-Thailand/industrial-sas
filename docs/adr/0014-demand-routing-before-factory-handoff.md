# ADR-0014: Route customer demand before factory handoff

Status: **Accepted**
Implementation status: **Local vertical slice implemented; deployed proof open**
Date: 2026-08-17

## Context

The customer line, factory packet, production order, and fulfillment line were
individually valid but did not form one reliable transaction path. Issuing a
factory packet changed the customer line from `DESIGN_READY` to `HANDED_OFF`, while
fulfillment demand could only be created from `DESIGN_READY`. A line could therefore
finish production and QC with no demand left to allocate. A second defect made a
partially covered order produce its full ordered quantity instead of only its ATP
shortage. A third prevented a recovery run after scrap or rejected output.

## Decision

One tenant-bound routing command creates the fulfillment header and line before any
factory handoff. It reads the same ATP policy used by reservation, subtracts earlier
unallocated route commitments, and records both the available-stock plan and exact
production shortage. Order-level route is derived as `AVAILABLE_STOCK`, `PRODUCTION`,
or `MIXED`.

A factory packet requires a linked `PRODUCTION` fulfillment line with positive
shortage. Production orders link to that fulfillment line. Their target is the
remaining routed shortage after QC-released output from completed runs. Only one
active run may exist for the packet, but another run may be created for an unmet
remainder.

## Invariants

### Code-owned guarantees

1. Routing, fulfillment header creation/update, line creation, audit, and replay
   evidence commit atomically.
2. A customer line has at most one fulfillment line across warehouses.
3. Factory handoff is refused until production demand exists.
4. Available-stock commitments from earlier unallocated routed lines reduce ATP for
   later route decisions.
5. A routed production target never exceeds its recorded remaining shortage.
6. Concurrent production runs for one packet are refused; completed shortfall can
   create a bounded recovery run.
7. Tenant and warehouse ownership are resolved server-side and foreign IDs remain
   indistinguishable from missing IDs.

### Operational assumptions

1. A planner releases the fulfillment order after all intended order lines are
   routed.
2. Material substitution, over-production tolerance, rework disposition, and
   purchasing shortage policies remain separate approved decisions.
3. Deployment, load, scanner, and pilot evidence remain release gates.

## Consequences

Path A can release and allocate immediately. Paths B and C retain the same
fulfillment demand while design, production, and QC progress, then continue through
the existing reservation/pick/ship flow without re-entering customer quantity.
Mixed orders no longer overpromise the same ATP to multiple unallocated lines, and
scrap no longer leaves an unrecoverable customer remainder.

The schema expands with route evidence on fulfillment lines, an aggregate route on
fulfillment orders, fulfillment links on factory/production documents, and a bounded
warehouse-item routing index. Legacy production rows remain readable during the
expand phase.

## Rejected alternatives

- Creating fulfillment after production: impossible after `HANDED_OFF` and loses
  the original demand commitment.
- Letting the browser choose Stock versus Production: creates divergent ATP answers
  and a tenant-sensitive trust boundary.
- Producing the full packet quantity whenever ATP is short: overproduces mixed
  demand.
- One permanent production order per packet: cannot recover scrap or QC rejection.

## Verification

Pure tests cover route and aggregate decisions. Convex integration tests cover ATP
shortage, replay, mixed-line commitments, factory-route enforcement, shortage-based
production planning, recovery runs, QC availability, and later allocation of the
same handed-off fulfillment line. Isolation tests compare foreign and missing route
references. Accessibility and preview browser tests expose route/recovery evidence.

## Release gates

This decision does not close the external identity, device, contention/load,
degraded-network, legal, or pilot gates in `docs/release-gates.md`.

## References

- Full-flow plan §§10, 12, and 13
- `convex/fulfillment/orders.ts`
- `convex/fulfillment/reservations.ts`
- `convex/production/packets.ts`
- `convex/production/orders.ts`
- `tests/integration/demand-routing.integration.test.ts`
