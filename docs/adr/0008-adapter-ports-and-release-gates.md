# ADR-0008 — Adapter ports for every external capability, with cloud and hardware release gates

- ID: `ADR-0008`
- Status: **Accepted**
- Date: 2026-08-03
- Decision baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §3.2 (D-16, D-20,
  D-25), §4 (B-03, B-05), §5 Q8, Q9, Q32, Q39, Q47, Q49, §6, §10 Phase 0
- Covers plan ADR backlog (§11) items: 2, 14, 15, 16, 26
- Implementation status: **Partial.** The private engineering master-card slice has
  an UploadThing adapter boundary, verified completion receipt, Convex authorization,
  and short-lived signed downloads. The broader file port, retention/orphan jobs,
  hardware adapters, and production vendor configuration remain open. No cloud
  resource is created by this repository.

## Context

The product depends on capabilities it must not own: identity, hosting, file
storage, printing, scanning, location and signature capture, error tracking, and
job execution. Each dependency carries a different failure mode, and three of them
carry unresolved external evidence:

- Convex Cloud offers US East and EU West but no Asian region, and a deployment's
  region cannot be changed in place, so Bangkok latency and PDPA cross-border
  implications must be measured and cleared **before** production is created
  (B-03, §5 Q3).
- Rugged scanner and ZPL printer behaviour on the actual devices is unverified
  (B-05, §5 Q8, Q9).
- UploadThing's data region and paid private-ACL capability must be confirmed
  before tenant evidence is stored (D-20, §5 Q32).

Vendor lock-in is the deepest architectural risk in the plan (§5 Q49).

## Decision

1. **Every external capability sits behind a named port.** The domain and feature
   code depend on the port, never on the vendor SDK. The ports are:

   | Port ID  | Port                   | Capability                                      | Contract                                                                       |
   | -------- | ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
   | `INT-01` | Clerk integration      | Identity, org membership, webhooks              | [clerk-identity](../integration-contracts/clerk-identity.md)                   |
   | `INT-02` | Convex hosting         | Data plane, region, self-host escape hatch      | [convex-hosting](../integration-contracts/convex-hosting.md)                   |
   | `INT-03` | `FileStoragePort`      | Private tenant files, signed URLs (UploadThing) | [file-storage-port](../integration-contracts/file-storage-port.md)             |
   | `INT-04` | `PrinterTransportPort` | ZPL/PDF delivery to a printer                   | [printer-transport-port](../integration-contracts/printer-transport-port.md)   |
   | `INT-05` | `ObservabilityPort`    | Structured logs, errors, SLIs, alerts           | [observability-port](../integration-contracts/observability-port.md)           |
   | `INT-06` | `JobQueuePort`         | Durable/bounded async work                      | [job-queue-port](../integration-contracts/job-queue-port.md)                   |
   | `INT-07` | `RollupPort`           | Aggregated counters and dashboard rollups       | [rollup-port](../integration-contracts/rollup-port.md)                         |
   | `INT-08` | Device capture ports   | Scanner, camera, GPS, signature, photo          | [device-capture-adapters](../integration-contracts/device-capture-adapters.md) |

2. **Ports are defined by us, not by the vendor.** A port exposes the narrowest
   operation set the domain needs, with explicit timeout, retry, idempotency, and
   failure semantics documented in its contract
   ([index](../integration-contracts/README.md)).
3. **Adapters are replaceable and test-doubled.** Every port has an in-memory or
   fake adapter used by unit, property, and integration tests, so no test requires
   a vendor account or a network call.
4. **No vendor call inside a Convex transaction.** External I/O happens in actions
   or jobs; mutations stay pure and transactional
   ([ADR-0002](./0002-convex-tenant-boundary-and-index-discipline.md),
   [ADR-0011](./0011-async-jobs-reporting-and-observability.md)).
5. **Tenant files are private by default.** UploadThing private ACLs with
   short-lived signed URLs issued after a fresh permission check; authorization
   metadata lives in Convex (D-20, §6.1). Internal-only artifacts may use Convex
   file storage.
6. **Hardware and cloud evidence are release gates, not assumptions.** Region
   selection, latency, scanner behaviour, printer output, and file residency are
   registered gates with owners and required evidence
   ([release gates](../release-gates.md)).
7. **Production sizing is evidence-based.** A paid Convex tier is sized after load
   testing rather than assuming a free tier, and a per-tenant vendor-cost model is
   maintained (D-25, §5 Q41, Q49).
8. **Self-hosting stays a live option.** The pure domain layer, logical exports,
   and Convex self-hosting remain the documented escape hatch; a costed self-host
   alternative is part of the PDPA contingency (§5 Q49, plan §13).
9. **Buy, do not build, commodity capabilities.** Email/SMS, PDF, XLSX, maps,
   signature, and error tracking are integrated behind ports; the explainable WMS
   domain is built in-house (§5 Q47).

## Invariants

### Code-owned guarantees

