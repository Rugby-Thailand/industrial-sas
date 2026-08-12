# Observability, structured errors, and domain SLIs

**Current availability: Client-side port with local adapters.** The event model,
the redaction, the two adapters, and the call sites are real and tested. There is
**no vendor sink**: no Sentry, no DSN, no subprocessor. The default adapter
discards every event.

## Why there is no Sentry adapter

Plan §10 Phase 1 lists Sentry among the deliverables. Writing that adapter now
would need a DSN, a project, and a data-processing agreement with a subprocessor
that has to appear in the tenant's register (`ADR-0012` §15). None exists. The
two honest options were a placeholder DSN that silently drops everything, or a
real one pointing at an account nobody has agreed to — and both are worse than
the stated gap.

What is here is the seam. `ObservabilityPort` has one method; a vendor adapter is
a file that implements it plus a line in `resolveObservabilityPort`.

## The event

An observability event carries a **code**, a **severity**, an optional
**request ID**, and a small map of **dimensions**. It cannot carry a message, a
stack, a document, or a quantity — there is no field for one.

That is deliberate. Tenants are Thai manufacturers under PDPA and the operator is
a data processor; the cheapest way to leak tenant data is a telemetry call that
took `error.message` and shipped it somewhere. A free-text field would be used
within a week, so there isn't one.

### Redaction

`redactDimensions` allowlists shapes rather than blocklisting patterns:

| Kept                                              | Dropped                                           |
| ------------------------------------------------- | ------------------------------------------------- |
| Booleans                                          | Objects, arrays, `null`, `undefined`              |
| Finite numbers                                    | `NaN`, `Infinity`                                 |
| Strings matching `^[A-Za-z][A-Za-z0-9._-]*$`, ≤64 | Anything with a space, a slash, Thai text, or `@` |

A SKU (`BOLT-M8/2026`), a Thai lot code, an email, and a stack frame all fail the
string rule — the SKU deliberately, because "which SKU errored" is a tenant's
data even when it is convenient telemetry. An over-long value is **dropped, not
truncated**: a truncated identifier is still an identifier.

Request IDs survive because they are server-minted, opaque, and the only thing
that makes a support conversation possible.

## Adapters

| `NEXT_PUBLIC_OBSERVABILITY_SINK` | Behaviour                                   |
| -------------------------------- | ------------------------------------------- |
| unset, or anything unrecognized  | Discard. The default.                       |
| `console`                        | One JSON line per event, via `console.info` |

An unrecognized name resolves to `none` rather than throwing: this runs during
application start-up, and a typo in an environment variable must not be a blank
screen. `pnpm verify:environment` is what turns that typo into a build failure.

`record` returns `void` and swallows its own failures. A telemetry sink that can
fail an operator's scan is a defect; a lost event is an inconvenience.

## The SLIs

Two questions, because they are the two the product has already committed to
answering.

### `ledger.read` / `ledger.read.failed`

Emitted once per **settled** read — never per render, and never for `LOADING`,
which is the absence of an outcome.

| Dimension         | Values                                                                              |
| ----------------- | ----------------------------------------------------------------------------------- |
| `surface`         | `balances`, `history`                                                               |
| `outcome`         | `READY`, `DENIED`, `LEDGER_ERROR`, `ERROR`, `SIGN_IN_REQUIRED`, `WAREHOUSE_MISSING` |
| `preview`         | `true` when the rows are synthetic                                                  |
| `latencyBucketMs` | `100`, `250`, `500`, `800`, `1500`, `3000`, `10000`, or `-1` above the ladder       |

Severity is not uniform: `READY` and `WAREHOUSE_MISSING` are `info`, `DENIED` is
a **warning**, everything else is an error. A denial is the system working, and
paging it as an error trains people to ignore the channel.

**Durations are bucketed, never raw.** A raw duration is a high-cardinality
dimension and a timing side channel — how long a query took can distinguish "no
such document" from "a document you may not see". The ladder is built around the
800 ms scan-to-acknowledge target (`ADR-0009` §8) so an alert boundary is a real
boundary.

**Row counts are absent.** A count survives redaction — it is a number — and is a
tenant's stock profile.

### `client.error`

Emitted by `LedgerErrorBoundary` when a query throws. Carries the server's own
published failure code (or `UNKNOWN`) and the surface. No message, no stack, no
component tree.

### `web.vital`

Emitted by the isolated `WebVitals` client boundary through Next.js's
`useReportWebVitals`. It records `metric`, `value`, `delta`, `rating`, and
`navigationType`; the metric ID and attribution entries are omitted because they
are unnecessary for the series and attribution may contain DOM-specific detail.
`good` is informational; `needs-improvement` and `poor` are warnings rather than
application errors. The default `none` adapter still discards these samples.

### `application.render.failed`

Emitted when the locale or global React error boundary catches a render failure.
The only dimension is `boundary` (`locale` or `global`). The caught error's message,
stack, digest, and component tree are deliberately absent. The locale boundary
offers translated recovery UI; the global boundary owns bilingual literal copy so
it remains usable when the locale provider itself failed.

## What is not measured yet

- **Server-side SLIs.** Convex functions mint a request ID and write audit rows,
  but nothing aggregates them; a server sink needs `INT-05`'s job-queue side and
  a destination.
- **Persisted real-user series.** Browser Web Vitals are collected, but the default
  adapter discards them and no approved vendor sink exists yet.
- **Scan-to-acknowledge.** There is no scan. The read path is the same round
  trip, which is why the latency series starts here.
- **Denied reads.** A Convex query cannot write, so a denied _read_ is refused
  but not audited (`RG-071`). The client SLI records that it happened; the server
  cannot yet record who tried.

## Related

- [INT-05 — Observability port](../integration-contracts/observability-port.md)
- [ADR-0009 — Degraded-online connectivity](../adr/0009-degraded-online-connectivity.md)
- [ADR-0012 — Delivery, release, and quality gates](../adr/0012-delivery-release-and-quality-gates.md)
- [Environment contracts](../environments.md)
