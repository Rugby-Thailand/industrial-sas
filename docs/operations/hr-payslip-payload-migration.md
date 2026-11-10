# Payslip payload migration (inline bytes → `hrPayslipPayloads`)

Status: verified on a disposable local deployment, including exact snapshot restoration and original PDF hash checks. **Not executed against a cloud deployment.** See [integrated validation](../reviews/database-design-2026-11-01/validation.md).

## What changed

`hrPayslipRows` used to store each original PDF as `sourceBase64` next to the statement metadata. Every metadata read therefore loaded the bytes: staging version 31 of one employee's statement read about 15.7 MB of predecessor rows in the local fixture, close to Convex's 16 MiB transaction read limit (`tests/integration/hr-payslip-payloads.integration.test.ts`, red run against `a2e964e2`).

Now:

- `hrPayslipPayloads` (tenant table) holds the bytes, their SHA-256 and length, with the owning import and employee. It is never listed, paged or subscribed.
- `hrPayslipRows.payloadId` points at it. Listing, deep-link metadata, imports, predecessor and version checks read rows only; the fixture asserts they read **0 payload bytes**.
- Publication re-hashes only its own batch's payloads (bounded by the 4 MiB stage limit), never predecessor versions.
- The ticketed document command reads one payload and verifies org, import, employee, length and hash before returning it.
- A row without `payloadId` (written before this change) is refused with `PAYSLIP_SOURCE_MIGRATION_PENDING` for download and publication. It is not read inline any more.

Until all legacy inline rows have migrated, import browsing is capped at three
batches per page. The integration test stages and publishes six imports of eight
384 KiB PDFs each, converts them to the legacy shape, then traverses the list and
runs both migration and verification with transaction limits enabled. It also
covers a maximum-length source CSV containing three-byte UTF-8 whitespace.
Native byte limits may yield fewer batches or an empty terminal page; callers
must follow `continueCursor` until `isDone`. This bound assumes the existing
4 MiB per-import source limit; it does not certify manually imported oversized
legacy records. Complete the migration before considering a larger page size.

Payloads are ordinary Convex documents, so table snapshot exports and restores cover them like the rows. There is no new external file store.

## Rollout (expand → migrate → contract)

1. **Expand** — deploy this backend. `sourceBase64` stays as an optional, deprecated field so existing documents still validate.
2. **Migrate** — run the internal mutation in pages until `isDone`, passing back `continueCursor`:

   ```sh
   npx convex run hr/payslipMigration:migrateInlinePayloads '{"dryRun":true}'
   npx convex run hr/payslipMigration:migrateInlinePayloads '{}'
   npx convex run hr/payslipMigration:migrateInlinePayloads '{"cursor":"<continueCursor>"}'
   ```

   Each call examines at most 8 rows (`MAX_BATCH`), so even 384 KiB originals keep a call to a few MiB. The payload insert and the row update happen in one transaction. Re-running a page, or resuming after an interruption, never duplicates or loses a document. A row moves only if its decoded bytes still hash to its immutable `sourceHash`. Otherwise its ID is returned in `integrityFailures` and the row is left untouched for investigation. Bytes are never repaired or dropped.

3. **Completion rule** — one full pass from an empty cursor with `dryRun: true`, summed over all pages, reports `inline: 0`, `missingPayload: 0` and no `integrityFailures`. Record the summed `scanned` and `alreadyMigrated` counts with the deployment name and date. The verification pass also decodes and re-hashes every already-moved payload, checks its byte length, and matches its tenant, import and employee to the statement. Any integrity failure must be resolved from the retained import source before contracting.
4. **Contract** — in a later release, remove `sourceBase64` from `convex/hr/schema/payslip.ts`, and remove `migrateInlinePayloads` once every deployment has met the completion rule.

Rollback: the expand release reads only payloads. Rolling back the backend after migration would make migrated rows unreadable by the old code, which reads `sourceBase64`. Roll forward instead. The bytes are still intact in `hrPayslipPayloads`.
