# RB-05 — Tenant onboarding

Status: **skeleton, never executed.** No provisioning flow, seeds, or environments exist.
Evidence gates: `RG-011` (staging walkthrough), `RG-060` (rehearsed).

Onboarding is sales-provisioned during the pilot; self-service is out of scope (B-02).

## Preconditions

- `TODO` Signed agreement including the DPA — blocked by `RG-048`.
- `TODO` Cross-border transfer basis recorded for this tenant — blocked by `RG-006`.
- `TODO` Provisioning flow implemented and idempotent — blocked by Phase 1.
- `TODO` Reference-data and onboarding seeds implemented — blocked by Phase 2.
- Confirmed tenant inputs: warehouses, location vocabulary, item and supplier master data,
  UOM conversions, QC profiles, putaway policies, label stock, printers, scanners, and the
  warehouse map (`RG-063`, `RG-021`, `RG-023`).

## Procedure

1. **Create the identity organization** in Clerk for the correct environment. One
   organization is one tenant (`INV-0001-05`).
2. **Provision the WMS organization.** The provisioning flow is idempotent; running it twice
   must not create a second tenant. Set timezone (default `Asia/Bangkok`), locale (Thai
   default), currency (THB), and entitlements (D-05, D-06, D-07, D-30).
3. **Seed reference data.** Permission catalogue and seeded roles, idempotently
   ([permissions](../permissions.md), `INV-0012-08`). Confirm no demo data is seeded into
   production (`INV-0012-07`).
4. **Configure policies.** Over-receipt tolerance, under-close reasons, maker-checker
   thresholds, mixed-content flag (default off), negative-stock policy (default forbidden),
   and the serial feature flag (default off) — D-10, D-12, D-09, `RG-027`.
5. **Create warehouses and the location hierarchy** using the reviewed vocabulary
   (`RG-021`). Define storage classes and prohibited-location rules (hard constraints,
   D-13).
6. **Load master data.** Items with a single base UOM each, exact alternate-UOM conversions,
   barcodes, suppliers, and lots as needed. Every conversion must be exact or the import is
   rejected (`INV-0004-05`).
7. **Configure labels.** Create the label template, publish a version, and print a physical
   test label in Thai and English, then rescan it (`RG-004`, `RG-029`).
8. **Invite users and assign roles** with the narrowest warehouse scope that lets each
   person work (`INV-0006-04`). Confirm no communal privileged account exists.
9. **Verify tenant isolation for this tenant.** Confirm that an actor of another tenant
   cannot see any of the new tenant's data. `TODO` verification script — blocked by
   Phase 1.
10. **Walk the slice.** Complete one real PO through receive → QC → pallet → print →
    putaway → inventory history on the tenant's own hardware (`RG-051`).
11. **Record the baseline.** Capture receiving cycle time and inventory accuracy before
    go-live, so improvement can be measured later (`RG-008`, `RG-052`).
12. **Train.** Deliver Thai operator and supervisor materials, including what "pending"
    means under degraded-online behaviour (`RG-044`, `ADR-0009`).
13. **Confirm expectations in writing.** Degraded-online acceptance (`RG-009`), support-access
    policy (`RG-015`), and retention (`RG-049`).

## Do not

- Seed demo or sample data into a production tenant.
- Grant `ORG_ADMIN` to operators for convenience.
- Enable mixed SKU/lot content, negative stock, consigned ownership, or serial tracking
  without an explicit written request (D-09, D-10, D-11, D-12).
- Load master data with rounded UOM conversions.

## Evidence to record

Tenant identifiers, environment, who provisioned it, configuration values chosen, master-data
counts loaded, the physical label test result, the slice walkthrough record, the baseline
measurements, and the written confirmations collected.

## References

- [ADR-0001 — multi-tenancy and identity](../adr/0001-multi-tenant-saas-and-identity-ownership.md)
- [ADR-0005 — warehouse, location, and stock identity](../adr/0005-warehouse-location-and-stock-identity.md)
- [Permission catalogue](../permissions.md)
- Plan §4 (B-02), §5 Q2, §10 Phase 1, §14
