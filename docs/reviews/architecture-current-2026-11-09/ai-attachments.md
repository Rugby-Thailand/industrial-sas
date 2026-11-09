# A09: current AI and attachment disposition

Verified from clean task branch `t3/verify-a09-ai-attachments`, fast-forwarded from
137c8d52 to main de79d7ad before investigation. The old report is evidence to
recheck, not a current specification. No parent changes, real credentials,
provider uploads/deletes, cloud data writes, deployment or data reset were used.

| Subclaim                                                                             | Disposition      | Reproduction and current evidence                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI Search already has a durable actor quota                                          | ALREADY RESOLVED | `hr/navigationIntent.interpret` declares 20 requests / 10 minutes and checks `ctx.quota`; `tenantFunctions` consumes `actionQuotas` transactionally during authorized preflight.                                                                                                                                                                                          |
| Ticket extraction bypasses that application mechanism                                | CONFIRMED/FIXED  | Before the change, seed the real actor's image quota at 20 and concurrently invoke four registered `extractJobTicket` actions: they succeed and call the provider. `image-quotas.integration.test.ts` was red, then green after adding a declaration and pre-provider refusal.                                                                                            |
| Location extraction bypasses that application mechanism                              | CONFIRMED/FIXED  | The same red/green reproduction calls registered `extractLocationLabel`. Each image capability now has its own 20 / 10 minute actor limit, shared across warehouses and server instances within the org.                                                                                                                                                                  |
| Concurrent denials must not be billable attempts                                     | CONFIRMED/FIXED  | The quota suite sends four concurrent requests with 20 and 19 consumed units for each capability. Exactly zero or one reaches the provider and creates a ledger operation/attempt; the row never exceeds 20. Tests use the real registered preflight and persistence, with synthetic provider transport. This is runtime harness evidence, not a deployed load benchmark. |
| Refusals require translated client behavior                                          | CONFIRMED/FIXED  | Both actions return `RATE_LIMITED` and `retryAfterMs`. Actual scan and Location callers render English/Thai guidance inside their existing inline feedback. The independently uploaded ticket photo remains available for manual completion and save.                                                                                                                     |
| Image validation, provider deadlines/retries and independent accounting were missing | REFUTED          | They already exist in the image actions and shared provider. They are preserved, including invalid-image refusals before provider work and unknown attempt cost remaining unknown. Existing provider/accounting tests exercise timeouts, limited retries, malformed responses and save-independent usage.                                                                 |
| Upload middleware permits an org-less session                                        | ALREADY RESOLVED | Main's #142 requires both `userId` and `orgId`. The real UploadThing POST tests retain signed-out and org-less refusal coverage.                                                                                                                                                                                                                                          |
| Authenticated uploads alone prove attachment ownership                               | CONFIRMED/FIXED  | Before the save change, registered `saveJobScans` accepted an arbitrary foreign URL and wrote a scan: the new URL-injection case was red. Main had no asset intent, verified callback identity, attachment transition or detached-upload cleanup.                                                                                                                         |
| Cross-org or cross-warehouse attachment is possible by URL                           | CONFIRMED/FIXED  | The new save path accepts a finalized `imageAssetId`; URL-only writes are refused. It checks org via tenant access, warehouse, creator, ready state, expiry and uniqueness for the entire group before writing. Tests cover foreign org, forged callback, duplicate attach, expired/claimed asset, all-or-nothing group validation and idempotent save replay.            |
| Public/private delivery or unauthorized CDN exposure is established by source        | UNRESOLVED       | Operations records describe staging Public access and public URL delivery; provider docs support both public and private ACLs. This work does not read current provider settings or fetch real photo bytes. An unauthorized real CDN fetch was not performed, so no claim of private delivery or unauthorized data exposure is made. URL opacity is not authorization.    |
| Asset ownership and cleanup need a provider migration                                | REFUTED          | The existing UploadThing path supports server custom IDs, verified callbacks and deletion by file key/custom ID. The implementation retains that store and the existing public-delivery contract. No Convex-storage migration or new provider is needed for the demonstrated ownership defect.                                                                            |
| Abandoned uploads need scheduled cleanup                                             | CONFIRMED/FIXED  | Upload and AI run independently; closing/removing a draft can outlive a successful provider upload, including a lost callback. New intents persist before provider authorization; a seven-day draft/recovery grace is followed by bounded scheduled cleanup. Failed/unconfirmed deletion retains retry state. Legacy objects without new intents are outside cleanup.     |
| Org-wide concurrency/spend caps are currently required                               | UNRESOLVED       | The report proposed them conditionally. No traffic/spend/retry measurements or launch requirement demonstrate a need beyond persisted actor quotas. No speculative cap or reservation system is added. The existing usage ledger provides the measurement path; unknown provider costs are not converted into known zero.                                                 |

## Attachment flow and trust boundary

1. Next UploadThing middleware validates photo MIME/size and Clerk user/org, then
   calls registered `attachments.createIntent` with the user's Convex JWT and
   warehouse ID. Convex checks current membership, warehouse scope and manage
   permission. A persisted actor quota bounds intent creation to 100/day.
2. The provider file's server-assigned `customId` is the organization-owned
   intent ID. Browser input cannot choose the provider key or override that ID.
