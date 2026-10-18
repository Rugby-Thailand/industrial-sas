# Convex backend cost and performance audit: HR, shared tenancy, writes, background work and actions (Kiro, 2026-10-13)

This is a read-only review of the current working tree. The HEAD is `733c6ac`, and uncommitted edits are present in `convex/hr/self.ts`, `convex/hr/navigationIntent.ts`, `convex/schema.ts` and the new `convex/hr/preferences.ts`. The line numbers below refer to those dirty files as they are now.

**Review provenance:** Kiro CLI produced this report using Opus 5.5 with high effort. Parent and two Codex Sol 6.1 reviewers subsequently corrected the mutation-count scope, current `take` limit, clock/cache and subscription consistency claims, filtered-history completeness, and external scheduling/retention assumptions. The consolidated recommendation is in [README.md](README.md); audit consolidation and retention changes are conditional design decisions, not immediate cost fixes.

During this review I:

- did not run any code;
- did not call any deployment;
- did not read any environment or credential file;
- added only this report; did not edit application code, commit or push anything.

I read `AGENTS.md`, `docs/plans/convex-database-io-optimization.md` and `docs/reviews/hr-kiro-performance-audit-2026-10-10.md`. I also read the October 10 backend and HR audits (`performance-kiro-2026-10-10/03-backend-warehouse.md`, `04-hr-search.md`) and this folder's `codex-queries.md`, `codex-subscriptions.md` and `convex-official-baseline.md`.

Every claim below comes from reading source code, unless it is marked as coming from official documentation. **No production profile, per-function database I/O figure, or measured byte count backs any finding.**

## How to read the supplied screenshot

The screenshot shows 171K calls, 1 GB + 641.01 MB of database I/O, 12.21 MB of storage and 24.05 MB of egress. These are four separate meters:

