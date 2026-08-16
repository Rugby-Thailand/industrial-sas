# Project goal

## Goal

Give Thai factories fast, accurate, traceable warehouse work.

## User

- Thai manufacturer.
- 1–3 warehouses.
- 500–5,000 SKUs.
- Operator, supervisor, planner, engineer, admin.

## Scope

### Inbound

`PO → receive → QC → pallet/lot → label → putaway → ledger`

### Order to factory

`Customer PO → design check → master-card release → factory packet → acknowledgement`

## Outcomes

- Less paper and re-entry.
- Exact stock by tenant, warehouse, item, location, lot, status, owner, and handling unit.
- Full actor, device, time, and reason trace.
- Thai-first handheld work.

## Scale target

- 5–40 concurrent scanners.
- 3,000 inbound lines/day.
- About 1 million ledger lines/year/tenant.

## Success

| Metric                          |      Target |
| ------------------------------- | ----------: |
| Handheld completion             |        ≥95% |
| Scan acknowledgement, pilot p95 |     <800 ms |
| Sampled stock accuracy          |        ≥99% |
| Tenant leaks                    |           0 |
| Ledger drift                    |           0 |
| Final-week defects              | 0 P0; ≤2 P1 |

## Not now

- True offline.
- Native mobile.
- RFID, NFC, or automation.
- Full outbound, MRP, or manufacturing.
- Catch weight.
- Live billing or 3PL billing.
- 3D UI without customer proof.

Launch proof lives in [release gates](../release-gates.md).
