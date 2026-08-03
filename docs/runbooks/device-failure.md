# RB-09 — Printer and scanner failure at the site

Status: **skeleton, never executed.** No printing, scanning, or device integration exists,
and the Phase 0 hardware spikes have not run. Evidence gates: `RG-003` (scanner spike),
`RG-004` (physical label print), `RG-029` (post-handling readability).

## Principle

Stock existence never depends on hardware. A receipt that posted is real whether or not its
label printed, and a handling unit exists whether or not the operator can scan it. Every
recovery path below preserves the ledger and re-prints or re-scans afterwards
([ADR-0007](../adr/0007-inbound-slice-scope.md)).

## Preconditions

- `TODO` Confirmed printer and scanner models at the site — `RG-063`.
- `TODO` Local print bridge installed and its version recorded — `RG-004`.
- `TODO` Spare label stock and a spare scanner available on site — `RG-063`.
- `TODO` Site IT contact for network and installation issues — `RG-063`.

## Scanner failure

| Symptom                             | First action                                                   | Then                                                   |
| ----------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| No input reaches the field          | Confirm focus is in the scan field; test in a plain text field | Re-pair or restart the scanner; swap to the spare      |
| Characters arrive but no submission | Terminator misconfigured on the device                         | Reconfigure per the device profile; record the setting |
| Partial or garbled scans            | Assembly timeout is rejecting input, as designed               | Clean the window; check lighting; slow the scan rate   |
| Scan resolves to the wrong item     | Stop; capture the raw scan string                              | Treat as a parser defect: add a fixture (`RG-005`)     |
| Camera fallback fails               | Check permission and lighting                                  | Use manual entry; record that manual entry was used    |

Manual entry is always available and is itself audited. It is slower, and a rising manual-entry
rate is a hardware signal worth watching.

## Printer failure

| Symptom                            | First action                                         | Then                                                                       |
| ---------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| No printer target found            | Confirm the local bridge is running                  | Restart the bridge; if prohibited, use the PDF fallback                    |
| Bridge reports the printer offline | Check power, media, and ribbon; close the print head | Retry once; reprints are audited, LPN unchanged                            |
| Prints blank or faint              | Media and darkness settings                          | Replace stock; verify with a test label                                    |
| Thai glyphs missing or boxed       | **Stop using that template version**                 | Product defect; escalate against `RG-004`                                  |
| Label unreadable after handling    | Capture a sample                                     | Escalate against `RG-029`; may need different stock                        |
| Duplicate physical labels          | Compare print-job records and payload hashes         | Destroy the surplus label; the LPN is unchanged so stock is not duplicated |

Never resolve a print failure by issuing a new LPN. A reprint reuses the LPN; a relabel is a
distinct, permissioned domain operation (`handlingUnit.relabel`).

## Continuing work during hardware failure

1. Keep posting receipts and putaway movements: those are server operations, not printer
   operations.
2. Park handling units that lack a printed label in a staging location and reprint when the
   printer returns. `TODO` recommended parking convention — blocked by `RG-021`.
3. If the network is down rather than the hardware, degraded-online rules apply: pending
   intents are visible, correctness-sensitive steps are blocked
   ([ADR-0009](../adr/0009-degraded-online-connectivity.md)).
4. Record the outage window; it affects the pilot completion-rate measurement (`RG-039`).

## Evidence to record

Device model and firmware, bridge version, symptom, actions taken, whether manual entry or
PDF fallback was used, the outage window, and any label sample retained.

## References

- [PrinterTransportPort](../integration-contracts/printer-transport-port.md)
- [Device capture adapters](../integration-contracts/device-capture-adapters.md)
- [ADR-0005 — identifiers and LPN lifecycle](../adr/0005-warehouse-location-and-stock-identity.md)
- Plan §3.3, §5 Q8, Q9, Q29, §10 Phase 0
