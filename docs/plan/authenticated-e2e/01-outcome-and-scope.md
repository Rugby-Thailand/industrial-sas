# Topic 1 — Outcome and scope

## Question this test answers

Can a correctly provisioned user perform one inbound warehouse journey through a
real deployed application and observe the resulting stock, without bypassing
identity, tenancy, authorization, or the public Convex API?

## In scope

- Clerk sign-in using a synthetic non-production user.
- Clerk organization membership mirrored into the application's tenant records.
- Active organization and warehouse context resolved by the server.
- Permission checks on every public query and mutation used by the journey.
- Desktop Thai routes for purchasing, receiving, putaway, balances, and history.
- Supplier purchase order creation with one ordinary line.
- Receipt posting for an exact, in-tolerance quantity.
- Handling-unit construction when the selected flow requires it.
- Putaway claim and confirmation.
- Browser-visible balance and ledger-history confirmation.
- Audit and idempotency assertions where they are visible through supported
  application reads or bounded test diagnostics.

## Out of scope for the first slice

- Over-, under-, blind, unexpected, and cancelled-line receipt paths.
- QC hold and maker-checker approval. These require a second actor and become the
  second authenticated slice after the ordinary path is stable.
- Printer transport, physical labels, scanners, cameras, offline queues, and PWA.
- Browser or device matrix beyond desktop Chromium.
- Load, latency, disaster recovery, and pilot-site evidence.
- Testing every permission refusal in the browser; integration and isolation
  suites already own those combinations.

## Why the first slice is ordinary inbound

It crosses the highest-value existing seams with the fewest external variables:
identity, tenant context, purchasing, receiving, handling units, putaway, the
append-only ledger, balance projection, and read UI. Adding QC maker-checker or
hardware before this path is stable would make failures harder to localize.

## Definition of done

1. The scenario passes locally against the approved non-production environment.
2. It passes from a clean CI runner without a pre-existing browser session.
3. A missing/invalid identity, wrong organization, or absent permission makes the
   scenario fail before a stock write.
4. The final UI shows the exact received quantity at the selected location.
5. History shows the receipt and putaway facts for the current run namespace.
6. A failed run uploads a trace, screenshots, and bounded server diagnostics.
7. The existing credential-free E2E suite remains unchanged and green.