- `INV-0008-01` No vendor SDK is imported outside its adapter module.
- `INV-0008-02` `convex/model/**` imports no adapter and no vendor SDK.
- `INV-0008-03` Every port call has an explicit timeout and a typed failure result;
  a vendor error never propagates raw to the client.
- `INV-0008-04` Every port operation that can be retried is idempotent, keyed by a
  caller-supplied idempotency key.
- `INV-0008-05` Every port has a fake adapter, and the automated test suite passes
  with no vendor credentials present.
- `INV-0008-06` Tenant file downloads use short-lived signed URLs issued after a
  fresh server-side permission check; no tenant file is world-readable.
- `INV-0008-07` No external network call occurs inside a Convex mutation.
- `INV-0008-08` Adapter configuration comes from environment variables that are
  absent from the repository; only `.env.example` names are tracked.

### Operational assumptions

- `OPS-0008-01` Convex Cloud region choice is final once created; the benchmark
  must precede production creation (B-03, `RG-002`).
- `OPS-0008-02` Rugged scanners emit HID keyboard input with a reliable terminator
  (B-05, plan §3.3, `RG-003`).
- `OPS-0008-03` The customer permits installing a local print bridge, or provides
  another supported route (B-05, `RG-004`).
- `OPS-0008-04` UploadThing offers the required region and private ACL on the
  purchased plan (`RG-035`, §5 Q32).
- `OPS-0008-05` Observability and analytics vendors can be selected later without
  changing the port (§5 Q39).
- `OPS-0008-06` Vendor pricing stays within the unit-economics worksheet at pilot
  and ten-tenant scale (`RG-007`).

## Consequences

- Indirection costs a layer everywhere, and the payoff is testability without
  accounts plus a survivable vendor change.
- A port that is too vendor-shaped defeats the purpose; each contract must state
  the capability, not the API.
- Three external gates (region/latency, scanner, printer) can each invalidate parts
  of the plan, so they are scheduled first (plan §10 Phase 0).
- Signed-URL downloads mean links expire; the UI must re-request rather than cache
  URLs.
- Cost visibility becomes an ongoing obligation rather than a launch task.

## Rejected alternatives

| Alternative                                         | Why rejected                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Direct vendor SDK calls throughout the codebase     | Lock-in becomes structural; tests require accounts; a vendor change becomes a rewrite (§5 Q49). |
| Creating production Convex now and measuring later  | Region cannot be changed in place; a wrong region means a migration and a PDPA problem (B-03).  |
| Assuming a free tier suffices                       | Contradicts D-25 and hides the cost cliff until the pilot is live.                              |
| Public file URLs with unguessable keys              | Not authorization; links leak through chat, tickets, and browser history (D-20).                |
| Printing straight from the browser to an IP printer | Network-topology dependent, unauditable, and vendor-specific (ADR-0007).                        |
| Camera-only scanning to avoid hardware gates        | Slower and less reliable under warehouse lighting; HID remains primary (D-04).                  |
| Building email/SMS/PDF/maps capabilities in-house   | No differentiation and large maintenance cost (§5 Q47).                                         |
| Deciding observability vendors before Phase 1       | Unnecessary; the port defers the choice at no cost (§5 Q39).                                    |

## Verification

The private master-card path has unit and integration coverage; full-port and physical
evidence remains planned.

- Unit tests: client photo optimization, final-byte hashing, and the accessible ReUI
  file picker. Tests for every future port operation remain planned.
- Integration tests: one-use grants, server completion HMAC/tamper checks, and private
  gateway behavior. Live-vendor tests remain outside the automated suite.
- Static checks: vendor SDK imports confined to adapter directories; no adapter
  import inside `convex/model/**`.
- Physical/manual evidence: latency benchmark, scanner spike, printer spike, file
  residency confirmation — all recorded in the release-gate register.

## Release gates

- `RG-002` Bangkok-to-Convex US East vs EU West latency benchmark from the pilot
  network.
- `RG-003` Scanner spike on the actual device and browser/WebView.
- `RG-004` Physical ZPL label print and rescan.
- `RG-006` PDPA/legal gap assessment and cross-border-transfer decision.
- `RG-007` Vendor/unit-economics worksheet for pilot and ten-tenant scenarios.
- `RG-010` A realistic scan round trip meets the accepted latency target.
- `RG-035` UploadThing region and private-ACL capability confirmed.
- `RG-036` Production Convex tier sized from load-test evidence.
- Register: [release gates](../release-gates.md).

## References

- Plan §3.2 (D-04, D-16, D-20, D-25), §3.3, §4 (B-03, B-05), §5 Q3, Q8, Q9, Q32,
  Q39, Q41, Q47, Q49, §6, §10 Phase 0, §13, §14, §15.
- [Integration contract index](../integration-contracts/README.md)
- [ADR-0002 — Convex tenant boundary](./0002-convex-tenant-boundary-and-index-discipline.md)
- [ADR-0011 — Bounded async jobs, reporting, and observability](./0011-async-jobs-reporting-and-observability.md)
- [ADR-0012 — Delivery, release, DR, and quality gates](./0012-delivery-release-and-quality-gates.md)
