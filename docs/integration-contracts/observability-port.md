# INT-05 — `ObservabilityPort` (logs, errors, SLIs, alerts, analytics)

Status: **specification.** No logging, error reporting, analytics, or alerting exists.
No vendor has been selected; that choice is deliberately deferred behind this port
(§5 Q39).

Owner ADR:
[ADR-0011](../adr/0011-async-jobs-reporting-and-observability.md).

## 1. Capability

Four related capabilities behind one port, because they share the same redaction rules
and the same request context:

1. **Structured logs** — one event per significant operation, with request ID and
   `orgId`.
2. **Error reporting** — exceptions with stack traces and non-sensitive context.
3. **Domain SLIs** — scan-to-ack latency, receipt completion, drift, dead letters, QC
   backlog age.
4. **Product analytics** — privacy-controlled usage counters, off by default per
   tenant policy.

## 2. Direction and trust boundary

| Flow                   | Direction        | Trust                                                              |
| ---------------------- | ---------------- | ------------------------------------------------------------------ |
| Server logs and errors | Convex → vendor  | Emitted after redaction; the vendor is a subprocessor              |
| Client errors          | Browser → vendor | Untrusted source; never used for authorization or domain decisions |
| SLI samples            | Convex → vendor  | Numeric measurements plus low-cardinality dimensions               |
| Alerts                 | Vendor → on-call | Routed to a named recipient (`RG-045`)                             |

## 3. Port operations

```ts
type ObservabilityPort = {
  log(event: LogEvent): void;
  reportError(error: ReportedError): void;
  recordSli(sample: SliSample): void;
  trackUsage(event: UsageEvent): void;
};
```

All four are fire-and-forget from the caller's perspective. Telemetry must never fail a
warehouse operation.

## 4. Timeouts and retries

| Operation     | Behaviour                                                                    |
| ------------- | ---------------------------------------------------------------------------- |
| `log`         | Buffered, best-effort, dropped under pressure rather than blocking           |
| `reportError` | Best-effort with a short in-process retry; never awaited on the request path |
| `recordSli`   | Buffered and aggregated; sampling is acceptable, silent gaps are not         |
| `trackUsage`  | Buffered; disabled entirely when the tenant policy disallows analytics       |

Vendor timeout budget is 2 s for any background flush. Exceeding it drops the batch and
increments a local counter, which is itself an SLI.

## 5. Idempotency

Telemetry is append-only and tolerant of duplicates: an event may be delivered more than
once. Consumers must not treat counts as exact for billing or compliance purposes;
audit events, not logs, are the authoritative record
([ADR-0003](../adr/0003-append-only-inventory-ledger.md)).

## 6. Data and privacy

This is the boundary most likely to leak personal or tenant data by accident, so the
rules are strict (`INV-0011-10`):

| Allowed                                       | Forbidden                                                       |
| --------------------------------------------- | --------------------------------------------------------------- |
| Request ID, `orgId`, warehouse ID, actor ID   | Names, email addresses, phone numbers                           |
| Permission code, operation name, failure code | Item descriptions, supplier names, lot codes for a named tenant |
| Numeric measurements and durations            | Quantities and balances tied to an identifiable tenant record   |
| Document IDs                                  | Raw scan strings, photos, signature images, file contents       |
| Job name, attempt count, dead-letter cause    | Full request payloads                                           |

Redaction happens in the port, not at each call site, so a new caller cannot opt out.
The telemetry vendor becomes a subprocessor and must appear in the register
(`RG-048`); analytics needs a documented lawful basis or stays off (§5 Q43).

## 7. Failure semantics

| Situation                         | Behaviour                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------- |
| Vendor unavailable                | Telemetry is dropped; the application continues unaffected                    |
| Vendor rate-limits us             | Sample down, preserve error reports over logs, preserve SLIs over analytics   |
| Redaction rule missing            | Treated as a defect; the default is to omit the field, not to send it         |
| Alert routing unconfigured        | `RG-045` unmet; an unrouted alert is not a control (`OPS-0011-02`)            |
| Telemetry loss during an incident | Audit events and job-run records remain in Convex and are the fallback record |

## 8. Required alerts

| Alert                             | Source                             | Why it matters                                    |
| --------------------------------- | ---------------------------------- | ------------------------------------------------- |
| Ledger/projection drift detected  | Reconciliation job (`INV-0003-10`) | The one defect class that invalidates the product |
| Dead-letter count above threshold | `JobQueuePort`                     | Work is being lost silently otherwise             |
| Scan-to-ack p95 above target      | SLI samples                        | Operators abandon the handheld above this         |
| Error-rate spike                  | Error reporting                    | Regression detection                              |
| Webhook signature failures        | HTTP endpoints                     | Possible attack or misconfiguration               |
| Membership reconciliation drift   | Scheduled sync                     | Stale access after revocation (plan §13)          |
| Backup or export job failure      | Scheduled jobs                     | RPO commitment at risk (`RG-065`)                 |

## 9. Configuration

Vendor DSNs and keys are environment variables per environment; names only in
[`.env.example`](../../.env.example). Separate telemetry projects per environment
(`RG-059`). No vendor is configured at this commit.

## 10. Verification

- Unit tests against a recording fake: redaction of every forbidden field class,
  request-ID propagation, analytics suppression when disabled.
- Integration tests: SLI emission on representative operations; alert-condition
  computation.
- Static checks: no vendor SDK import outside the adapter (`INV-0008-01`).
- Manual: a test alert reaches the on-call recipient (`RG-045`).

## 11. Release gates

`RG-045` vendor selection and alert routing, `RG-038` latency SLI over the pilot,
`RG-041` drift monitoring, `RG-048` subprocessor register. See the
[register](../release-gates.md).

## 12. Open questions

- Vendor choice for logs, errors, and analytics, and whether one vendor covers all
  three (§5 Q39).
- Whether product analytics is enabled at all during the pilot, and on what basis.
- SLI retention window versus the cost of long-retention metrics.