3. The pinned UploadThing route handler verifies the provider callback signature.
   Only then does the callback sign the exact asset ID, key, URL, size and MIME
   with a domain-separated HMAC using the app credential. `finalizeUpload`
   verifies this second receipt before its narrow integration write. It has no
   session because provider callbacks have none; an asset ID or browser
   `serverData` alone cannot authorize it. Duplicate callbacks are idempotent;
   conflicting metadata or expired/deleting intents fail closed.
4. The client awaits callback completion and retains the resulting asset ID and
   display URL in its existing draft. Only the ID enters the save payload.
   AI failure, upload failure, retake/removal and late callbacks retain their
   independent behavior. Nothing deletes a photo eagerly on uncertain save or
   temporary navigation; a retained draft can save within its grace period.
5. Save atomically attaches the asset and records its server-derived display URL.
   Current protected list/detail reads continue delivering that URL. Correction
   does not modify provenance. Deleting a scan releases its asset into a fresh
   seven-day recovery grace. Existing URL-only rows remain readable/correctable.
6. Cleanup claims only expired PENDING/READY/DELETING assets, at most 20 of each
   per org per run, with tenant-prefixed indexes and paginated organization
   dispatch. ATTACHED rows are never eligible. DELETING blocks save before the
   provider request. Provider-confirmed deletion removes the row; failure leaves
   it for retry. The custom ID covers uploads with lost callbacks. Historical
   untracked objects are never included. This is a bounded cleanup queue, not a
   promise of an exact deletion deadline during provider outage/backlog.

The inventory's exact `LocationImageReader:error` entry records the existing
Notice alert semantics and quota caller evidence. No foreground owner, task
completion owner, origin URL, route or semantic component target changes.

## Release/cutover (required; not executed here)

The schema change is additive: new `jobTicketAssets` table and optional scan
`imageAssetId`. Existing `imageUrl` rows need no rewrite/reset and retain delivery.
The optional URL argument remains accepted structurally for old tabs, but a
URL-only new attachment is deliberately refused as `ATTACHMENT_INVALID`.

1. Use the normal protected release process and recovery/backup contract.
   Provision the **same environment-specific UploadThing app token** as server
   `UPLOADTHING_TOKEN` in both Next and Convex through the authorized secret
   workflow. Staging and production must stay separate. Never publish the value.
   The backend refuses new intents when its token is absent. A mismatched token
   causes callback verification to fail closed and must block promotion.
2. Deploy the additive backend first. Coordinate a brief scan-photo acquisition
   pause, finish or explicitly discard old photo drafts, promote the matching Next
   build, and require old scan tabs to reload. Never silently reset unsaved
   work.
   Barcode/manual saves and historical reads do not require asset conversion.
   Do not roll back to a URL-accepting backend while this frontend is active.
3. In the isolated staging app, perform one authorized real upload/callback,
   save, protected detail read, foreign-tenant refusal, discard and cleanup check.
   Verify the app's actual ACL and explicitly review whether public photo
   delivery meets the product requirement. If private delivery is required,
   enable and verify provider ACL/signed delivery in a separate concrete change;
   current source does not claim it. Do not probe customer photos in logs/artifacts.
4. Confirm cleanup scheduling and failed-deletion retry with that staging app
   before production promotion. No old 19-file inventory is deletion authority.
   Retain those historical files and the documented external recovery procedure.

Provider facts were checked against primary documentation: [file routes](https://docs.uploadthing.com/file-routes)
(awaited callback data and ACL options), [upload protocol](https://docs.uploadthing.com/uploading-files)
(server metadata), [UTApi](https://docs.uploadthing.com/api-reference/ut-api)
(file/custom-ID deletion), and [provider signature verification](https://v6.docs.uploadthing.com/auth-security).
The [Convex runtime API](https://docs.convex.dev/functions/runtimes) supports
`atob`, `TextEncoder` and `SubtleCrypto` used by receipt verification.
The installed 7.7.4 handler also verifies `x-uploadthing-signature` before calling
`onUploadComplete`; route tests send valid and forged HMAC callbacks through it.

## Validation

Checks completed in this isolated branch (at most two Vitest workers):

- Main focused batch: **36 files / 735 tests passed**, covering all job-scan
  callers plus providers, accounting, registered boundaries, tenant/schema
  policy, production schema compatibility and i18n.
- Final focused quota/attachment/UploadThing route run: passed; added cases
  cover concurrent attachment consumption, signed invalid MIME/size and
  protected read delivery, in addition to the original red/green repros.
- `pnpm check:navigation`: **68 fixtures passed**, inventory gate passed.
- Normal `pnpm lint`, `pnpm format:check`, `pnpm typecheck:ts6` and pinned
  Bun 1.4.3 / TS 7.0.2 `pnpm typecheck`: passed. The pinned checker was installed
  through the existing hash-verified script into this worktree's ignored cache;
  no dependency or lockfile change was needed.
- `pnpm ci:codegen`: generated bindings reviewed, then freshness passed against
  the credential-free disposable local backend. Public-function validator
  snapshot was refreshed for the additive ID argument and integration ingress,
  with its compatibility suite passing. `git diff --check`: passed.

Red/green commands and final check results are also recorded with the PR. Focused
runtime tests use synthetic provider responses and credentials, real registered
Convex authorization/persistence boundaries, and actual scan/Location callers.
They do not establish physical camera behavior, live provider ACL or production
throughput. Codegen uses the repository's credential-free throwaway local backend.