- **Function calls** count client calls, scheduled runs, _subscription updates_ and file accesses ([limits](https://docs.convex.dev/production/state/limits)). A 40K call count for `buildingStatusControl` therefore says how often it executed or updated. It does not say how many bytes it read.
- **Database I/O** is "document and index data transferred between Convex functions and the underlying database" ([limits](https://docs.convex.dev/production/state/limits)). It includes **writes** and **index entries**, not only document reads.
- **Response/network bytes** measure transfer to clients; billed Data Egress must be interpreted using the account's documented meter, which includes file/backup traffic. Trimming a response reduces its payload, but neither proves a proportional billed-egress reduction nor shrinks the database bytes already read.
- **Storage** is retained rows plus indexes. Each index is priced as another copy of the table ([limits](https://docs.convex.dev/production/state/limits)).

For orientation only: 1.64 GB divided by 171K calls is about 9.6 KB per call. That is a mean across cache hits, heavy reruns and writes. It cannot be attributed to any function, and nothing below depends on it.

## Status of earlier findings (verified against current code)

| Earlier finding                                                        | Current status                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| September: request ID read the clock; ordinary queries read `Date.now` | **Fixed.** `tenantFunctions.ts:455` uses `crypto.randomUUID()` for queries. `tenantFunctions.ts:326–333` uses the membership's `_creationTime` as the clock for non-expiring, already-effective memberships. Do not re-report. |
| September: layout and inventory split for buildings                    | **Implemented.** See `codex-subscriptions.md`. Not re-audited here.                                                                                                                                                            |
| Oct 10 HR #1: `Date.now()` in HR query paths                           | **Still present.** See K4. The line list there is re-verified.                                                                                                                                                                 |
| Oct 10 HR #2: period lock reads all of a site's periods                | **Still present** (`shared.ts:439–465`). See K3, which adds an incremental fix that needs no new API.                                                                                                                          |
| Oct 10 HR #3: the tenant index API supports equality only              | **Still present** (`tenantDb.ts:179–185`, `tenantStorage.ts:241–249`). It enables K3, K5 and K8.                                                                                                                               |
| Oct 10 HR #7, #8a: recent corrections; serial version lookups          | **Still present.** See K8. `periods.ts:106–118` is unchanged.                                                                                                                                                                  |
| Oct 10 backend F6: duplicated authorization chain                      | **Still present.** See K7.                                                                                                                                                                                                     |
| Oct 10 backend F2 and Codex #1: readiness `generation` hot document    | **Still present** and covered there. I only add the write-side note in the cross-check.                                                                                                                                        |

## Findings

Each finding states which meter it moves: **R** (read bytes), **W** (write bytes, including index entries), **C** (function calls), **L** (latency) and **E** (egress).

### K1. Fresh successful command mutations commonly write three bookkeeping documents; audit indexes add maintenance (P2 · high code confidence · bytes unmeasured · R/W)

**New finding.**

**Evidence and call path**

- `mutationWithOrg` passes `audit: true` (`tenantFunctions.ts:791–808`). `authorizeTenantRequest` then always inserts an authorization row into `auditEvents` with outcome ALLOWED or DENIED (`tenantFunctions.ts:400–415`, `authorization.ts:555–560`).
- HR handlers then run `hrCommand` (`hr/shared.ts:499–608`). It writes a second `auditEvents` row for the domain action (`:570`, `:581`) and an `idempotencyRecords` row (`:590`).
- Master data (`lib/masterDataStore.ts:231, 300, 392, 496`) and finished goods (`finishedGoods/workflow.ts:161–188`) follow the same three-write pattern.
- `auditEvents` declares five custom indexes (`schema.ts:593–607`). Two of them, `by_orgId_actorUserId_occurredAt` and `by_orgId_supportGrantId_occurredAt`, are never queried anywhere in the repository (grep, including tests). `idempotencyRecords` has two indexes (`schema.ts:629–630`).

**Why cost rises**

For illustration, consider a fresh successful `hr/self:clockIn`; its actual traffic frequency is unmeasured:

|                                                                              | Documents | Custom index entries |
| ---------------------------------------------------------------------------- | --------- | -------------------- |
| Domain writes (`hrAttendanceDays` insert/patch, `hrAttendanceEvents` insert) | 2         | 3 + 1                |
| Bookkeeping writes (2 audit rows, 1 idempotency row)                         | 3         | 5 + 5 + 2            |

In that successful example, bookkeeping accounts for three of five distinct documents. The schema declares 12 bookkeeping index entries versus four domain index entries if all relevant rows are inserted. This is a schema-level illustration, not physical index updates or billed-byte ratios: an attendance-day patch need not change every indexed field, and changes commit atomically. Other paths differ: invalid requests, hash conflicts and replays return before new domain/idempotency rows; a business refusal writes a domain denial but no success idempotency record. Query/mutation logs are needed to attribute actual read/write I/O. Index maintenance is described in [Queries that scale](https://stack.convex.dev/queries-that-scale).

There is also a consistency gap. The authorization row uses the wrapper's server-minted UUIDv7 (`tenantFunctions.ts:455`), while the domain row uses the client `requestId`. The two rows for one operation cannot be joined through `by_orgId_requestId`.

**Boundedness**

The bookkeeping is bounded per command attempt, but its exact count depends on success/refusal/replay. `auditEvents` has no application retention implementation (see K10). Present storage is tiny; measure actual per-write I/O before prioritizing this over read-path work.

**Incremental remedies, lowest risk first**

1. Drop the two unused `auditEvents` indexes. This needs a product decision: the `supportGrantId` index exists for a planned tenant view (comment at `schema.ts:603`). Indexes can be re-added later; Convex backfills them.
2. For mutations whose handler writes its own domain audit row in the same transaction, record the authorization verdict in that row. It already carries `permissionCode`. Keep the separate authorization row only for DENIED decisions and for handlers that write no domain row. Every attempt stays auditable, and allowed writes save one row and five index entries.
3. Put the same `requestId` on both rows, or store `authorizationRequestId` on the domain row.

**Tradeoffs and security**

This changes audit semantics, and the governing ADRs/INV documents are not in this repository (I could not locate them). Treat option 2 as a compliance decision. DENIED rows must remain unconditional. A handler that throws after authorization still rolls back both rows, which is today's behavior.

**Verify**

- Extend `tests/fixtures/document-reads.ts` to count inserts and patches per table.
- Assert per-mutation write counts for clockIn, saveEmployee and one master-data write, before and after.
- On a deployment, compare `database_io_write_bytes` per mutation through log streams (Pro), or the dashboard's database I/O breakdown by function ([log stream schema](https://docs.convex.dev/production/integrations/log-streams)).

### K2. Employee change history reads authorization rows and filters them out (P2 · high code confidence · R, plus a correctness issue)

**New finding.**

**Evidence**

- `hr/setup.ts:143–189` (`employeeHistory`) reads `auditEvents.by_orgId_entityTable_entityId_occurredAt` for `("hrEmployees", employeeId)`, takes `.page({limit: 20, order: "desc"})`, and only then filters for `action === "hr.employee.save"`, ALLOWED, and non-empty `changes` (`:174–180`).
- `saveEmployee` declares `target: { table: "hrEmployees", id: employeeId }` (`setup.ts:252`). The authorization row from K1 is therefore written with the same `entityTable`/`entityId` (`tenantFunctions.ts:351–356, 400–415`) and `action = "hr.admin.manage"`.
- An idempotent replay also writes an authorization row without a new domain row.

**Effect**

- Roughly half or more of the 20 rows read are discarded.
- The screen can show about 10 or fewer edits while `complete: rows.isDone` reports `false`.
- Rows are read in full and then dropped, so R is wasted. The response is small, but that does not reduce the reads.

**Bound:** 20 audit documents per run, cheap in absolute terms. The completeness problem is the larger issue.

**Remedy**

Consider replacing the index with `by_orgId_entityTable_entityId_action_occurredAt` after checking deployed compatibility; current source has one reader. Exact action removes authorization noise, but ALLOWED saves with empty `changes` still fail the residual predicate. To deliver the newest 20 actual changes, use bounded continuation with explicit incomplete state or maintain an indexed changed flag/projection. `complete: rows.isDone` currently describes the raw audit range conservatively; the demonstrated defect is an underfilled newest-changes view, not an assertion that unseen matching rows never exist. Audit-row consolidation alone cannot guarantee a full page.

**Verify:** perform 15 actual value-changing saves and check all 15 are reachable; also cover no-op saves, authorization-only replays, denied attempts and continuation completeness.

### K3. Period lock and period lists read a site's entire period history; a bounded fix exists today (P1 · high code confidence · R/L, plus OCC/invalidation)

**Previously reported** (Oct 10 HR #2). The fix proposed here is new because it does not wait for the range API.

**Evidence**

- `closedPeriodCovering` calls `sitePeriods(...).all(1000)` and filters in memory (`hr/shared.ts:439–465`). Callers:
  - mutations `clockIn` (`self.ts:488`), `clockOut` (`self.ts:529`), `submitCorrection` (`self.ts:723`), `decideCorrection` and `disposeDay` (`review.ts:318, 470`);
  - subscribed queries `self.dayDetail` and `review.dayDetail` through `buildDayDetail` (`dayDetail.ts:139`).
- `periods.list` runs `sitePeriods` per scoped site, up to 50 sites × 1,000 periods, then keeps 200 (`periods.ts:145–182`).
- `periods.create` reads every period to check overlap (`periods.ts:401`).

**Why cost rises**

- **R:** every clock event reads all of the site's periods. At weekly cadence that is about 52 a year.
- **Invalidation:** each open day-detail subscription has the whole site period range in its read set, so any period create, close or revise re-runs it.
- **OCC:** clock events and period writes at the same site conflict ([OCC](https://docs.convex.dev/database/advanced/occ)).

**Bound:** 1,000 periods per site. `periods.list`'s theoretical 50,000 would exceed the 32,000 documents-scanned transaction limit ([limits](https://docs.convex.dev/production/state/limits)).

**Incremental remedy with the current `TenantIndexReader` API**

- `closedPeriodCovering`: `take(8, "desc")` is supported. Find the first predecessor with `startDate <= date`, then check `CLOSED && endDate >= date`. If all eight results start later than the requested date, fall back to the exact existing scan. Recent clock events may hit this fast path, but many future periods or backdated requests can still require fallback; frequency is unmeasured.
- `periods.list`: **`take(201)` is not supported**: `tenantDb.ts:186,405–413,563–567` caps this API at 100. A bounded top-200 merge requires a deliberate adapter enhancement or continuation across allowed native pages, respecting the one-native-pagination-per-function contract. This is not a one-line quick win. Preserve site completeness, total-result completeness and existing equal-date ordering.
- `periods.create`: under the verified non-overlap invariant, check the latest predecessor with `startDate <= end`. Retain the same exact fallback when it is outside the newest eight rows, including backdated creates. Without the invariant this shortcut can miss an older overlapping period.

**Tradeoffs and consistency**

Correctness relies on the non-overlap invariant, which `create` enforces (`periods.ts:402–403`), and on `startRevision` never moving dates. Check persisted/imported data before switching mutations. If overlaps exist, a newer draft or gap can conceal an older closed overlap, so the shortcut is not inherently fail-closed. Keep exact behavior until the invariant is established, and preserve fallback for requests outside the fast window.

**Verify:** seed 0, 52 and 260 periods; recent clockIn and dayDetail requests that hit the fast window should have bounded period reads. Backdated requests and many future periods must exercise the exact fallback and may still read the history. Add regression tests for the first, middle and last day of a closed period, the gap between periods, and a revised draft.

### K4. `Date.now()` remains in three shared query helpers, which lowers cache reuse (P2 · high code confidence · R/C on cold subscriptions)

**Previously reported** (Oct 10 HR #1; Codex subscriptions #2). The locations below are re-verified.

**Evidence**

- `orgClock` calls `Date.now()` (`hr/shared.ts:62–72`). Query callers:
  - `hr/access.current` (`access.ts:28`), mounted under `AppProviders` on every locale route per `codex-subscriptions.md`;
  - `self.today`, `self.holidays`, `self.requests`, `self.requestDetail`, `self.history`, `self.dayDetail` and `self.profile`;
  - `review.queue` and `review.dayDetail`;
  - `periods.preview` (`periods.ts:222`), which calls it **even when it renders a closed, frozen version**.
- `memberDirectory.describe` calls `Date.now()` (`memberDirectory.ts:40`) to compute `active`. `memberName` only uses `displayName` (`hr/shared.ts:634–645`), so every name lookup in day detail, profile, the registry and history adds a clock dependency it does not need.

**Why cost rises**

Convex documents that `Date.now()` in a query causes "the query cache to be invalidated more frequently than necessary" ([best practices](https://docs.convex.dev/understanding/best-practices/)). This can increase cache misses for new subscribers, including new tabs, reloads and reconnects; it does not prove that every such request misses the cache. Cache hits cost no database bandwidth.

**Smallest remedies**

1. In `periods.preview`, move clock work off the closed-data path where the response contract allows it. The current shared header still returns `today` (`periods.ts:244`), so merely moving the call is insufficient: separate that display field or deliberately update its consumers, preserving timezone behavior. This removes a handler clock dependency; expiring/future memberships can still intentionally read the authorization clock.
2. Split `memberDirectory` into a clock-free `displayName(userId)` used by `memberName`, and keep `get().active` (real clock) for write validation and the registry's `linkedActive`. Alternatively, apply the creation-time rule already used at `tenantFunctions.ts:326–333`.
3. In `hr/access.current`, return `timezone` and the offset and drop `today`, or move `today` into an HR-route-only query. The client already needs a refresh-boundary design for midnight (Oct 10 HR #1), and server writes keep using server time.

**Tradeoffs:** results that change with time (today state, deadlines) still need the `refreshAt`/`asOf` design from Oct 10 HR #1. Never let client time decide authorization, locks or writes.

**Verify:** with ordinary time-independent authorization, test that the new name-only helper and a deliberately separated closed-data endpoint do not read the clock. Do not expect the current `profile` to have zero clock calls: `self.ts:666` uses `orgClock` to determine employment on today's date. Cache expiration is not periodic subscription rerunning; reconnects/new subscribers may still reuse valid cache entries. Compare measured hit rates before/after ([function dashboard](https://docs.convex.dev/dashboard/deployments/functions)).

### K5. Review queue and draft period preview re-run their whole date range on any attendance write at the site (P2 · high mechanism confidence · frequency unmeasured · R/C/E)

**The mechanism was noted on Oct 10 (HR #3, #8b).** The segmentation remedy is new.

**Evidence**

- `review.queue` (`review.ts:99–197`) calls `loadSiteDays` per site (`shared.ts:388–414`). For every date in range it reads `hrAttendanceDays.by_orgId_warehouseId_businessDate` with `.all(198)`, plus one holiday `unique`.
- `periods.preview` draft calls `liveRows`, which uses the same loader (`periods.ts:57–98`).
- The read set covers every site day document in the range. Day documents include `certificationHistory` (K9).

**Why cost rises**

A clock-in, clock-out, correction submit or decision at that site writes a day document inside the range. That invalidates every subscribed queue or preview covering the site, and each rerun re-reads the whole range. Per rerun:

> R ≈ Σ over sites of (dates in range × day documents on those dates × document size) + one holiday read per date + the authorization chain.

The exposure grows with distinct query identities and relevant writes; subscription count multiplied by writes is not a billing formula. Cache sharing, coalescing and exact dependency ranges affect executions. Bounds are 31 days × up to 198 documents per date (`MAX_SITE_EMPLOYEES * 2`), with up to 500 queue items returned and up to 1,550 draft preview rows. Measure delivered updates separately: reevaluation does not prove a changed result or full payload delivery, and this review establishes no fixed two-calls-per-subscriber rule.

**Remedy sequence**

1. Land the range-read API first (Oct 10 HR #3). This reduces index-range count and latency but **not** the documents read, because the read set is still the whole range.
2. If measurement then shows `dataChange` reruns of `hr/review:queue` are material, segment the query: one subscription per ISO week (or per day for the current week), with stable arguments and no `Date.now` (use an `asOf` boundary argument, as in K4). A write to today's document then re-runs only the current segment; past segments stay cached. The client merges segments and enforces `MAX_QUEUE_ITEMS`/`complete` across them.

**Tradeoffs**

- More initial subscriptions and argument identities can add call overhead; compare actual call and I/O rates rather than treating one unit as inherently cheaper.
- Live queries on the same Convex React client update to a consistent database snapshot. Segmentation itself does not introduce a cross-snapshot window. Merging must handle initial loading, missing segments and global limits; imperative/preloaded snapshots would need separate treatment. [Realtime consistency](https://docs.convex.dev/realtime)
- A segment's past-day evaluation must not depend on wall-clock time, or caching fails anyway.
- Do not materialize an exception table (rejected on Oct 10).

**Verify**

Measure `run_reason = "dataChange"` counts and `database_io_read_bytes` for `hr/review:queue` with log streams ([schema](https://docs.convex.dev/production/integrations/log-streams)), or locally count reads per rerun with 99 employees × 14/31 days while simulating 20 clock events. Golden-test that merged segments equal the single-query output.

### K6. Clerk webhook watermarks patch the documents every tenant query reads (P2 · high mechanism confidence · webhook frequency unknown · R/C)

**New finding.**

**Evidence**

- Every applied organization, user or membership event patches the mirror document with new `clerkLastEventId/At/Timestamp` watermarks, even when name, status and locale are unchanged:
  - `identityWebhook.ts:275–283` builds the watermark;
  - `:315, :324, :356, :388, :427` call the puts;
  - `identityMirrorConvex.ts:130, 179, 257` perform the patches.
- Every tenant function reads these documents:
  - `users` via `tenantContextLookups.ts:37–48`;
  - `organizations` via `:50–64`;
  - `memberships` via `:66–108`, and again via `authorization.ts:273`.

**Why cost rises**

- A `user.updated` patch can invalidate live queries whose dependency set includes that user document.
- An `organization.updated` patch can invalidate member queries reading the organization mirror, including the audited workspace/catalogue/HR paths.
- Dependency changes can cause reevaluation; executed queries, shared cache reuse, delivered result updates and billable calls must be measured separately.

This is the "frequent cache invalidation → data segmentation" pattern ([Queries that scale](https://stack.convex.dev/queries-that-scale)). How often Clerk delivers these events for this tenant is **not known**. Sign-in-related profile updates would make it frequent, while admin-only edits would make it rare.

**Remedy**

1. **Measure first:** compare the `lib/identityMirrorConvex:applyClerkIdentityEvent` call count in the same dashboard window with Clerk/Svix delivery counts per event type.
2. If it is material, skip the patch when the mirrored business fields are unchanged, and move the watermarks to a small `identityWatermarks` table keyed by external ID. Queries never read that table, so ordering and replay checks stay transactional in the webhook mutation without invalidating tenant queries. During migration, read the legacy fields as a fallback.

**Tradeoffs:** ordering, replay and deletion semantics must be preserved exactly, including deletions below a legacy floor (`identityWebhook.ts:286–302`). Advance watermarks even for business-field no-ops; read/update both tables atomically, preserve tombstones and embedded provisioning, and ensure legacy deployed writers cannot bypass the new authoritative watermark source. This is justified only if event-frequency measurements show useful savings.

**Verify:** an identity-mirror integration test asserting that a no-op `user.updated` leaves the `users` document untouched. In a dev deployment, subscribe to `readCurrent`, deliver a no-op event, and count reruns.

### K7. Authorization repeats membership and role reads with serial awaits (P2 · high code confidence · latency/bytes unmeasured)

**Previously reported** as Oct 10 backend F6 and Codex subscriptions #3. Here it is consolidated with the HR call sites.

**Evidence**

- Tenant context resolves membership with 2–3 index ranges (`tenantContextLookups.ts:66–108`). `resolveAuthorizationFacts` resolves it again (`authorization.ts:273`), then lists roles and makes serial role/permission point reads (`:286–322`).
- Inside the same execution, `grantedPermissionsAmong` (`navigationGrants.ts:21–58`) re-reads `membershipRoles`, re-`get`s each role serially, and loops over codes × roles with serial `unique()` reads. Call sites:
  - `readCurrent` (3 codes);
  - `hr/access.current` (5 codes);
  - every `holds()` and `reviewScope()` call (`hr/shared.ts:77–89, 192–200`), which run in `review.queue`, `review.dayDetail`, the decision mutations and search.

**Why cost rises**

- **L:** the code has serial dependent reads before and inside handlers. Exact round trips and latency depend on the granted-role path and runtime behavior; 8–15 is not a measured universal count.
- **R:** whether Convex bills repeated reads of the same document inside one transaction is not documented in the pages I checked, so I make no byte claim.

**Remedy**

- Return the resolved active role IDs (and the membership/scope documents) from `authorizeTenantRequest`, and memoize permission checks per execution on `TenantFunctionContext`.
- `grantedPermissionsAmong` then issues the code × role point reads in parallel, with no repeated `membershipRoles` or role reads.
- Keep every integrity check from `resolveAuthorizationFacts`.

**Tradeoffs and security:** this is the security-critical path. Parallel role reads add non-granting roles' permission rows to the read set (rare extra invalidation on role edits). Revocation stays reactive because the same documents are still read.

**Verify:** count read calls per execution for `readCurrent` and `review.queue`, and record the p50 execution time on the dashboard before and after. Re-run the authorization-enforcement, tenant-context, query-cache and isolation suites.

### K8. Latest-only correction lookups read up to 21 full correction documents; the holiday calendar issues 366 point reads (P3 · high code confidence · R/L, bounded)

**Corrections were reported on Oct 10 (HR #7).** The holiday calendar and the size bound are new.

**Corrections**

- `dayCorrections` takes `MAX_DAY_CORRECTIONS + 1 = 21` correction documents in `desc` order (`dayDetail.ts:33–57`).
- `self.today → recentCorrections` (`self.ts:214–240`, up to 14 days) and `self.history` (`self.ts:580`, up to 31 days) use only `items[0]`.
- Each correction carries `history` with up to 200 entries (`self.ts:59`). Reasons can be up to 500 characters (`model/hr/employee.ts:13`), which is up to about 1.5 KB of UTF-8 Thai each.
- **Worst case:** about 21 large documents per day, which in an adversarial case can approach the 16 MiB per-transaction read limit ([limits](https://docs.convex.dev/production/state/limits)). The realistic case is 1–2 small documents per day.
- **Remedy:** add a `latestCorrection(day)` helper that uses `take(1, "desc")` plus the existing pending fallback. It is equivalent because a submission or resubmission sets `submittedAt` to now (`self.ts:779` and the resubmission patch above it), so the newest `submittedAt` is either the pending one or index-first. Keep the 21-document variant for day-detail screens that list history.

**Holiday calendar**

- `self.holidays` (`self.ts:243–290`) runs one `unique()` per calendar date in parallel: 366 index ranges in the read set.
- With the range API, one range read over `[year-01-01, year-12-31]` gives the same exact bound with one range.
- This is a latency and overhead improvement only. The documents read are identical.

**Verify:** golden tests comparing old and new `recentCorrections` output over seeds with resubmitted, returned and pending corrections.

### K9. Append-only histories are embedded in frequently read documents (P3 · medium · R, scale-dependent)

**New finding.**

**Evidence**

- `hrAttendanceDays.certificationHistory` (`schema.ts:178–191`, capped at 50 by `review.ts:238`) is read by:
  - `loadSiteDays` (queue, draft preview, period close);
  - `dayOf` (Today, History, decisions);
  - `history`.
- Only `buildDayDetail` displays it.
- `hrCorrectionRequests.history` (`schema.ts:250–262`, capped at 200) is read by every `dayCorrections` call.

**Why cost rises:** every queue or preview rerun (K5) reads the full history arrays of every day document in range, although only certification-current fields are used. "Trimmed response ≠ trimmed reads" applies here.

**Bound:** at most about 50 × (entry + 500-character reason) per day document, and 200 × the same per correction. That is below the 1 MiB document limit, but it multiplies across 31 × 198 day documents in K5's worst case.

**Remedy (only if `getConvexSize` measurements show material sizes):** move both histories into child tables (`hrCertificationHistory` by `dayId`, `hrCorrectionEvents` by `correctionId`) and keep a count field. This needs a migration with backfill, and history reads change to an indexed child read in detail views.

**Verify:** compute the `getConvexSize` distribution of these two tables on a staging copy ([values API](https://docs.convex.dev/api/modules/values)).

### K10. No application Convex cleanup jobs are defined; expiry fields are not swept (P3 · high code confidence · storage, currently small)

**New finding.**

**Evidence**

- There is no `convex/crons.ts`, and no `ctx.scheduler` call anywhere (grep).
- `IDEMPOTENCY_RETENTION_MS` is 30 days and `expiresAt` is written (`idempotency.ts:9, 121`) and indexed (`schema.ts:630`). However, `checkIdempotency` ignores `expiresAt` (`idempotency.ts:66–91`), and nothing deletes expired rows.
- `auditEvents` has no retention policy.
- The `supportGrants` comment mentions an "expiry sweep" (`schema.ts:698`), but none exists, and no writer for that table exists either.
- `actionQuotas` is bounded: one row per actor and key, reset in place (`actionQuota.ts`). Good.

**Effect**

- No application-defined Convex cron/scheduler loop was found. This does **not** establish that all usage is interactive: `.github/workflows/production-backup.yml` defines daily exports, and external scripts, dashboards and integrations can call the backend. The parent report covers backup usage; source alone does not show which schedules executed.
- **Negative:** idempotency rows and audit rows grow forever, each with 3–6 index copies. At 12.21 MB of storage this is not a cost driver today.

**Conditional remedy:** first define replay/retention semantics. If expiration should end idempotency protection, a daily internal cleanup job can use `by_orgId_expiresAt`, bounded organization pagination and a total transaction budget for deletes, with resumable continuation. Bounding N per organization alone does not bound a run across all organizations. Only schedule internal functions ([cron jobs](https://docs.convex.dev/scheduling/cron-jobs)). Keep audit retention a separate explicit policy; do not prune audit rows just to reduce this small current storage figure.

**Tradeoffs:** deleting a record changes today's perpetual replay behavior: an older retry may execute the business action again. The 30-day expiry field suggests an intention but does not itself prove the accepted replay contract. A daily root job adds about 30 scheduled invocations per month, plus all organization/chunk continuation calls and deletion I/O.

### K11. Actions follow Convex guidance, with two small gaps (P3 · high · C/W, provider spend)

**New finding.**

**Evidence**

- `actionWithOrg` makes exactly one `ctx.runMutation` to an **internal** preflight (`tenantFunctions.ts:655–690`, `542–618`). There is no `runAction` and no sequential `runQuery` chain. Images and query text are not passed to the mutation. This matches [best practices](https://docs.convex.dev/understanding/best-practices/#avoid-sequential-ctxrunmutation--ctxrunquery-calls-from-actions).
- Each invocation costs an action execution plus a mutation execution. The mutation writes an authorization audit row, plus a quota patch for `hr/navigationIntent:interpret` (`:611`).

**Gaps**

1. The audit row is written as ALLOWED _before_ quota consumption. A RATE_LIMITED refusal therefore leaves an ALLOWED audit row (`tenantFunctions.ts:595–617`). If audit fidelity matters, record quota outcomes in the row.
2. `extractJobTicket` (`jobScans.ts:149`) and `extractLocationLabel` (`locationImage.ts:13`) declare no `rateLimit`. Convex action compute is negligible (0.0031 GB-h), but each call can spend paid provider tokens and hold an action slot (64 concurrent on S16) for the provider timeout. Consider the same persisted quota mechanism already used for AI Search.

## Cross-check: workspace and storage (covered in depth elsewhere)

**`workspace/current:readCurrent` (34K calls)**

- **Read set per execution:**
  - the context chain: `users`, `organizations`, 2–3 `memberships` ranges;
  - the authorization chain: membership again, `membershipRoles` (up to 32), roles and the permission point;
  - `grantedPermissionsAmong` with 3 codes (K7);
  - `warehouses` ACTIVE range (≤100), or scope rows plus warehouse gets.
- **No handler/ordinary authorization clock dependency** for already-effective non-expiring memberships; future/expiring memberships or other time-sensitive authorization paths retain it (`tenantFunctions.ts:326–333`).
- **Plausible rerun sources:**
  - initial subscriptions (reloads, tabs, reconnects);
  - `identityChange` reruns — an official `run_reason` in the [log schema](https://docs.convex.dev/production/integrations/log-streams), and Convex states that time-varying identity claims "would bust the query cache" ([auth](https://docs.convex.dev/auth/functions-auth));
  - `dataChange` from K6's webhook patches or role/scope edits.
- The split between these is **unmeasured**. Classify it by `run_reason` before changing the subscription's lifetime, and do not move or unmount it first (see `codex-subscriptions.md` #3).

**`storageLayouts/catalogue:buildingStatusControl` (40K calls)**

- **Read set:**
  - the authorization chain;
  - the building document;
  - at most two `.first()` placement ranges (`catalogue.ts:32–52, 650–670`).
- It does **not** read the readiness document, so `generation` bumps do not invalidate it.
- Calls scale with distinct building rows × (initial subscriptions + building-document version bumps + placement status changes in empty or leading ranges + auth invalidations).
- The merge remedy is in `codex-subscriptions.md` #1 and `codex-queries.md` #3. I agree with it and add nothing.

**Readiness `generation`, write side**

`trackFinishedGoodsWrites.flush` (`finishedGoodsSummary.ts:278–297`) patches one document per touched warehouse on every finished-goods or storage mutation. Beyond the read-side invalidation covered by Codex #1, this also makes all such mutations in a warehouse conflict on one document. Check `npx convex insights --prod` for OCC on `finishedGoodsSummaryReadiness` before and after any change ([insights](https://docs.convex.dev/cli/reference/insights)). HR mutations touch none of the tracked tables, so `note` adds no reads for them. Good.

## Positive patterns to keep

- Ordinary queries avoid the wall clock through the membership creation-time bound and use random query IDs (`tenantFunctions.ts:318–333, 455`).
- Query paths skip device and target audit lookups (`tenantFunctions.ts:344–360`).
- All tenant reads are index-prefixed with hard bounds:
  - `take(2)` exactness checks;
  - `TENANT_INDEX_MAX_PAGE_SIZE` of 100;
  - `all()` throws instead of truncating (`tenantStorage.ts:311–339`);
  - native pagination caps `maximumRowsRead: 101` and `maximumBytesRead: 512 KiB` (`tenantStorage.ts:261–267`).
- No `.collect()` or `.filter(q => …)` appears outside `convex/staging` demo seeders (grep).
- HR writes are idempotent with verified replay hashes. Refusals are returned rather than thrown, so DENIED rows persist.
- `period.close` writes at most 1,550 frozen rows in one atomic mutation. This row count is below the document-write limit; it does not alone prove the 16 MiB byte limit because row sizes and other writes matter. Closed-data caching improvements still need the header/auth qualifications in K4.
- No application-defined Convex cron/scheduler loop was found; external operational traffic remains possible and daily backup automation exists.
- `actionQuotas` is a bounded single row per actor and key.
- Actions make a single internal mutation call.

## False positives and limits

- **Identical subscriptions are deduplicated** within one client: same function and serialized arguments, reference-counted (`codex-subscriptions.md`). Location rows of one building share one `statusControl` subscription. Multiplying rows by executions is wrong.
- **Trimmed responses are not trimmed database reads.** `buildingStatusControl` returns three fields but reads the building document and the authorization chain. Conversely, shrinking `periods.preview`'s payload (Oct 10 #8b) reduces egress, not R.
- **Total call count does not identify the biggest cost.** A frequently called query that hits the cache reads nothing. Rank by per-function database I/O, not by calls.
- **The `readOwned` get before every tenant patch** (`tenantDb.ts:372–397`) is a tenant-isolation check. Whether the patch's own internal read is billed separately is undocumented, so I do not claim double billing.
- **Parallelizing reads** (`Promise.all`) improves latency (L) but does not cut R.
- **Incidental correctness issue, outside cost scope.** `memberDirectory.get` uses `.unique()` on `memberships.by_orgId_userId` (`memberDirectory.ts:54–64`). After a re-add, which creates a second membership row by design (`tenantContextLookups.ts:66–71`), it would throw, and HR name lookups for that user would fail as INTERNAL_ERROR. No test covers `createMemberDirectory` (grep). Fix it with the same status-bucket lookup that tenant context uses.

## Top 5 sequence

1. **K3: bounded period-lock lookup** (`take(8, "desc")` with exact fallback and verified non-overlap). This fast path is available today; the list proposal needs adapter/pagination work because `take(201)` is invalid. Measure its hit rate before projecting savings.
2. **K4: remove unnecessary handler clock dependencies** from the name-only path and stable access/closed-data endpoints. Separate `today` display fields deliberately, preserve timezone and midnight behavior, and retain time-sensitive authorization. Measure the cache-hit improvement.
3. **K8 + K2: focused read fixes.** A latest-correction helper and action-qualified history lookup can remove overfetch. History still needs residual empty-change handling and correct continuation/completeness.
4. **Range-read API (Oct 10 HR #3), then K5 segmentation** only if `dataChange` reruns of queue/preview are material. Do K7's per-execution authorization memo alongside, since both touch the shared tenant layer and need the same security review.
5. **K1 / K10 / K6 decisions:** evaluate unused audit indexes, audit semantics and replay retention separately. Add cleanup or split identity watermarks only when policy and measured workload justify them; preserve reactive revocation and event ordering.

## Measurement plan

1. **Attribute before changing anything.** In the dashboard Usage view, export the **Database I/O by function** breakdown (not Function Calls) for the same window, separated by deployment. Record per-function cache hit rate and p50/p95 execution time ([function dashboard](https://docs.convex.dev/dashboard/deployments/functions)). If Pro log streams are available, sum `database_io_read_bytes + database_io_write_bytes` per function and per `run_reason` (`initialSubscription`, `dataChange`, `identityChange`), and record `occ_info` ([schema](https://docs.convex.dev/production/integrations/log-streams)).
2. **Explain the call leaders.** For `readCurrent` and `buildingStatusControl`, split calls by `run_reason`. Correlate with:
   - `applyClerkIdentityEvent` call counts and Clerk/Svix delivery counts per event type (K6);
   - deployments and reconnect spikes.
3. **Check contention:** run `npx convex insights --prod` for OCC on `finishedGoodsSummaryReadiness`, `hrPeriods` and `hrAttendanceDays` ([insights](https://docs.convex.dev/cli/reference/insights)).
4. **Local regression guards.** Extend `tests/fixtures/document-reads.ts` beyond `get` to count index ranges, documents returned, inserts, patches and `getConvexSize` bytes. Assert per-operation budgets for:
   - clockIn with 0, 52 and 260 periods (K3);
   - the separated closed-data endpoint with zero `Date.now` calls under ordinary time-independent authorization; verify the separate `today` header behavior (K4);
   - `recentCorrections` (K8);
   - `employeeHistory` completeness (K2);
   - writes per mutation (K1);
   - queue rerun reads for 99 employees × 14/31 days (K5).

   Fixture bytes are regression guards, not invoice estimates.

5. **Compare equivalent workloads after each step:** absolute and per-operation I/O, cache hit rate, calls and latency. Report no savings percentage until steps 1–2 attribute the current I/O.

## Sources

- [Best practices](https://docs.convex.dev/understanding/best-practices/): `Date.now` in queries, internal scheduling, actions and `runMutation`, `.collect`, redundant indexes.
- [Limits](https://docs.convex.dev/production/state/limits): function calls including subscription updates, database I/O definition, index storage, transaction limits, S16 concurrency.
- [Log stream schema](https://docs.convex.dev/production/integrations/log-streams): `database_io_*`, `run_reason`, `cached`, `occ_info`.
- [Auth in functions](https://docs.convex.dev/auth/functions-auth): time-varying claims and query caching.
- [Runtimes](https://docs.convex.dev/functions/runtimes): seeded randomness, `Date.now` frozen at function start.
- [Indexes](https://docs.convex.dev/database/reading-data/indexes/): range expressions on the next index field.
- [OCC](https://docs.convex.dev/database/advanced/occ), [cron jobs](https://docs.convex.dev/scheduling/cron-jobs), [insights CLI](https://docs.convex.dev/cli/reference/insights), [values API (`getConvexSize`)](https://docs.convex.dev/api/modules/values).
- [Queries that scale (Convex Stack)](https://stack.convex.dev/queries-that-scale): index insert cost; data segmentation for frequent invalidation.
