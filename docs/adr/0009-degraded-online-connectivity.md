# ADR-0009 — Degraded-online connectivity contract, not offline execution

- ID: `ADR-0009`
- Status: **Accepted**
- Date: 2026-08-03
- Decision baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §1, §3.2 (D-02, D-03,
  D-04), §4 (B-04), §5 Q6, Q7, Q30, §2.3
- Covers plan ADR backlog (§11) items: 12
- Implementation status: **Not implemented.** There is no PWA manifest, no service
  worker, no intent queue, and no connectivity indicator.

## Context

Convex is server-transaction-oriented, not offline-first (§1). Warehouse Wi-Fi is
unreliable in practice, and operators will keep working when it drops. The
dangerous middle ground is a system that accepts stock-affecting work offline and
reconciles it later: two operators putaway into the same bin, a receipt posts
against a lot that was quarantined five minutes earlier, and the ledger inherits
conflicts it cannot resolve.

B-04 accepts degraded-online behaviour: uncommitted intents are visibly pending,
and correctness-sensitive tasks stop when connectivity is lost.

## Decision

1. **Degraded-online, not offline.** The MVP does not support unconstrained offline
   warehouse execution (B-04, §1). This is a contractual limitation and must never
   be promised otherwise (plan §14).
2. **Installable PWA shell.** A responsive installable PWA with separate handheld
   and desktop shells; the app shell and read-only reference data may be cached
   (D-02, §5 Q7). No native app (§2.3).
3. **Client request IDs are assigned at intent time**, before the network call, so
   a retry after a stall is idempotent
   ([ADR-0003](./0003-append-only-inventory-ledger.md)).
4. **Only safe intents queue.** An intent may be queued while disconnected only if
   it is idempotent and its correctness does not depend on stock or location state
   that could change server-side. Anything else is blocked with a clear message
   (§5 Q7).
5. **Pending is visible and unambiguous.** A queued intent is displayed as pending,
   never as done. No screen shows a balance or task as updated before the server
   confirms (§5 Q7).
6. **Correctness-sensitive operations stop offline.** Receipt posting against
   current PO state, QC disposition, putaway confirmation, and any reversal require
   a live server round trip.
7. **Supported clients are bounded.** Chrome/Edge latest two majors on desktop,
   Chrome on Android 11+ handhelds; iPad Safari is supervisory/read-mostly (D-03).
   Actual WebView testing is required (§5 Q11).
8. **Latency is a product requirement.** p95 scan-to-acknowledge under 800 ms at
   the pilot site is the target that makes server-confirmed scanning acceptable
   (§5 Q5), and it is gated on the Phase 0 benchmark
   ([ADR-0008](./0008-adapter-ports-and-release-gates.md)).

## Invariants

### Code-owned guarantees

- `INV-0009-01` A queued intent is idempotent and carries the `requestId` generated
  when the operator acted, not when it was sent.
- `INV-0009-02` A queued intent is rendered as pending and is never presented as a
  completed posting.
- `INV-0009-03` Operations classified as correctness-sensitive are disabled while
  disconnected, with an explanatory message rather than a silent failure.
- `INV-0009-04` No inventory balance, task state, or QC state is optimistically
  mutated in the client cache as if confirmed.
- `INV-0009-05` Replay of a queued intent after reconnection either commits once or
  fails with a structured, actionable error; it never commits twice.
- `INV-0009-06` A stale cached reference document is marked with its freshness, and
  correctness-sensitive flows refuse to use stale data.
- `INV-0009-07` Connectivity state is derived from actual server acknowledgement,
  not only from `navigator.onLine`.

### Operational assumptions

- `OPS-0009-01` The pilot tenant accepts degraded-online behaviour in writing; if
  not, the plan is revised before implementation (B-04, `RG-009`).
- `OPS-0009-02` Warehouse Wi-Fi supports server-confirmed scanning for critical
  operations (plan §3.3, measured by `RG-002`/`RG-010`).
- `OPS-0009-03` Operators are trained that pending means not yet posted.
- `OPS-0009-04` Contracts and sales material never promise offline operation
  (plan §14).
- `OPS-0009-05` The handheld fleet matches D-03; older WebViews require a separate
  assessment (§5 Q11).

## Consequences

- Some warehouse tasks stop during a Wi-Fi outage. That is the accepted trade for a
  ledger with no conflict resolution.
- Latency becomes a first-class product requirement rather than an engineering
  detail, because every scan is a round trip.
- The pending-queue UI is a real feature with real tests, not a spinner.
- A future offline mode would require a replicated client domain model and conflict
  resolution — a stack-level change, not an increment (B-04).
- Choosing between US East and EU West materially affects usability at the pilot
  site, which is why `RG-002` blocks production creation.

## Rejected alternatives

| Alternative                                    | Why rejected                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Full offline-first execution                   | Requires client-side domain replication and conflict resolution; materially changes scope and stack (B-04). |
| Queue everything and reconcile later           | Produces ledger conflicts that cannot be resolved without inventing stock movements.                        |
| Optimistic UI that shows postings as committed | Operators act on numbers that may be rejected; the physical world then diverges from the ledger.            |
| Native mobile app for offline capability       | Adds a platform, store process, and device management with no MVP requirement (D-02, §2.3).                 |
| Relying on `navigator.onLine`                  | Reports link state, not reachability; captive portals and dead uplinks read as online.                      |
| Supporting arbitrary browsers and old WebViews | Untestable matrix; scanner and camera behaviour vary too much (D-03).                                       |

## Verification

Planned, not present.

- Unit tests: intent classification (queueable vs blocked), request-ID lifetime,
  freshness marking.
- Integration tests: replay of queued intents commits exactly once; blocked
  operations fail closed while disconnected.
- E2E: simulated disconnect and reconnect showing pending state, safe replay, and
  blocked correctness-sensitive actions (plan §12).
- Field measurement: p95/p99 scan-to-ack at the pilot site on real Wi-Fi.

## Release gates

- `RG-002` Latency benchmark from the pilot network.
- `RG-009` Pilot tenant written acceptance of degraded-online behaviour.
- `RG-010` A realistic scan round trip meets the accepted latency target.
- `RG-038` Accepted p95/p99 scan-to-ack latency over the pilot window.
- `RG-039` ≥95% receipt-line completion on handheld without desktop fallback.
- Register: [release gates](../release-gates.md).

## References

- Plan §1, §2.3, §3.2 (D-02, D-03, D-04), §3.3, §4 (B-04), §5 Q5, Q6, Q7, Q10,
  Q11, Q30, §10 Phase 3, §12, §13, §14.
- [ADR-0003 — Append-only balanced inventory ledger](./0003-append-only-inventory-ledger.md)
- [ADR-0008 — Adapter ports and release gates](./0008-adapter-ports-and-release-gates.md)
- [Device capture adapters](../integration-contracts/device-capture-adapters.md)
