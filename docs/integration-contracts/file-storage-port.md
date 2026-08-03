# INT-03 — `FileStoragePort` (UploadThing private tenant files)

Status: **specification.** `uploadthing` 7.7.4 and `@uploadthing/react` are installed
and unwired. There is no upload route, no port, and no UploadThing application created
by this repository.

Owner ADRs:
[ADR-0008](../adr/0008-adapter-ports-and-release-gates.md),
[ADR-0007](../adr/0007-inbound-slice-scope.md) (QC evidence),
[ADR-0011](../adr/0011-async-jobs-reporting-and-observability.md) (export artifacts).

## 1. Capability

Storage for tenant-visible binary artifacts: QC evidence photos, signature images,
label PDFs, and asynchronous report exports. Files are private; access is granted only
through short-lived signed URLs issued after a fresh permission check (D-20).

Internal-only artifacts with no tenant visibility may use Convex file storage instead;
the port covers tenant-visible files.

## 2. Direction and trust boundary

| Flow                  | Direction             | Trust                                                                    |
| --------------------- | --------------------- | ------------------------------------------------------------------------ |
| Upload authorization  | Browser → Convex      | Tenant, warehouse, and permission checked before an upload begins        |
| Upload                | Browser → UploadThing | Vendor accepts the file against a scoped, short-lived grant              |
| Metadata registration | Vendor/app → Convex   | Authoritative record of who owns the file and which entity it belongs to |
| Download              | Browser → signed URL  | URL issued only after a fresh server-side permission check               |
| Deletion              | Convex → UploadThing  | Driven by retention policy or tenant offboarding                         |

The vendor is never the authorization source. Convex holds the metadata that decides
who may read a file (§6.1).

## 3. Port operations

```ts
type FileStoragePort = {
  authorizeUpload(input: AuthorizeUploadInput): Promise<UploadGrant>;
  registerUploaded(input: RegisterUploadedInput): Promise<StoredFileRef>;
  createSignedDownloadUrl(
    input: SignedUrlInput,
  ): Promise<{ url: string; expiresAt: number }>;
  deleteFile(input: DeleteFileInput): Promise<void>;
};
```

`AuthorizeUploadInput` names the organization, warehouse, owning entity, expected
content type, and a size limit. `UploadGrant` is short-lived and single-purpose.

## 4. Timeouts and retries

| Operation                 | Timeout | Retries          | On exhaustion                                     |
| ------------------------- | ------- | ---------------- | ------------------------------------------------- |
| `authorizeUpload`         | 2 s     | 1                | Fail the capture step with a retry affordance     |
| Upload (browser → vendor) | 60 s    | Client-driven    | Keep the pending capture; never block the receipt |
| `registerUploaded`        | 3 s     | 2 with backoff   | Orphan-file sweep job reconciles (see §7)         |
| `createSignedDownloadUrl` | 2 s     | 2 with backoff   | Show a retry, never a cached long-lived URL       |
| `deleteFile`              | 10 s    | Job with backoff | Dead letter, then manual retention follow-up      |

Signed URL lifetime is minutes, not hours, and is never persisted in a document.

## 5. Idempotency

- `authorizeUpload` is safe to repeat; each call yields a fresh, independent grant.
- `registerUploaded` is idempotent on the vendor file key: re-registering the same key
  for the same entity is a no-op.
- `deleteFile` is idempotent: deleting an already-deleted file succeeds.
- A retried upload that produces a second stored object leaves an orphan, resolved by
  the sweep job rather than by guessing.

## 6. Data and privacy

| Data               | Sensitivity                                         | Notes                                                                   |
| ------------------ | --------------------------------------------------- | ----------------------------------------------------------------------- |
| QC evidence photos | May contain incidental personal data (hands, faces) | Private ACL; `quality.attachment.read` required; excluded from `VIEWER` |
| Signature images   | Personal data                                       | Deferred capability; when enabled, treated as personal data in the ROPA |
| Report exports     | Tenant business data                                | Private; download requires `reporting.export.read`                      |
| Label PDFs         | Business data                                       | Retained as print evidence with the payload hash                        |

- Storage region must be confirmed, and a region outside Thailand needs the same
  cross-border basis as the data plane (`RG-035`, `RG-006`).
- UploadThing is a subprocessor and appears in the subprocessor register (`RG-048`).
- Retention follows the evidence class, not a single global rule; erasure requests
  distinguish personal images from retained business records (`RG-058`).
- No file is world-readable at any point (`INV-0008-06`).

## 7. Failure semantics

| Situation                           | Behaviour                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vendor unavailable during capture   | The QC or receipt step proceeds; the attachment is marked pending and retried. Evidence is never a reason to lose a posting, and a disposition requiring evidence stays blocked until it arrives |
| Upload succeeds, registration fails | Orphan object in the vendor; the sweep job reconciles vendor keys against metadata and deletes unclaimed objects after a grace period                                                            |
| Signed URL expires mid-download     | The client re-requests; permissions are rechecked                                                                                                                                                |
| Permission revoked after issuance   | The outstanding URL remains valid until expiry — accepted, and the reason lifetimes are minutes                                                                                                  |
| Deletion fails                      | Dead letter with the retention obligation recorded; manual follow-up in the retention runbook                                                                                                    |
| Private ACL unavailable on plan     | Blocking: `RG-035` fails and no tenant evidence is stored until resolved                                                                                                                         |

## 8. Configuration

Token and app identifiers are environment variables per environment; names only in
[`.env.example`](../../.env.example). Separate applications per environment class
(`RG-059`).

## 9. Verification

- Unit tests against the in-memory fake: grant scoping, size and content-type limits,
  idempotent registration, expiry arithmetic.
- Integration tests: a download URL is refused without the permission, refused across
  tenants, and refused for a revoked membership.
- Isolation tests: a file reference from tenant A is unreadable as tenant B.
- Job tests: orphan sweep and retention deletion.
- No test contacts the vendor (`INV-0008-05`).

## 10. Release gates

`RG-035` region and private-ACL confirmation, `RG-006` cross-border basis, `RG-048`
subprocessor register, `RG-057` ROPA coverage of photos, `RG-058` export/deletion
procedure. See the [register](../release-gates.md).

## 11. Open questions

- Confirmed storage region and whether it can differ from the Convex region
  (`RG-035`).
- Maximum photo size and count per inspection, given handheld bandwidth.
- Whether label PDFs are tenant-visible evidence or internal-only artifacts.
