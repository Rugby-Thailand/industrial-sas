# INT-04 — `PrinterTransportPort` (ZPL and PDF delivery)

Status: **specification.** Nothing exists: no port, no bridge integration, no label
template model, no print-job record. `pdf-lib` is installed and unused.

Owner ADRs:
[ADR-0007](../adr/0007-inbound-slice-scope.md),
[ADR-0008](../adr/0008-adapter-ports-and-release-gates.md).

## 1. Capability

Deliver a server-generated label payload to a physical printer and report what
happened. The port carries bytes; it does not decide label content.

- **ZPL is the primary payload**, generated server-side from a versioned label
  template (D-16).
- **PDF is the preview and fallback**, for on-screen confirmation and for printers
  reached through the operating system.
- **The default transport is a local print bridge** of the Zebra Browser Print class,
  installed on a workstation with the customer's permission (B-05).

## 2. Direction and trust boundary

| Flow               | Direction                        | Trust                                                                 |
| ------------------ | -------------------------------- | --------------------------------------------------------------------- |
| Payload generation | Convex (server)                  | Authoritative; the client never composes ZPL (`INV-0007-07`)          |
| Payload delivery   | Browser → local bridge → printer | The bridge is on the operator's network, outside our control          |
| Result reporting   | Browser → Convex                 | Reported outcome is recorded as a claim, not as proof of ink on media |
| Print evidence     | Convex                           | Template version, payload hash, actor, device, timestamp              |

A reported success means the transport accepted the payload. Only a human or a rescan
proves a readable label, which is why `RG-004` and `RG-029` are physical gates.

## 3. Port operations

```ts
type PrinterTransportPort = {
  listTargets(): Promise<PrinterTarget[]>;
  sendZpl(input: SendZplInput): Promise<PrintDispatchResult>;
  sendPdf(input: SendPdfInput): Promise<PrintDispatchResult>;
  probe(target: PrinterTarget): Promise<PrinterHealth>;
};
```

`SendZplInput` carries the print-job ID, the payload, the payload hash, and the target.
The print-job ID is the idempotency key.

## 4. Timeouts and retries

| Operation     | Timeout | Retries     | On exhaustion                                      |
| ------------- | ------- | ----------- | -------------------------------------------------- |
| `listTargets` | 2 s     | 1           | Show "no printer available" and offer PDF download |
| `sendZpl`     | 5 s     | 0 automatic | Mark the job failed and offer an explicit reprint  |
| `sendPdf`     | 5 s     | 0 automatic | Offer download                                     |
| `probe`       | 2 s     | 1           | Mark the target unknown; do not block the operator |

Automatic retry is deliberately absent: a retried print can produce two physical
labels with the same LPN, which is worse than a failed print. The operator decides,
and the reprint is audited.

## 5. Idempotency

- Every dispatch carries a print-job ID; re-dispatching the same ID is recorded as a
  **reprint**, never as a new label.
- A reprint reuses the same LPN and the same template version. Issuing a _new_ LPN is
  a relabel, a different domain operation with its own permission
  (`handlingUnit.relabel`).
- Payload hashes let a duplicate physical label be traced to the exact dispatch that
  produced it.

## 6. Data and privacy

- Label payloads contain business data (item, lot, quantity, dates, LPN) and no
  personal data.
- Print-job records include the actor and device, so they are audit data subject to the
  retention decision (D-27, `RG-049`).
- The local bridge runs on customer hardware; the customer's IT policy governs it. If
  installation is prohibited, `RG-004` must be satisfied through another supported
  route or the printing approach is reopened (B-05).

## 7. Failure semantics

| Situation                                   | Behaviour                                                                          |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Bridge not installed or not running         | `unavailable`; offer PDF fallback and record the attempt                           |
| No printer target found                     | `unavailable`; the receipt and handling unit remain valid without a printed label  |
| Printer offline, out of media, or head open | `rejected` with the reported reason surfaced in Thai and English                   |
| Transport accepted but nothing printed      | Detected by the operator, not the system; the reprint path exists for exactly this |
| Thai glyphs missing on the printed label    | Blocking product defect; `RG-004` exists to catch it before launch                 |
| Label unreadable after handling             | `RG-029`; may require label stock or template changes                              |
| Duplicate physical labels                   | Reprint records make it traceable; the LPN is unchanged so stock is not duplicated |

A print failure never blocks or reverses a posted receipt. Stock exists whether or not
its label printed; the handling unit can be printed again.

## 8. Configuration

Bridge endpoint and target names are per-workstation configuration discovered at
runtime, not repository configuration. Template definitions are tenant data with
versioning (`label.template.manage`).

## 9. Verification

- Unit tests against a fake transport: dispatch recording, reprint semantics, failure
  mapping, no automatic retry.
- Integration tests: print-job records carry template version and payload hash; reprint
  requires its own permission; relabel is a distinct operation.
- Property tests: generated ZPL is deterministic for a given template version and
  input.
- Physical tests: real printer, real stock, Thai and English text, rescan after
  handling (`RG-004`, `RG-029`).

## 10. Release gates

`RG-004` physical print and rescan, `RG-029` post-handling readability, `RG-003`
scanner spike (the rescan half), `RG-051` full slice on pilot hardware. See the
[register](../release-gates.md).

## 11. Open questions

- Printer models in the pilot fleet and their ZPL dialect quirks.
- Whether the customer permits bridge installation on more than one workstation
  (B-05).
- Label dimensions and stock, which constrain template design and Thai font size
  (§5 Q29).
