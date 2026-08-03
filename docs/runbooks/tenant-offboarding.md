# RB-06 — Tenant offboarding, export, and deletion

Status: **skeleton, never executed.** No export jobs, deletion procedure, or retention
enforcement exist. Evidence gates: `RG-058` (procedure documented and rehearsed), `RG-049`
(retention decision).

## The tension this runbook manages

Two obligations pull in opposite directions and must both be honoured:

- **Retain.** Ledger and audit records are business records with a provisional seven-year
  retention (D-27) and are never edited or deleted by application code
  (`INV-0003-07`).
- **Erase.** Thai PDPA gives data subjects rights over personal data, and a departing tenant
  expects their data removed.

The resolution is to separate data classes: business records are retained or handed over;
personal profile data is erased or pseudonymized (plan §14). **This separation requires
counsel confirmation** (`RG-048`), which does not yet exist.

## Preconditions

- `TODO` Retention decision per data class confirmed by legal and accounting — `RG-049`.
- `TODO` Counsel-approved position on which fields may be erased versus pseudonymized —
  `RG-048`.
- `TODO` Export job implemented, producing a complete tenant archive — Phase 4.
- `TODO` Deletion tooling implemented, with production guards and two-person approval —
  Phase 4.
- Written offboarding instruction from an authorized tenant contact.

## Procedure

1. **Confirm authority.** Verify the requester is authorized to terminate or to request
   erasure. Record the instruction.
2. **Freeze.** Disable new work: revoke memberships, or set the organization to read-only.
   `TODO` mechanism — blocked by Phase 1 entitlements.
3. **Export everything the tenant is entitled to.** A complete logical export of their
   tenant tables, ledger history, audit events, attachments, and label evidence, delivered
   through a short-lived signed URL or an agreed secure channel
   ([`FileStoragePort`](../integration-contracts/file-storage-port.md)).
4. **Verify the export.** Row counts and checksums against a manifest; a sampled receipt's
   history must be reconstructable from the export alone
   ([`RB-02`](./backup-and-restore.md) verification steps).
5. **Hand over and confirm receipt** in writing before deleting anything.
6. **Classify data for deletion.**

   | Class                               | Action                                              |
   | ----------------------------------- | --------------------------------------------------- |
   | Identity profile data (name, email) | Erase or pseudonymize in mirrored records           |
   | Audit actor references              | Pseudonymize; the audit event itself is retained    |
   | Ledger transactions and lines       | Retained per the retention decision; never edited   |
   | QC photos and signature images      | Delete unless required as a retained quality record |
   | Report artifacts and exports        | Delete from storage after handover                  |
   | Telemetry                           | Expires on its own shorter schedule                 |
   | Support-grant records               | Retained as security evidence                       |

7. **Delete (destructive).** Requires a named approver and two-person execution. Delete
   vendor-held files first, then in-scope Convex documents, then identity records in Clerk.
8. **Revoke access at the identity provider.** Remove the organization and its memberships
   so no session can resolve it (`INV-0001-03`).
9. **Verify.** Confirm no live path resolves the tenant, no attachment URL remains valid,
   and the retained records are exactly the classes the retention decision permits.
10. **Record.** What was exported, what was deleted, what was retained and why, who approved,
    and when.

## Backups and the deletion promise

A tenant deleted today still exists in platform backups and independent exports until those
artefacts expire. The offboarding confirmation must state this honestly rather than claiming
immediate global erasure. `TODO` exact wording — blocked by `RG-048`.

## Never

- Delete ledger or audit documents through application code (`INV-0003-07`).
- Delete before the tenant confirms receipt of their export.
- Promise erasure from backups sooner than those backups expire.
- Perform any step of this runbook without a named approver.

## References

- [ADR-0003 — append-only ledger](../adr/0003-append-only-inventory-ledger.md)
- [ADR-0012 — retention and DR](../adr/0012-delivery-release-and-quality-gates.md)
- [FileStoragePort](../integration-contracts/file-storage-port.md)
- Plan §3.2 (D-27), §5 Q37, Q43, §14
