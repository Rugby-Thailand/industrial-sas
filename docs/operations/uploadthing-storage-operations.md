# File storage inventory and recovery

The 2026-10-13 read-only inventory found no historical Convex files to migrate.
New job-ticket photos continue through the existing UploadThing route; Convex
stores their returned URLs. Native Convex exports now back up the database
with `includeStorage=false`. Fresh completion and the minimum 24-hour remaining
recovery window still gate every production backend release. The protected
daily backup uses the same contract. No manual deployment or backup bypass is
part of this change.

## Current inventory evidence

The operator used existing authorized credentials in memory, checked the
reviewed deployment identity before reads, and exhausted `_system/cli/tables`
and `_system/cli/tableData` pagination. The scan visited nested document values,
counted photoURLs/imageURLs by provider, matched exact `_storage` IDs and Convex
file URLs, and checked unresolved explicit storage IDs. Storage metadata was
read again after scanning all tables and remained empty.

| Target     | Scan start UTC          | Scan completion UTC     | Tables | Documents | Convex objects / bytes | Convex references / file URLs / unresolved IDs | Saved photo/image URLs |
| ---------- | ----------------------- | ----------------------- | ------ | --------- | ---------------------- | ---------------------------------------------- | ---------------------- |
| Production | 2026-10-13 04:12:08.292 | 2026-10-13 04:12:30.248 | 61     | 3,375     | 0 / 0                  | 0 / 0 / 0                                      | 0                      |
| Staging    | 2026-10-13 04:12:30.690 | 2026-10-13 04:12:51.137 | 61     | 317       | 0 / 0                  | 0 / 0 / 0                                      | 0                      |

These are independent paginated reads, not an atomic database snapshot. They
prove the observed empty inventories at the recorded times. No customer
records, file names, identifiers, URLs, signed links or credentials were
published, and no objects were downloaded, modified or deleted.

Repeat the aggregate inventory using an explicitly supplied operator
`CONVEX_INVENTORY_ADMIN_KEY` and one reviewed target:

```sh
node scripts/operations/inventory-file-storage.mjs --target=production
node scripts/operations/inventory-file-storage.mjs --target=staging
```

The command does not load `.env.local`, select an ambient developer deployment,
or obtain account credentials. Supply the target's authorized credential at
runtime through a private secret store. Output is aggregate JSON only. Any
provider failure, repeated pagination cursor, page limit, deadline or changing
storage inventory returns failure without publishing partial clearance. A
credential-free run refuses before any network request.

## Provider setup evidence

The authenticated Vercel browser session confirmed Production and Preview
`UPLOADTHING_TOKEN` Secrets in the production project. Neither value is
readable. The connected API and saved CLI credentials each returned HTTP 403
for this team, so the browser session was used for authorized staging setup.
The production Secrets were not changed. The user then explicitly designated
the current `.env.local` token as production and supplied a dashboard screenshot
of the existing `industrial` app in their personal team. The screenshot app
identity matched the runtime-decoded token. The supported provider usage API
returned HTTP 200, **19 files / 12,670,474 app bytes**. A complete paginated
file inventory returned the same counts in one page, with all 19 files in
`Uploaded` state. No file names, keys, URLs or bytes were published or deleted.
The current dashboard session belongs to a different account and does not
establish owner access to this production app. Saved Vercel Secret equality
was not independently checked because its value remains unreadable. The
production association is user-provided and provider-verified; this does not
prove a future release's upload/callback flow.

The production app, the empty `industrial` team app and the new staging app
are distinct. All 19 existing production-provider files are retained. The
current database scan found no photo/image URL references, so this change
performs no historical migration and makes no deletion decision.

A dedicated `industrial-sas-staging` app was created on the **Free ($0/month)**
plan in the existing `industrial` team. Its Public access preserves the current
job-ticket photo delivery contract. Its token was verified against the newly
created app before saving it as a Secret in the staging project's Production
target. Environment readback confirmed one unreadable Secret on that target.
The provider metadata API returned HTTP 200, zero app bytes and zero uploaded
files. The transfer used the clipboard without printing the token; the
clipboard was cleared afterward. No paid resources, plan upgrades, file uploads
or deployments were performed. The first real staging upload/callback check is
still pending the normal release workflow.

## External file recovery procedure

Convex backup restores records and their URL references. It does not archive
UploadThing bytes, provider app configuration or credentials. Before real
photos become recovery-critical, the operations owner must establish a private
archive with an agreed retention window and test the following procedure:

1. Use the verified production `industrial` app, confirm owner access, and
   record its app identity privately. Inventory all retained file keys with
   pagination and reconcile those keys with saved database photo references.
   Do not publish keys or URLs in CI artifacts. Retain the 19 current files;
   the absence of database photo references does not authorize deletion.
2. Copy retained bytes to a private, access-controlled archive through the
   provider's supported delivery mechanism. Keep a private manifest mapping
   original keys/references to content hashes, sizes and archive versions.
   Preserve the existing photo access rules and prevent ordinary retention or
   deletion jobs from removing the last recoverable copy.
3. Restore a fresh completed Convex database snapshot into an isolated target,
   then restore archived bytes to an isolated provider app. If restored keys or
   URLs differ, apply the reviewed reference mapping in that isolated database.
   Verify file hashes and the authenticated photo flow before any live recovery.
4. Record elapsed restoration time, restore counts, failures and retention
   expiry as aggregates. Record business RPO/RTO and archive retention with the
   operations owner; these are not currently established guarantees.

No archive store was purchased or configured and no timed external-file
restore was performed. Public file delivery is the existing product contract;
a private recovery archive does not require changing that contract. If a
future inventory finds historical Convex objects or references, retain the
source objects and a storage-inclusive backup, copy and verify bytes in
staging, prepare a reviewed reference mapping, and migrate through the normal
release workflow. Never delete source objects until recovery and reference
verification pass.

## Local verification

The focused inventory, release environment, native backup, release orchestration
and entrypoint run passed **5 files / 140 tests**. Full TypeScript checking,
scoped ESLint, scoped Prettier and `git diff --check` passed. A credential-free
inventory command returned `INVALID_INVENTORY_TARGET` without network access.
The database-only backup request and the first real staging upload/callback
remain for the protected workflow; no live backup request was issued here.
