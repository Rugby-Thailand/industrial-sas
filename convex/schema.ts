/**
 * Convex schema — tenant, identity, authorization, audit, idempotency, device,
 * entitlement, (disabled) support-grant, and inventory-ledger foundation.
 *
 * Status: **the tenant security foundation plus the immutable inventory ledger.**
 * The tenancy, identity, and authorization tables are declarations that
 * `convex/lib/**` now enforces at run time: a public function cannot be registered
 * without a code-owned permission, and no handler runs before that permission is
 * decided (`ADR-0006`). The inventory tables below are live too —
 * `convex/inventory/ledger.ts` posts against them through
 * `convex/lib/inventoryLedgerStore.ts`, balances are projected in the same
 * mutation, and `scripts/verify-tenant-boundary.mjs` fails the build if any other
 * production file rewrites a ledger row or writes a balance.
 *
 * What is still only a shape: master data beyond the minimum the ledger must
 * validate against, every inbound aggregate (§7.3), and deployment — there is no
 * `convex/_generated/`, no environment configuration, and nothing has run against a
 * Convex backend.
 *
 * Structure, in four groups:
 *
 * 1. **Root and global tables** — `organizations`, `users`, `permissions`. These
 *    have no `orgId`. `organizations` *is* the tenant root: its document ID is
 *    the `orgId` every other table carries. `users` is a global Clerk identity
 *    reference because one person may work for several tenants (C-02). The
 *    `permissions` catalogue is code-owned reference data, identical for every
 *    tenant (`INV-0006-02`). The allowlist is exactly these three, declared in
 *    `convex/lib/schemaPolicy.ts` and asserted by test.
 * 2. **Tenant tables** — everything else. Each is declared with `tenantFields`
 *    so it carries `orgId`, and every index is declared with `byOrg` so it
 *    begins with `orgId` (D-18, `INV-0002-02`).
 * 3. **Uniqueness and lookup contracts** — every external reference
 *    (`clerkOrganizationId`, `clerkUserId`, `clerkMembershipId`, permission
 *    `code`, warehouse `code`, role `key`, idempotency `requestId`, ledger
 *    `bucketKey`, …) has an index that makes its lookup bounded. Convex has no
 *    unique constraint, so nothing below is enforced by the database: every
 *    "unique" in this file means **unique by contract** — a bounded index plus the
 *    check the mutation owes on every write. The contracts are enumerated in
 *    `schemaPolicy.ts`, and a bounded index does not by itself imply uniqueness:
 *    some contracts are conditional (`devices.installationId` is unique per
 *    organization *when present*) and some indexed keys are deliberately
 *    many-per-key (`supportGrants.ticketRef`). Which is which is stated there as
 *    data, never left to inference from the index name.
 * 4. **Append-only tables** — `auditEvents`, `inventoryTransactions`, and
 *    `inventoryLedgerLines` are inserted and never rewritten (`INV-0003-07`,
 *    `INV-0003-12`, plan §12). `inventoryBalances` is writable, but from exactly
 *    one module. Both properties are static build gates, because Convex cannot
 *    express either.
 *
 * Deliberately absent, and why:
 *
 * - **No credential material.** No password, MFA secret, session token, API key,
 *   or recovery code appears in any table. Clerk owns all of it (`INV-0001-06`,
 *   C-03). `sessionsAudit.clerkSessionId` is an opaque reference used to correlate
 *   events; it is not a bearer token and cannot authenticate anything.
 * - **No arrays for warehouse scope.** A membership's warehouses are rows in
 *   `membershipWarehouses`, and its roles are rows in `membershipRoles`. An
 *   array would grow unbounded inside one document, make "who may act in this
 *   warehouse" a table scan, and turn two concurrent scope edits into a lost
 *   update.
 * - **No approval-policy table.** Threshold and maker-checker *values* are
 *   configured through `admin.settings.policy.manage`, but nothing yet evaluates a
 *   stored policy, so a table here would be invented domain with no reader. It
 *   arrives with `RG-030`.
 * - **No aggregate or counter document anywhere.** `inventoryBalances` is one row
 *   per bucket and nothing sums across buckets in this schema. A global counter is
 *   the hot-document contention failure plan §13 names; rollups come from the
 *   Aggregate component (`ADR-0011`).
 * - **No master data beyond what a posting must validate.** `items`, `locations`,
 *   `lots`, `handlingUnits`, `owners`, and `reasonCodes` carry identity, the
 *   ownership edges `INV-0003-04`/`INV-0003-05` are checked through, and nothing
 *   else. Location hierarchy, capacity, storage classes, barcodes, alternate UOMs,
 *   LPN history, and QC/putaway policy are the master-data slice.
 *
 * Baseline: [PROJECT_PLAN.md](../PROJECT_PLAN.md) §7.1, §7.2, §7.4, §7.5, §6.1,
 * §6.2; [ADR-0001](../docs/adr/0001-multi-tenant-saas-and-identity-ownership.md),
 * [ADR-0002](../docs/adr/0002-convex-tenant-boundary-and-index-discipline.md),
 * [ADR-0003](../docs/adr/0003-append-only-inventory-ledger.md),
 * [ADR-0004](../docs/adr/0004-exact-quantities-and-uom.md),
 * [ADR-0005](../docs/adr/0005-warehouse-location-and-stock-identity.md),
 * [ADR-0006](../docs/adr/0006-authorization-and-support-access.md),
 * [permission catalogue](../docs/permissions.md).
 */
import { defineSchema, defineTable } from "convex/server";
import type { DataModelFromSchemaDefinition } from "convex/server";
import { v } from "convex/values";

import { byOrg, tenantFields } from "./lib/tenantTable";
import {
  actorKind,
  auditOutcome,
  barcodeKind,
  boxSpecification,
  customerOrderLineStatus,
  customerOrderStatus,
  denialReason,
  designRequestPriority,
  designRequestStatus,
  designSource,
  deviceStatus,
  deviceType,
  factoryPacketStatus,
  idempotencyStatus,
  importBatchStatus,
  inspectionStatus,
  inventoryTransactionSource,
  inventoryTransactionType,
  itemTrackingMode,
  ledgerLocationKind,
  locale,
  labelTemplateFormat,
  labelTemplateStatus,
  locationType,
  masterCardFileKind,
  masterCardFileStorageState,
  masterCardRevisionStatus,
  masterDataStatus,
  membershipScopeMode,
  membershipStatus,
  organizationSettings,
  organizationStatus,
  permissionScope,
  printJobStatus,
  printReason,
  purchaseOrderLineStatus,
  purchaseOrderStatus,
  putawayTaskStatus,
  reportJobStatus,
  reportKind,
  rollupMetric,
  qcDisposition,
  reasonCodeScope,
  receiptClassification,
  receiptLineKind,
  receivingExceptionStatus,
  roleStatus,
  samplingStrategy,
  sessionsAuditEventType,
  signedQuantity,
  stockStatus,
  storageLayoutStatus,
  supportAccessMode,
  supportGrantStatus,
  userStatus,
  virtualBoundaryCode,
  warehouseStatus,
} from "./lib/validators";

const schema = defineSchema({
  /* ------------------------------------------------------------------------ */
  /* Root and global tables (no `orgId`)                                       */
  /* ------------------------------------------------------------------------ */

  /**
   * A customer tenant (`G-001`). One Clerk organization is exactly one row
   * (`INV-0001-05`); the mapping is unique in both directions by contract, to be
   * checked through `by_clerkOrganizationId` by the provisioning mutation that
   * does not exist yet.
   */
  organizations: defineTable({
    /** Clerk organization ID: the external correlation key. Unique by contract. */
    clerkOrganizationId: v.string(),
    /** Display name, mirrored from Clerk. Unicode; may be Thai. */
    name: v.string(),
    status: organizationStatus,
    /** Last normalized Clerk event applied; payloads are never stored. */
    clerkLastEventId: v.optional(v.string()),
    /** Millisecond watermark; equal or older deliveries cannot regress state. */
    clerkLastEventAt: v.optional(v.number()),
    /** WMS configuration. Defaults in `convex/lib/organizationDefaults.ts`. */
    settings: organizationSettings,
  })
    // The only supported way to resolve a tenant from a webhook or token claim.
    // Without this index, provisioning replay would scan every tenant (§5 Q2).
    .index("by_clerkOrganizationId", ["clerkOrganizationId"])
    .index("by_status", ["status"]),

  /**
   * A person (`G-003`), owned by Clerk. Global rather than tenant-scoped because
   * one person may hold memberships in several organizations (C-02); the
   * membership rows, not this row, carry tenancy.
   *
   * Holds no credentials and no contact detail: Clerk owns identity, and mirrored
   * PII the WMS never reads is only a PDPA liability (§14).
   */
  users: defineTable({
    /** Clerk user ID: the external correlation key. Unique by contract. */
    clerkUserId: v.string(),
    /** Display name for attribution in audit and task lists. */
    displayName: v.string(),
    status: userStatus,
    /** Last normalized Clerk event applied; payloads are never stored. */
    clerkLastEventId: v.optional(v.string()),
    /** Millisecond watermark; equal or older deliveries cannot regress state. */
    clerkLastEventAt: v.optional(v.number()),
    /** Preferred interface locale; absent means the organization default (D-06). */
    preferredLocale: v.optional(locale),
  })
    // Resolving the actor from a verified Clerk token happens on every request,
    // so it must be a single indexed lookup.
    .index("by_clerkUserId", ["clerkUserId"]),

  /**
   * The code-owned permission catalogue
   * ([catalogue](../docs/permissions.md) §2).
   *
   * Global, not tenant data: a tenant composes roles from these codes and cannot
   * invent one (`INV-0006-02`). Rows are seeded from the repository — seeding is
   * not part of this task — so this table is reference data, not user data.
   */
  permissions: defineTable({
    /** Stable `domain.subject.action` code. Unique by contract; renaming one is a migration (D-22). */
    code: v.string(),
    scope: permissionScope,
    /** Requires fresh Clerk reverification (`INV-0006-07`). */
    requiresStepUp: v.boolean(),
    /** Submit and approve must be different actors (`INV-0006-05`). */
    requiresMakerChecker: v.boolean(),
    /** A numeric threshold policy participates in the decision (`INV-0006-06`). */
    requiresThreshold: v.boolean(),
  })
    // Permission checks resolve by code, never by document ID, because the code
    // is the stable identifier that functions, tests, and audit rows cite.
    .index("by_code", ["code"])
    .index("by_scope_code", ["scope", "code"]),

  /* ------------------------------------------------------------------------ */
  /* Tenant tables (`orgId` first, always)                                     */
  /* ------------------------------------------------------------------------ */

  /**
   * A physical site (`G-020`), reduced to identity and status.
   *
   * Present in this task only because warehouse scope is an input to every
   * authorization decision (`INV-0006-04`) and `membershipWarehouses` needs
   * something to reference. Location hierarchy, capacity, and storage classes
   * belong to `ADR-0005` work.
   */
  warehouses: defineTable(
    tenantFields({
      /** Tenant's human identifier, normalized. Unique per organization by contract (§5 Q4). */
      code: v.string(),
      name: v.string(),
      status: warehouseStatus,
    }),
  )
    .index("by_orgId_code", byOrg("code"))
    .index("by_orgId_status_code", byOrg("status", "code")),

  /**
   * A user's participation in an organization (`G-004`), mirrored from Clerk and
   * never trusted from the client (`ADR-0001` §4).
   *
   * The mirror exists so revocation is observable inside the same transaction as
   * the operation it must block (`INV-0001-03`): a request rechecks an active
   * membership locally instead of calling Clerk.
   *
   * Roles and warehouse scope are normalized into `membershipRoles` and
   * `membershipWarehouses`; this row holds only the membership itself.
   */
  memberships: defineTable(
    tenantFields({
      userId: v.id("users"),
      /** Clerk organization-membership ID. Unique per organization by contract. */
      clerkMembershipId: v.string(),
      status: membershipStatus,
      /** Last normalized Clerk event applied; payloads are never stored. */
      clerkLastEventId: v.optional(v.string()),
      /** Millisecond watermark; equal or older deliveries cannot regress state. */
      clerkLastEventAt: v.optional(v.number()),
      scopeMode: membershipScopeMode,
      /** Effective period. `effectiveTo` absent means open-ended. */
      effectiveFrom: v.number(),
      effectiveTo: v.optional(v.number()),
    }),
  )
    // Actor resolution: given the active organization and the mirrored user,
    // find the membership. Bounded, and the pair is unique by contract.
    .index("by_orgId_userId", byOrg("userId"))
    // Idempotent webhook application resolves the organization from the payload
    // first, then the membership within it (`INV-0001-04`).
    .index("by_orgId_clerkMembershipId", byOrg("clerkMembershipId"))
    .index("by_orgId_status_userId", byOrg("status", "userId")),

  /**
   * A role held by a membership. Normalized rows rather than an array on the
   * membership, so granting a role is an insert and revoking one is a delete —
   * neither rewrites a document two concurrent admins might be editing.
   */
  membershipRoles: defineTable(
    tenantFields({
      membershipId: v.id("memberships"),
      roleId: v.id("roles"),
      grantedAt: v.number(),
      /** The user who granted it, for audit attribution (`INV-0006-10`). */
      grantedByUserId: v.optional(v.id("users")),
    }),
  )
    // Prefix-serves "roles of this membership" and exact-serves the uniqueness
    // check for the triple.
    .index("by_orgId_membershipId_roleId", byOrg("membershipId", "roleId"))
    // "Which memberships hold this role" — needed before a role is archived.
    .index("by_orgId_roleId", byOrg("roleId")),

  /**
   * A warehouse a membership may act in (`G-007`).
   *
   * Rows, not an array: the set is unbounded in principle, both directions of the
   * question are asked ("this membership's warehouses" and "who may act here"),
   * and an empty set must deny rather than mean "all" — which is why
   * `memberships.scopeMode` states the intent explicitly.
   */
  membershipWarehouses: defineTable(
    tenantFields({
      membershipId: v.id("memberships"),
      warehouseId: v.id("warehouses"),
    }),
  )
    .index(
      "by_orgId_membershipId_warehouseId",
      byOrg("membershipId", "warehouseId"),
    )
    .index("by_orgId_warehouseId", byOrg("warehouseId")),

  /**
   * A tenant-editable named composition of permissions (`G-005`).
   *
   * Seeded roles are created idempotently and remain editable without a code
   * change (`INV-0006-11`); `seeded` records provenance so a seed re-run can
   * recognize its own rows without overwriting tenant edits.
   */
  roles: defineTable(
    tenantFields({
      /** Stable role key, e.g. `ORG_ADMIN`. Unique per organization by contract. */
      key: v.string(),
      /** Tenant-visible name; may be Thai. */
      name: v.string(),
      description: v.optional(v.string()),
      status: roleStatus,
      seeded: v.boolean(),
    }),
  )
    .index("by_orgId_key", byOrg("key"))
    .index("by_orgId_status_key", byOrg("status", "key")),

  /**
   * A permission code granted to a role.
   *
   * Stores the catalogue `code`, not a document ID of `permissions`: the code is
   * the stable identifier that functions and audit rows cite, and a composition
   * should survive a reseed of the catalogue. The trade is that referential
   * integrity is a code obligation — validated against the catalogue on write.
   */
  rolePermissions: defineTable(
    tenantFields({
      roleId: v.id("roles"),
      permissionCode: v.string(),
    }),
  )
    .index("by_orgId_roleId_permissionCode", byOrg("roleId", "permissionCode"))
    // "Who can do X in this tenant" — an administration and audit question.
    .index("by_orgId_permissionCode", byOrg("permissionCode")),

  /**
   * A server-enforced plan capability limit (`G-011`, D-30).
   *
   * Distinct from a permission: an entitlement is what the tenant bought, a
   * permission is who may act. Enforced in Convex even while billing is manual,
   * so enabling billing later adds no new enforcement point (`INV-0001-07`).
   *
   * `enabled` defaults closed by convention: an absent row is a disabled
   * capability, so a tenant cannot gain a capability by a missing seed.
   */
  entitlements: defineTable(
    tenantFields({
      /** Code-owned entitlement key. Unique per organization by contract. */
      key: v.string(),
      enabled: v.boolean(),
      /** Optional numeric ceiling; absent means "no limit beyond `enabled`". */
      limit: v.optional(v.number()),
      /** Free-text provenance, e.g. the pilot agreement this came from. */
      note: v.optional(v.string()),
    }),
  ).index("by_orgId_key", byOrg("key")),

  /**
   * Append-only audit event (§5 Q37, `INV-0002-06`, `INV-0006-10`).
   *
   * Written in the same mutation as the change it describes, and never updated
   * or deleted by application code. Denials are audited as well as successes,
   * with the reason distinguished, because "why was I refused" is an operator
   * question with an expensive support cost when unanswerable.
   *
   * Carries request, actor, device, and support-grant context. It carries no
   * credential material: `requestId` is a client-generated correlation ID, and
   * there is no session token, header dump, or raw payload field.
   *
   * Target references are flat (`entityTable`, `entityId`) rather than nested, so
   * an entity history query is a plain index range.
   */
  auditEvents: defineTable(
    tenantFields({
      occurredAt: v.number(),
      actorKind,
      /** Absent for `SYSTEM` and platform actors, who have no mirrored user row. */
      actorUserId: v.optional(v.id("users")),
      /** Attribution for a platform actor acting under a support grant. */
      actorPlatformRef: v.optional(v.string()),
      /** Operation name, e.g. `admin.membership.update`. */
      action: v.string(),
      /** Permission code the operation declared, when it declared one. */
      permissionCode: v.optional(v.string()),
      /** Target table name; a string, because targets span every table. */
      entityTable: v.string(),
      /** Target document ID as a string; absent for create attempts. */
      entityId: v.optional(v.string()),
      /** Warehouse the decision was scoped to, when the operation is warehouse-bound. */
      warehouseId: v.optional(v.id("warehouses")),
      outcome: auditOutcome,
      /** Required in practice when `outcome` is `DENIED`; the value set is closed. */
      denialReason: v.optional(denialReason),
      /** Client-generated correlation ID shared with logs and idempotency records. */
      requestId: v.string(),
      deviceId: v.optional(v.id("devices")),
      /** Set when the event happened under a support grant, making it tenant-visible. */
      supportGrantId: v.optional(v.id("supportGrants")),
      /** Changed-field diff. Field names plus before/after as display strings. */
      changes: v.optional(
        v.array(
          v.object({
            field: v.string(),
            from: v.optional(v.string()),
            to: v.optional(v.string()),
          }),
        ),
      ),
    }),
  )
    .index("by_orgId_occurredAt", byOrg("occurredAt"))
    .index(
      "by_orgId_entityTable_entityId_occurredAt",
      byOrg("entityTable", "entityId", "occurredAt"),
    )
    .index(
      "by_orgId_actorUserId_occurredAt",
      byOrg("actorUserId", "occurredAt"),
    )
    .index("by_orgId_requestId", byOrg("requestId"))
    // The tenant's own view of support access under an enabled grant
    // (`INV-0006-09`).
    .index(
      "by_orgId_supportGrantId_occurredAt",
      byOrg("supportGrantId", "occurredAt"),
    ),

  /**
   * Idempotency record for a client-initiated operation (§5 Q30, Q35).
   *
   * The key is `(orgId, operation, requestId)` — scoped per organization so one
   * tenant's request ID can never collide with, or reveal, another's. The index
   * makes the replay check a single bounded lookup on the hot path of every
   * mutation.
   *
   * Two hashes, because a replay asks two questions and no single hash answers
   * both:
   *
   * - `requestHash` covers the **arguments**, and exists from the moment the
   *   record is created. It is what makes "same key, different request" decidable:
   *   a second request under the same key either hashes equal — a retry, which
   *   replays the original result — or it does not, and is rejected. A hash of the
   *   response cannot do this job: no response exists when the first request
   *   arrives, and a changed argument is a property of the input.
   * - `resultHash` covers the **response**, as an integrity hash of the original
   *   one. It is not replay detection; it lets a replay prove that the response it
   *   reconstructed is the response the first call returned.
   *
   * `resultRef` is an operation-owned, stable replay reference: an opaque handle
   * (typically the ID of the document the operation produced) that the
   * operation-specific adapter — which does not exist yet — resolves back into the
   * exact original typed response. Deliberately a reference and two digests rather
   * than the payloads themselves: an idempotency table that stores requests and
   * responses becomes a second, unaudited copy of domain data and a place for PII
   * to collect outside the tenant tables that govern it (§14). `requestHash`
   * exists precisely so argument equality is decidable without keeping the
   * arguments.
   *
   * Hashes are not credentials and not reversible into their inputs. The digest
   * algorithm, the argument canonicalization, and the reference format are owed by
   * the operation-level wrapper, not by this declaration.
   *
   * Nothing runs yet: no mutation writes a record, nothing computes a hash,
   * nothing rejects a mismatch. The invariant this shape must be able to support —
   * a replay of the same `(orgId, operation, requestId)` returns the original
   * result, and a request whose arguments differ under that key is rejected —
   * belongs to the future wrapper (`ADR-0003` §4, `INV-0003-01`).
   */
  idempotencyRecords: defineTable(
    tenantFields({
      /** Logical operation name, e.g. `receiving.receipt.post`. */
      operation: v.string(),
      /** Client-generated request ID (UUIDv7 in the ledger contract, §7.4). */
      requestId: v.string(),
      status: idempotencyStatus,
      /**
       * Hash of the canonicalized request arguments. Required, and written when
       * the record is first created: a replay check that cannot compare arguments
       * cannot distinguish a retry from a reused request ID.
       */
      requestHash: v.string(),
      /**
       * Operation-owned stable replay reference — an opaque handle the operation's
       * own adapter resolves into the original typed response. Absent until the
       * operation completes.
       */
      resultRef: v.optional(v.string()),
      /**
       * Integrity hash of the original response, so a reconstructed replay result
       * is verifiable. Absent until the operation completes. Not replay detection:
       * that is `requestHash`.
       */
      resultHash: v.optional(v.string()),
      actorUserId: v.optional(v.id("users")),
      deviceId: v.optional(v.id("devices")),
      firstSeenAt: v.number(),
      completedAt: v.optional(v.number()),
      /** Retention horizon; a cron prunes past it (D-27 applies to ledger/audit, not this). */
      expiresAt: v.number(),
    }),
  )
    .index("by_orgId_operation_requestId", byOrg("operation", "requestId"))
    .index("by_orgId_expiresAt", byOrg("expiresAt")),

  /**
   * A registered handheld or workstation (`G-013`).
   *
   * Context, not an authorization subject: a device never carries permission, and
   * there is no shared privileged account (`ADR-0006` §8). Consequently it holds
   * no secret — no pairing key, no API key, no token. `installationId` is an
   * opaque client-generated correlation value and authenticates nothing.
   */
  devices: defineTable(
    tenantFields({
      label: v.string(),
      deviceType,
      status: deviceStatus,
      /** Home warehouse, when the device belongs to one site. */
      warehouseId: v.optional(v.id("warehouses")),
      /**
       * Opaque correlation value from the installed PWA. Never a credential.
       * Unique per organization **when present**, by contract: an absent value is
       * not a collision, so two devices that have never reported an installation
       * are two devices, not a duplicate.
       */
      installationId: v.optional(v.string()),
      lastSeenAt: v.optional(v.number()),
    }),
  )
    .index("by_orgId_installationId", byOrg("installationId"))
    .index("by_orgId_status_label", byOrg("status", "label"))
    .index("by_orgId_warehouseId_status", byOrg("warehouseId", "status")),

  /**
   * Security-relevant session and step-up events (§7.1, §5 Q16).
   *
   * Named exactly as plan §7.1 names it, alongside `devices`.
   *
   * This does not replace or duplicate Clerk sessions: Clerk remains the session
   * authority (C-03). It records that an event happened, so shared-device actor
   * attribution and step-up freshness have a history. `clerkSessionId` is an
   * opaque reference, not a bearer token; no token, credential, or MFA secret is
   * stored (`INV-0001-06`).
   */
  sessionsAudit: defineTable(
    tenantFields({
      userId: v.id("users"),
      eventType: sessionsAuditEventType,
      occurredAt: v.number(),
      /** Opaque Clerk session reference for correlation. Cannot authenticate. */
      clerkSessionId: v.optional(v.string()),
      deviceId: v.optional(v.id("devices")),
      requestId: v.optional(v.string()),
      /** When Clerk last reverified this actor, for step-up freshness (`INV-0006-07`). */
      reverifiedAt: v.optional(v.number()),
      outcome: auditOutcome,
    }),
  )
    .index("by_orgId_occurredAt", byOrg("occurredAt"))
    .index("by_orgId_userId_occurredAt", byOrg("userId", "occurredAt"))
    .index("by_orgId_clerkSessionId", byOrg("clerkSessionId"))
    .index("by_orgId_deviceId_occurredAt", byOrg("deviceId", "occurredAt")),

  /**
   * Time-boxed cross-tenant support access (`G-010`, `ADR-0006` §7).
   *
   * **Schema-ready and disabled.** The capability is gated by
   * `organizations.settings.supportGrantsEnabled`, which defaults to `false`, and
   * no code in this repository reads or writes this table. With no enabled grant
   * there is no cross-tenant path in application code (`INV-0006-08`) — and there
   * is no bypass field here: no "permanent", no "all tenants", no
   * "skipApproval".
   *
   * Tenant-scoped rather than global on purpose: a grant belongs to the tenant it
   * affects, so the tenant can see it (`INV-0006-09`) through the same
   * `orgId`-first indexes as everything else.
   *
   * `accessMode` defaults to `READ_ONLY` in policy; `READ_WRITE` additionally
   * requires two distinct platform approvals *and* tenant approval. The three
   * approval pairs are separate fields precisely so "distinct" is checkable
   * rather than asserted.
   */
  supportGrants: defineTable(
    tenantFields({
      status: supportGrantStatus,
      accessMode: supportAccessMode,
      /** Why access is needed. Required: no grant without a stated reason. */
      reason: v.string(),
      /**
       * Support ticket reference the grant is bound to. Required, and deliberately
       * **not** unique: binding a grant to a ticket says where the request came
       * from, not that a ticket may only ever earn one grant. A reopened ticket, a
       * second engineer, or an expired grant that must be re-requested all mean
       * more than one grant for one ticket.
       */
      ticketRef: v.string(),
      /** Platform actor who requested it. Opaque platform reference. */
      requestedBy: v.string(),
      requestedAt: v.number(),
      /** First platform approval. */
      firstApprovalBy: v.optional(v.string()),
      firstApprovalAt: v.optional(v.number()),
      /** Second platform approval; must differ from the first, and from the requester. */
      secondApprovalBy: v.optional(v.string()),
      secondApprovalAt: v.optional(v.number()),
      /** Tenant-side approval via `admin.supportGrant.approve`. */
      tenantApprovalByUserId: v.optional(v.id("users")),
      tenantApprovalAt: v.optional(v.number()),
      /** Required: every grant expires. There is no indefinite grant. */
      expiresAt: v.number(),
      revokedAt: v.optional(v.number()),
      revokedBy: v.optional(v.string()),
      rejectedAt: v.optional(v.number()),
      rejectedReason: v.optional(v.string()),
    }),
  )
    // Expiry sweep and "is there an active grant right now" both read this.
    .index("by_orgId_status_expiresAt", byOrg("status", "expiresAt"))
    // Ticket history: every grant raised against one ticket, bounded. A lookup
    // index, not a uniqueness index — see `ticketRef` above.
    .index("by_orgId_ticketRef", byOrg("ticketRef"))
    .index("by_orgId_expiresAt", byOrg("expiresAt")),

  /* ------------------------------------------------------------------------ */
  /* Inventory reference scaffolding                                           */
  /* ------------------------------------------------------------------------ */

  /**
   * A stock-keeping unit (`G-040`), reduced to what the ledger must prove.
   *
   * Present because `INV-0003-04` requires every referenced item to belong to the
   * active organization and `ADR-0004` requires one base UOM per item — a ledger
   * line's quantity has no meaning without it. Everything else §7.2 lists for an
   * item (bilingual descriptions, alternate UOMs, barcodes, QC profile, putaway
   * preferences) belongs to the master-data slice and is deliberately absent: a
   * field with no reader is invented domain.
   *
   * `trackingMode` is declared now because it decides whether a lot is required on
   * a posting, and `LOT_SERIAL` is declared with its flows off (D-09,
   * `INV-0005-08`).
   */
  items: defineTable(
    tenantFields({
      /** Tenant's normalized SKU. Unique per organization by contract (§5 Q4). */
      sku: v.string(),
      /** Display name; may be Thai. Bilingual descriptions are a later table. */
      name: v.string(),
      /** The one UOM quantities are stored in (`ADR-0004`, D-08). Never changes in place. */
      baseUom: v.string(),
      trackingMode: itemTrackingMode,
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_sku", byOrg("sku"))
    .index("by_orgId_status_sku", byOrg("status", "sku")),

  /**
   * A physical location inside one warehouse (`G-021`).
   *
   * `warehouseId` is required and, by contract, never changes: `INV-0005-01`. A
   * ledger posting proves the location belongs to the header's warehouse through
   * this field, which is the whole reason the table exists in this slice.
   *
   * No `parentId`, no materialized path, no capacity, no storage class. Those are
   * `ADR-0005`'s hierarchy model, and a `path` column nothing maintains would be
   * worse than no column at all.
   */
  locations: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      /** Tenant's normalized code. Unique per warehouse by contract. */
      code: v.string(),
      locationType,
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_warehouseId_code", byOrg("warehouseId", "code"))
    .index(
      "by_orgId_warehouseId_status_code",
      byOrg("warehouseId", "status", "code"),
    )
    /**
     * Active locations of one type, in code order.
     *
     * Receiving needs "the docks and staging lanes at this site" and nothing
     * else. Without the type in the prefix that question is a scan of every
     * active location filtered afterwards — and a warehouse with a thousand
     * racks would hide its own dock behind them, which reads to an operator
     * standing on that dock as "this site has no receiving location".
     */
    .index(
      "by_orgId_warehouseId_status_locationType_code",
      byOrg("warehouseId", "status", "locationType", "code"),
    ),

  /** A versioned, warehouse-bound building envelope and its cached totals. */
  storageBuildings: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      code: v.string(),
      name: v.string(),
      widthMm: v.number(),
      depthMm: v.number(),
      defaultFloorHeightMm: v.number(),
      floorCount: v.number(),
      totalHeightMm: v.number(),
      grossAreaSqMm: v.number(),
      reservedAreaSqMm: v.number(),
      usableAreaSqMm: v.number(),
      status: storageLayoutStatus,
      version: v.number(),
      createdAt: v.number(),
      createdByUserId: v.id("users"),
      updatedAt: v.number(),
      updatedByUserId: v.id("users"),
      activatedAt: v.optional(v.number()),
      activatedByUserId: v.optional(v.id("users")),
    }),
  )
    .index("by_orgId_warehouseId_code", byOrg("warehouseId", "code"))
    .index(
      "by_orgId_warehouseId_status_code",
      byOrg("warehouseId", "status", "code"),
    ),

  /** One editable floor; absent dimension overrides inherit from its building. */
  storageFloors: defineTable(
    tenantFields({
      buildingId: v.id("storageBuildings"),
      warehouseId: v.id("warehouses"),
      floorNumber: v.number(),
      widthMm: v.optional(v.number()),
      depthMm: v.optional(v.number()),
      heightMm: v.optional(v.number()),
      grossAreaSqMm: v.number(),
      reservedAreaSqMm: v.number(),
      usableAreaSqMm: v.number(),
      version: v.number(),
      updatedAt: v.number(),
      updatedByUserId: v.id("users"),
    }),
  )
    .index(
      "by_orgId_buildingId_floorNumber",
      byOrg("buildingId", "floorNumber"),
    )
    .index(
      "by_orgId_warehouseId_buildingId_floorNumber",
      byOrg("warehouseId", "buildingId", "floorNumber"),
    ),

  /** Axis-aligned unavailable space such as columns, cores, and staging zones. */
  storageFloorReservedBlocks: defineTable(
    tenantFields({
      buildingId: v.id("storageBuildings"),
      floorId: v.id("storageFloors"),
      warehouseId: v.id("warehouses"),
      label: v.string(),
      xMm: v.number(),
      yMm: v.number(),
      widthMm: v.number(),
      depthMm: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  )
    .index("by_orgId_floorId", byOrg("floorId"))
    .index("by_orgId_buildingId_floorId", byOrg("buildingId", "floorId")),

  /**
   * A production batch of one item (`G-030`).
   *
   * `itemId` is required, and a posting proves the lot belongs to the line's item
   * through it (`INV-0003-05`, `INV-0005-02`). The three business dates are here
   * because expiry reclassification reads `expirationDate` (§5 Q19) and FEFO reads
   * whichever the tenant configured (§5 Q23); they are `YYYY-MM-DD` strings in the
   * organization's timezone, never instants (D-05, `G-105`).
   */
  lots: defineTable(
    tenantFields({
      itemId: v.id("items"),
      /** Supplier or internal lot code, case preserved. Unique per item by contract. */
      lotCode: v.string(),
      /** `YYYY-MM-DD` business dates. Absent means the tenant did not capture one. */
      manufactureDate: v.optional(v.string()),
      expirationDate: v.optional(v.string()),
      bestBeforeDate: v.optional(v.string()),
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_itemId_lotCode", byOrg("itemId", "lotCode"))
    /*
     * The status-carrying variant of the line above, for "this item's ACTIVE
     * lots". Status has to be *in* the index rather than a predicate over a page:
     * a page is drawn before a filter runs, so filtering afterwards returns a
     * short page — sometimes an empty one — while the envelope still reports more
     * to come, and the screen reads that as "this item has no lots"
     * (`INV-0002-04`).
     */
    .index(
      "by_orgId_itemId_status_lotCode",
      byOrg("itemId", "status", "lotCode"),
    )
    .index("by_orgId_itemId_expirationDate", byOrg("itemId", "expirationDate")),

  /**
   * A logistic handling unit — in the MVP, a pallet (`G-024`, D-10).
   *
   * `currentLocationId` is the one-location invariant made storable
   * (`INV-0005-04`): a handling unit has at most one current location, so the
   * answer is a field rather than a set of rows a query would have to reconcile.
   * The ledger reads it to refuse a posting that would place one unit in two
   * places; it does not yet maintain contents, nesting, or LPN history, which are
   * `ADR-0005` §9's transactions.
   */
  handlingUnits: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      /** LPN or SSCC, normalized. Unique per organization by contract (`INV-0005-05`). */
      lpn: v.string(),
      /** Where it is now, when it is anywhere. Absent for a unit not yet placed. */
      currentLocationId: v.optional(v.id("locations")),
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_lpn", byOrg("lpn"))
    .index(
      "by_orgId_warehouseId_status_lpn",
      byOrg("warehouseId", "status", "lpn"),
    ),

  /**
   * The legal owner of consigned stock (`G-054`, D-11).
   *
   * Declared because `ownerId` is a bucket dimension and a posting must prove the
   * owner belongs to the tenant. Consigned stock stays **disabled** by
   * `organizations.settings.consignedStockEnabled`, which defaults to `false`; the
   * ledger refuses an `ownerId` while it is off, so enabling it is a settings
   * change plus tests rather than a schema migration.
   */
  owners: defineTable(
    tenantFields({
      /** Tenant's normalized code. Unique per organization by contract. */
      code: v.string(),
      name: v.string(),
      status: masterDataStatus,
    }),
  ).index("by_orgId_code", byOrg("code")),

  /**
   * A tenant-configured reason (`G-057`), required by an adjustment, a scrap, and
   * a reversal (`ADR-0003` §5, plan §7.5).
   *
   * `scope` is closed so a code minted for scrap cannot silently become the
   * justification for a reversal, which is the one place the reason *is* the audit
   * evidence.
   */
  reasonCodes: defineTable(
    tenantFields({
      /** Tenant's normalized code. Unique per organization by contract. */
      code: v.string(),
      name: v.string(),
      scope: reasonCodeScope,
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_code", byOrg("code"))
    .index("by_orgId_scope_code", byOrg("scope", "code")),

  /**
   * A supplier of goods (`G-051`).
   *
   * Standalone in this slice: nothing references a supplier yet, because the
   * purchase order and the receipt that would are `ADR-0007` work. It is here
   * because supplier identity is what a lot's provenance and a barcode's
   * `SUPPLIER` kind will both resolve against, and inventing that identity
   * later — after lots exist — means a migration rather than a foreign key.
   */
  suppliers: defineTable(
    tenantFields({
      /** Tenant's normalized code. Unique per organization by contract. */
      code: v.string(),
      name: v.string(),
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_code", byOrg("code"))
    .index("by_orgId_status_code", byOrg("status", "code")),

  /**
   * A scannable alias for one item (`ADR-0005` §4, D-15).
   *
   * The uniqueness that matters is `(orgId, barcode)`, not `(orgId, itemId,
   * barcode)`: a scanned string must resolve to **at most one** item, or the
   * receiving screen has to ask an operator which SKU they meant while holding
   * the carton. That is the invariant `INV-0005-06` names, and the index is what
   * makes the check a bounded read.
   *
   * `kind` is stored because the scan resolver classifies before it resolves —
   * `convex/model/identifiers/scanResolution.ts` decides whether a string is a
   * GTIN, an SSCC, or an internal LPN, and a row that claimed `GTIN` for a value
   * that fails its check digit is a row the resolver would never have produced.
   */
  itemBarcodes: defineTable(
    tenantFields({
      itemId: v.id("items"),
      /** Normalized scan value: digits preserved, leading zeros kept. */
      barcode: v.string(),
      kind: barcodeKind,
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_barcode", byOrg("barcode"))
    .index("by_orgId_itemId_barcode", byOrg("itemId", "barcode"))
    /* The status-carrying variant; see the note on `lots` above. */
    .index(
      "by_orgId_itemId_status_barcode",
      byOrg("itemId", "status", "barcode"),
    ),

  /**
   * One alternate packaging unit of an item, and its exact factor to the base
   * UOM (`ADR-0004`, D-08).
   *
   * The factor is a **rational**, stored as two integers, because
   * `convex/model/uom/ratio.ts` is exact and a float is not: one case of twelve
   * is `12/1`, and a pallet of eighty cartons that each hold seven units is
   * `560/1`, but a drum decanted into three parts is `1/3` and no float
   * represents it. Storing numerator and denominator lets
   * `makeItemUomProfile` rebuild the tenant's conversion table exactly.
   *
   * The base UOM itself is never a row here: it lives on `items.baseUom`, and
   * `BASE_UOM_AS_ALTERNATE` is what the kernel answers if one is offered.
   */
  itemUoms: defineTable(
    tenantFields({
      itemId: v.id("items"),
      /** Normalized UOM code, upper-cased. Unique per item by contract. */
      uom: v.string(),
      /** `1 uom = numerator/denominator` base units. Both positive integers. */
      toBaseNumerator: v.number(),
      toBaseDenominator: v.number(),
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_itemId_uom", byOrg("itemId", "uom"))
    .index("by_orgId_itemId_status_uom", byOrg("itemId", "status", "uom")),

  /**
   * A storage class: a named handling constraint a location or an item carries
   * (`ADR-0005` §6, D-13).
   *
   * Organization-scoped, not warehouse-scoped. "Flammable" means the same thing
   * at every site, and a class defined per warehouse would let two sites
   * disagree about what it permits — which is exactly the disagreement a
   * putaway compatibility rule cannot survive.
   *
   * No compatibility matrix yet. Which classes may share a location is `D-13`'s
   * hard constraint and belongs with the putaway slice; a matrix nothing
   * evaluates would be invented domain.
   */
  storageClasses: defineTable(
    tenantFields({
      /** Tenant's normalized code. Unique per organization by contract. */
      code: v.string(),
      name: v.string(),
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_code", byOrg("code"))
    .index("by_orgId_status_code", byOrg("status", "code")),

  /**
   * One immutable *version* of a label template (D-16, `ADR-0008`).
   *
   * Versioned, and the version is part of the key: a printed label is audit
   * evidence, and evidence whose template was edited underneath it proves
   * nothing (`RG-004` is a physical print gate that names a version). Publishing
   * is therefore a new row, never an edit of an old one.
   *
   * `draftedByUserId` exists so publishing can be genuine maker-checker: the
   * evaluator needs a *maker* to compare the publisher against, and reading it
   * from a stored field is checkable in a way that re-deriving it from the audit
   * trail is not.
   *
   * `body` is the payload text — ZPL or a PDF template source. **Nothing in this
   * repository renders, transmits, or prints it.** It is stored, versioned, and
   * read back; the printer transport is `INT-04` and does not exist.
   */
  labelTemplates: defineTable(
    tenantFields({
      /** Tenant's normalized template code, stable across versions. */
      code: v.string(),
      /** Monotonic version within the code. Unique per code by contract. */
      version: v.number(),
      name: v.string(),
      format: labelTemplateFormat,
      /** The payload source. Never rendered or transmitted here. */
      body: v.string(),
      status: labelTemplateStatus,
      /** The actor who drafted this version; the maker a publisher is checked against. */
      draftedByUserId: v.id("users"),
      /** Set when a *different* actor published it (`INV-0006-05`). */
      publishedByUserId: v.optional(v.id("users")),
    }),
  )
    .index("by_orgId_code_version", byOrg("code", "version"))
    .index("by_orgId_status_code", byOrg("status", "code")),

  /* ------------------------------------------------------------------------ */
  /* Inbound slice: purchase orders, receipts, QC, labels, putaway (ADR-0007)  */
  /* ------------------------------------------------------------------------ */

  /**
   * A purchase order (`G-060`, `ADR-0007` §1).
   *
   * Warehouse-scoped, because a delivery arrives at a *site*: the receiving
   * permission is warehouse-scoped (`purchasing.po.read`), and an order that
   * belonged only to the organization would be receivable by an actor with no
   * membership at the dock it turned up on (`INV-0006-04`).
   *
   * `externalRef` is the tenant's own reference — an ERP document number, or the
   * import batch a row came from. It is optional, unique per organization when
   * present by contract, and it is what makes a later ERP integration reuse this
   * table rather than shadow it (`ADR-0007` §2).
   */
  purchaseOrders: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      /** Tenant's normalized order number. Unique per organization by contract. */
      poNumber: v.string(),
      supplierId: v.id("suppliers"),
      status: purchaseOrderStatus,
      /** The tenant's own document reference, when they have one. */
      externalRef: v.optional(v.string()),
      /** Set when the order was created by an import rather than by hand. */
      importBatchId: v.optional(v.id("poImportBatches")),
    }),
  )
    .index("by_orgId_poNumber", byOrg("poNumber"))
    .index("by_orgId_externalRef", byOrg("externalRef"))
    .index(
      "by_orgId_warehouseId_status_poNumber",
      byOrg("warehouseId", "status", "poNumber"),
    ),

  /**
   * One ordered item on one order.
   *
   * `receivedMinorUnits` is a **stored running total** rather than a sum over
   * receipt lines, and that is a deliberate trade. `assessReceipt` classifies
   * against the line's total (two postings of 60 against an order of 100 is an
   * over-receipt), so every posting needs the total; deriving it would mean
   * paging every receipt line for the order inside the posting transaction,
   * which is an unbounded read on the hot path. The reconciliation job is what
   * proves the stored total against the lines.
   *
   * `orderedUom` is the unit the *order* was written in, which is not always the
   * item's base unit — a supplier sells cases and the ledger stores eaches. The
   * conversion happens at receipt through the item's own UOM profile
   * (`ADR-0004`), so both numbers are kept: `orderedMinorUnits` in `orderedUom`,
   * and `receivedMinorUnits` in the item's base unit.
   */
  purchaseOrderLines: defineTable(
    tenantFields({
      purchaseOrderId: v.id("purchaseOrders"),
      /** Position within the order. Unique per order by contract. */
      lineNumber: v.number(),
      itemId: v.id("items"),
      /** Ordered quantity, in the unit the order was written in. */
      orderedQuantity: signedQuantity,
      /** Ordered quantity converted to the item's base minor units. */
      orderedBaseMinorUnits: v.number(),
      /** Running total received, in the item's base minor units. */
      receivedBaseMinorUnits: v.number(),
      status: purchaseOrderLineStatus,
      /** Required when the line was closed short (`INV-0007-03`). */
      closeReasonCodeId: v.optional(v.id("reasonCodes")),
      /** The import row that produced this line, when it came from a file. */
      sourceRowRef: v.optional(v.string()),
    }),
  )
    .index(
      "by_orgId_purchaseOrderId_lineNumber",
      byOrg("purchaseOrderId", "lineNumber"),
    )
    .index(
      "by_orgId_purchaseOrderId_status",
      byOrg("purchaseOrderId", "status"),
    )
    .index("by_orgId_sourceRowRef", byOrg("sourceRowRef")),

  /**
   * A previewed import (`INV-0007-12`).
   *
   * The batch holds the **parse result**, not the file: `acceptedCount` and
   * `rejectedCount` are what an operator approves, and the rows themselves are
   * re-derived from the same text on each chunk because parsing is deterministic.
   * Storing the uploaded file would be a private-document retention decision
   * (`ADR-0008` file storage port) that this slice has not made.
   */
  poImportBatches: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      /** The operator's own reference for the file. Unique per org by contract. */
      batchRef: v.string(),
      supplierId: v.id("suppliers"),
      status: importBatchStatus,
      acceptedCount: v.number(),
      rejectedCount: v.number(),
      /** How many accepted rows have been written so far; the resume cursor. */
      appliedCount: v.number(),
    }),
  )
    .index("by_orgId_batchRef", byOrg("batchRef"))
    .index("by_orgId_status_batchRef", byOrg("status", "batchRef")),

  /**
   * A receiving event at one dock (`ADR-0007` §3).
   *
   * A receipt groups lines that arrived together. `purchaseOrderId` is optional
   * because a blind receipt has no order — that is the whole of what "blind"
   * means — and the line's own `kind` records which exception applied.
   */
  receipts: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      purchaseOrderId: v.optional(v.id("purchaseOrders")),
      /** Tenant-visible reference, unique per organization by contract. */
      receiptNumber: v.string(),
      receivedByUserId: v.id("users"),
      /** Server clock at creation; a client instant could backdate stock. */
      occurredAt: v.number(),
      /** `YYYY-MM-DD` in the organization's timezone (`ADR-0011`). */
      businessDate: v.string(),
    }),
  )
    .index("by_orgId_receiptNumber", byOrg("receiptNumber"))
    .index(
      "by_orgId_warehouseId_occurredAt",
      byOrg("warehouseId", "occurredAt"),
    )
    .index("by_orgId_purchaseOrderId", byOrg("purchaseOrderId")),

  /**
   * One item, one lot, one quantity, received once.
   *
   * `transactionId` is the ledger posting this line produced, and it is
   * **required**: a receipt line without a transaction would be stock somebody
   * recorded and the ledger never saw, which is precisely the drift `ADR-0003`
   * exists to make impossible. The two are written in one transaction.
   *
   * `classification` and `kind` are stored rather than recomputed, because they
   * are evidence: what the tolerance *was* when this was received, and which
   * exception permission was exercised (`INV-0007-04`).
   */
  receiptLines: defineTable(
    tenantFields({
      receiptId: v.id("receipts"),
      purchaseOrderLineId: v.optional(v.id("purchaseOrderLines")),
      itemId: v.id("items"),
      lotId: v.optional(v.id("lots")),
      handlingUnitId: v.optional(v.id("handlingUnits")),
      /**
       * Where the stock landed — the dock or staging lane it was received to.
       *
       * Stored rather than derived from the posting's lines, because both the QC
       * disposition and the putaway move need to post *from* this bucket, and
       * reading it back out of the ledger would mean parsing a transaction to
       * recover a fact the receipt already knew.
       */
      locationId: v.id("locations"),
      /** As received, in the unit the operator captured. */
      capturedQuantity: signedQuantity,
      /** Converted to the item's base minor units by the UOM kernel. */
      baseMinorUnits: v.number(),
      kind: receiptLineKind,
      classification: receiptClassification,
      /** The stock status the posting landed in: `AVAILABLE` or `QC_HOLD`. */
      stockStatus,
      /** The ledger posting. Required: no line exists without one. */
      transactionId: v.id("inventoryTransactions"),
      /** True when an over-tolerance approval was exercised (`INV-0007-02`). */
      overToleranceApproved: v.boolean(),
    }),
  )
    .index("by_orgId_receiptId", byOrg("receiptId"))
    .index("by_orgId_purchaseOrderLineId", byOrg("purchaseOrderLineId"))
    .index("by_orgId_itemId_stockStatus", byOrg("itemId", "stockStatus")),

  /**
   * A receiving exception somebody raised, so somebody else can post against it.
   *
   * This table is what makes `INV-0007-04`'s maker-checker permissions
   * *reachable*. `receiving.receipt.unexpected` and `receiving.receipt.blind`
   * carry maker-checker, and the evaluator denies when there is no maker at all
   * — correctly, fail-closed. So the maker is stored: one actor raises the
   * exception with a reason under `receiving.exception.manage`, and a different
   * actor posts the stock against it.
   *
   * `status` moves to `CONSUMED` when a line is posted against it, so one raised
   * exception authorizes one posting rather than standing open as a permanent
   * bypass.
   */
  receivingExceptions: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      kind: receiptLineKind,
      /** The item the exception is about; absent for a wholly blind delivery. */
      itemId: v.optional(v.id("items")),
      purchaseOrderId: v.optional(v.id("purchaseOrders")),
      reasonCodeId: v.id("reasonCodes"),
      /** The maker. A different actor must post against this (`INV-0006-05`). */
      raisedByUserId: v.id("users"),
      status: receivingExceptionStatus,
      note: v.optional(v.string()),
    }),
  )
    .index(
      "by_orgId_warehouseId_status_kind",
      byOrg("warehouseId", "status", "kind"),
    )
    .index("by_orgId_itemId_status", byOrg("itemId", "status")),

  /**
   * Which receipts are QC-controlled (`ADR-0007` §8).
   *
   * Scoped to an item *or* a supplier, never both on one row: the resolution rule
   * is "the more specific profile wins", and a row that carried both would have
   * no defined specificity. The absence of any profile means not controlled,
   * which is the honest default for an unconfigured tenant.
   */
  qcProfiles: defineTable(
    tenantFields({
      /** Exactly one of these is set; the index pair is what enforces it. */
      itemId: v.optional(v.id("items")),
      supplierId: v.optional(v.id("suppliers")),
      enabled: v.boolean(),
      strategy: samplingStrategy,
      /** The count for `FIXED`, the whole-number percentage for `PERCENT`. */
      parameter: v.optional(v.number()),
    }),
  )
    .index("by_orgId_itemId", byOrg("itemId"))
    .index("by_orgId_supplierId", byOrg("supplierId")),

  /**
   * One inspection of one received line (`ADR-0007` §5–7).
   *
   * The sample plan is stored as computed, not as configured. A profile changes;
   * the plan that was actually applied to this delivery does not, and it is the
   * evidence an auditor reads.
   */
  qcInspections: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      receiptLineId: v.id("receiptLines"),
      itemId: v.id("items"),
      status: inspectionStatus,
      strategy: samplingStrategy,
      sampleSize: v.number(),
      lotSize: v.number(),
      /** Set once a disposition is submitted. */
      disposition: v.optional(qcDisposition),
      reasonCodeId: v.optional(v.id("reasonCodes")),
      /** The submitter; the maker an approver is checked against (`INV-0006-05`). */
      submittedByUserId: v.optional(v.id("users")),
      approvedByUserId: v.optional(v.id("users")),
      /** The balanced status-change posting, once it exists. */
      transactionId: v.optional(v.id("inventoryTransactions")),
    }),
  )
    .index("by_orgId_receiptLineId", byOrg("receiptLineId"))
    .index("by_orgId_warehouseId_status", byOrg("warehouseId", "status")),

  /**
   * A generated label payload, retained as evidence (`INV-0007-07`).
   *
   * `payloadHash` is over the *canonical text* — template code, version, format,
   * then payload — so the hash proves which version produced these bytes rather
   * than only what the bytes were. Two versions can render identical payloads.
   *
   * `status` never reaches a value claiming the label was printed. See
   * `printJobStatus`.
   */
  labelPrintJobs: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      labelTemplateId: v.id("labelTemplates"),
      /** Denormalized so an evidence row survives a template being retired. */
      templateCode: v.string(),
      templateVersion: v.number(),
      /** What the label is for: a handling unit, a receipt line, or a lot. */
      targetKind: v.string(),
      targetId: v.string(),
      payload: v.string(),
      payloadHash: v.string(),
      reason: printReason,
      status: printJobStatus,
      requestedByUserId: v.id("users"),
      occurredAt: v.number(),
    }),
  )
    .index(
      "by_orgId_warehouseId_occurredAt",
      byOrg("warehouseId", "occurredAt"),
    )
    .index("by_orgId_targetKind_targetId", byOrg("targetKind", "targetId"))
    .index("by_orgId_payloadHash", byOrg("payloadHash")),

  /**
   * A putaway task and the recommendation that produced it (`ADR-0007` §12–15).
   *
   * The recommendation trace is stored **on the task** rather than in its own
   * table. It is written once, read with the task, and never queried
   * independently; a separate table would add a join to every handheld read to
   * normalize data that has exactly one owner.
   *
   * `claimedByUserId` plus `status` is the compare-and-set pair (`INV-0007-11`).
   * The claim is decided against the row as re-read inside the transaction, so
   * two operators pressing at once resolve on the write.
   */
  putawayTasks: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      receiptLineId: v.id("receiptLines"),
      itemId: v.id("items"),
      lotId: v.optional(v.id("lots")),
      handlingUnitId: v.optional(v.id("handlingUnits")),
      /** What is to be moved, in the item's base minor units. */
      baseMinorUnits: v.number(),
      /** Where it is now — the dock or staging lane it was received to. */
      fromLocationId: v.id("locations"),
      status: putawayTaskStatus,
      claimedByUserId: v.optional(v.id("users")),
      claimedAt: v.optional(v.number()),
      /** The top-ranked location at recommendation time. */
      recommendedLocationId: v.optional(v.id("locations")),
      /** The stored explanation: ranked candidates, rejections, filters, weights. */
      recommendationTrace: v.optional(v.string()),
      /** Where the stock actually went. */
      chosenLocationId: v.optional(v.id("locations")),
      /** Required when the chosen location was not the recommendation (`INV-0007-09`). */
      overrideReasonCodeId: v.optional(v.id("reasonCodes")),
      /** The balanced move, once confirmed. */
      transactionId: v.optional(v.id("inventoryTransactions")),
    }),
  )
    .index("by_orgId_warehouseId_status", byOrg("warehouseId", "status"))
    .index("by_orgId_receiptLineId", byOrg("receiptLineId"))
    .index(
      "by_orgId_claimedByUserId_status",
      byOrg("claimedByUserId", "status"),
    ),

  /* ------------------------------------------------------------------------ */
  /* Reporting rollups and export jobs (`ADR-0011`)                            */
  /* ------------------------------------------------------------------------ */

  /**
   * Maintained counters behind every dashboard tile (`ADR-0011` §6,
   * `INV-0011-07`).
   *
   * A dashboard is where an unbounded read gets written by accident. "How many
   * receipts are open?" looks like a `count`, and a warehouse with four thousand
   * of them turns that into a scan on the one screen a supervisor opens first.
   * So the count is *maintained*: each row is one number, updated in the same
   * transaction as the domain change that moved it, and a tile is a single
   * indexed document read.
   *
   * `subjectKey` is what makes one table serve both shapes. A site-wide metric
   * uses the sentinel `-`; a per-subject metric — occupancy, which is per
   * location — uses the subject's ID. The index prefix `(orgId, warehouseId,
   * metric)` then reads either one row or that metric's own bounded page,
   * without a second table whose drift nobody would notice.
   *
   * These are a **projection, not a source**. Every metric is recomputable from
   * the tables it summarises (`INV-0011-09`), `reporting/rollups:verifyRollups`
   * does exactly that on a bounded resumable walk, and a counter that disagrees
   * is drift to be reported rather than a number to be trusted.
   */
  operationsRollups: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      metric: rollupMetric,
      /** The subject a per-subject metric counts, or `-` for a site total. */
      subjectKey: v.string(),
      /** Never negative. A decrement that would go below zero clamps and marks. */
      count: v.number(),
      updatedAt: v.number(),
      /**
       * When a decrement last tried to go below zero.
       *
       * Recorded rather than thrown: a counter bug must not stop a receipt being
       * posted, and a silent clamp would hide the very drift the verifier looks
       * for. Present means "this number is suspect until verified".
       */
      underflowAt: v.optional(v.number()),
    }),
  )
    // One row per (site, metric, subject); also the bounded per-metric page.
    .index(
      "by_orgId_warehouseId_metric_subjectKey",
      byOrg("warehouseId", "metric", "subjectKey"),
    ),

  /**
   * An asynchronous export, from request to artifact (`ADR-0011` §7).
   *
   * Asynchronous because the alternative is a request that reads a warehouse's
   * history inside one interactive call, and `INV-0011-01` forbids exactly that.
   * The job carries its own resumable cursor and a page budget, so a large export
   * is many bounded steps rather than one unbounded one, and an interrupted run
   * continues instead of restarting.
   *
   * The rendered CSV lives on the document while the export is small enough to
   * belong there, and `artifactBytes` is checked against a stated cap before any
   * append. Delivery through a short-lived signed URL is `FileStoragePort`'s job
   * (`INV-0011-08`, `ADR-0008`) and needs a storage vendor that is not
   * configured; until then the artifact is readable only through a permission
   * -checked query, which is a narrower channel rather than a substitute claim.
   */
  reportJobs: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      kind: reportKind,
      status: reportJobStatus,
      /** Who asked, so an artifact can be attributed as well as authorized. */
      requestedByUserId: v.id("users"),
      requestedAt: v.number(),
      /** The idempotency key of the request that created this job. */
      requestId: v.string(),
      /** Resume point for the next chunk; absent once the walk is complete. */
      cursor: v.optional(v.string()),
      rowCount: v.number(),
      /** The CSV rendered so far, header included. */
      artifact: v.string(),
      artifactBytes: v.number(),
      /** SHA-256 of `artifact`, so a download can be checked against the job. */
      checksum: v.optional(v.string()),
      completedAt: v.optional(v.number()),
      /** Why a run stopped, when it stopped badly. Never a vendor message. */
      failureCode: v.optional(v.string()),
    }),
  )
    // The register: this site's exports, newest handled by the caller's ordering.
    .index("by_orgId_warehouseId_status", byOrg("warehouseId", "status"))
    // Replay-by-reconstruction for a repeated request (`INV-0011-02`).
    .index("by_orgId_requestId", byOrg("requestId")),

  /* ------------------------------------------------------------------------ */
  /* Inventory ledger and projections                                          */
  /* ------------------------------------------------------------------------ */

  /**
   * The immutable transaction header (plan §7.4, `ADR-0003` §1).
   *
   * **Append-only.** No application code patches, replaces, or deletes a row here;
   * `scripts/verify-tenant-boundary.mjs` fails the build if any production Convex
   * file names this table in a rewriting call (`INV-0003-07`, plan §12).
   *
   * `requestId` plus `operation` is the idempotency namespace (`INV-0003-01`,
   * §5 Q30). It is on the transaction as well as in `idempotencyRecords` on
   * purpose: the record is the replay *index*, and the transaction is the replay
   * *answer*, so a reader holding a transaction can still say which request
   * produced it after the record's retention window has passed.
   *
   * `lineCount` and `conservationGroupCount` are stored facts, not conveniences: a
   * reader that wants to know whether it has all of a transaction's lines should
   * not have to page the lines to find out, and a reconciliation that found a
   * different number has found real corruption rather than an incomplete read.
   *
   * `actorUserId` is a `v.id("users")` rather than plan §7.4's illustrative
   * `string`, matching `auditEvents.actorUserId`. A document ID is checkable
   * against the tenant's own mirror; an opaque string is not.
   */
  inventoryTransactions: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      type: inventoryTransactionType,
      /** Logical operation name, part of the idempotency key. Code-owned. */
      operation: v.string(),
      /** Client-generated UUIDv7. Unique per `(orgId, operation)` by contract. */
      requestId: v.string(),
      actorUserId: v.id("users"),
      deviceId: v.optional(v.id("devices")),
      /** When the movement happened, in UTC milliseconds (D-05). */
      occurredAt: v.number(),
      /** The organization-local business date of the movement (`G-105`, D-05). */
      businessDate: v.string(),
      source: inventoryTransactionSource,
      /** Set exactly when `type` is `REVERSAL`. Unique per organization by contract. */
      reversalOfTransactionId: v.optional(v.id("inventoryTransactions")),
      reasonCodeId: v.optional(v.id("reasonCodes")),
      lineCount: v.number(),
      conservationGroupCount: v.number(),
    }),
  )
    // The replay check on the hot path of every posting, and the uniqueness
    // contract the mutation owes.
    .index("by_orgId_operation_requestId", byOrg("operation", "requestId"))
    // History for one site, newest last. The screens in §7.3 read this.
    .index(
      "by_orgId_warehouseId_occurredAt",
      byOrg("warehouseId", "occurredAt"),
    )
    // "Has this transaction already been reversed?" — one bounded read
    // (`INV-0003-08`).
    .index("by_orgId_reversalOfTransactionId", byOrg("reversalOfTransactionId"))
    // Tenant-wide chronological paging, for reconciliation and export.
    .index("by_orgId_occurredAt", byOrg("occurredAt")),

  /**
   * The immutable balanced postings (plan §7.4, `ADR-0003` §1).
   *
   * **Append-only**, enforced the same way as the header.
   *
   * The bucket is stored twice over: once as its nine dimensions, and once as
   * `bucketKey`, the canonical length-prefixed encoding from
   * `convex/model/inventory/stockIdentity.ts`. That is not redundancy for its own
   * sake. The dimensions are what a report groups by and what a human reads; the
   * key is what a balance row is addressed by, and a single indexed string is the
   * only way a bucket lookup is one bounded read rather than a nine-term index that
   * Convex would have to be given in exactly one order. The two are written
   * together from one validated value, so they cannot disagree.
   *
   * `lineIndex` is the line's position in the transaction's **canonical** order
   * (`bucketKey` ascending), not the order a client sent. That makes the stored rows
   * a function of the transaction's content, so a replay reconstructs them
   * identically.
   *
   * `locationId` and `virtualBoundary` are both optional because Convex has no
   * dependent optionality; `locationKind` is the discriminant, and the store
   * refuses a row whose kind and payload disagree.
   */
  inventoryLedgerLines: defineTable(
    tenantFields({
      transactionId: v.id("inventoryTransactions"),
      /** Position in the transaction's canonical line order, from 0. */
      lineIndex: v.number(),
      /** Denormalized from the header so a bucket history read needs one table. */
      warehouseId: v.id("warehouses"),
      occurredAt: v.number(),
      itemId: v.id("items"),
      locationKind: ledgerLocationKind,
      /** Present exactly when `locationKind` is `PHYSICAL`. */
      locationId: v.optional(v.id("locations")),
      /** Present exactly when `locationKind` is `VIRTUAL`. */
      virtualBoundary: v.optional(virtualBoundaryCode),
      lotId: v.optional(v.id("lots")),
      /** Serial-ready and unused: serial flows are off (D-09, `INV-0005-08`). */
      serialId: v.optional(v.string()),
      handlingUnitId: v.optional(v.id("handlingUnits")),
      ownerId: v.optional(v.id("owners")),
      stockStatus,
      /** The canonical bucket encoding. See the note above. */
      bucketKey: v.string(),
      /** The conservation group this line balances within (`INV-0003-02`). */
      conservationKey: v.string(),
      /** Signed, non-zero, integer thousandths of the item's base UOM. */
      quantity: signedQuantity,
    }),
  )
    // The lines of one transaction, in canonical order. Also the uniqueness
    // contract for `(transactionId, lineIndex)`.
    .index(
      "by_orgId_transactionId_lineIndex",
      byOrg("transactionId", "lineIndex"),
    )
    // Replay of one bucket, oldest first: what reconciliation pages.
    .index("by_orgId_bucketKey_occurredAt", byOrg("bucketKey", "occurredAt"))
    // Item and lot history for the inventory screens (`inventory.history.read`).
    .index(
      "by_orgId_warehouseId_itemId_occurredAt",
      byOrg("warehouseId", "itemId", "occurredAt"),
    ),

  /**
   * The materialized current balance of one bucket (`ADR-0003` §6, §5 Q21).
   *
   * Written **only** inside the ledger posting transaction, and only by
   * `convex/lib/inventoryLedgerStore.ts`: there is no public function that sets,
   * edits, or deletes a balance (`INV-0003-11`), and
   * `scripts/verify-tenant-boundary.mjs` fails the build if any other production
   * file inserts, patches, or deletes here.
   *
   * A bucket emptied to zero keeps its row. Deleting would need the delete path
   * `INV-0003-11` forbids, and omitting would make "never used" and "emptied"
   * indistinguishable to the reconciliation that exists to tell them apart.
   *
   * Narrow on purpose: one row per bucket, and no aggregate anywhere in this table.
   * A global counter document is the contention failure plan §13 names, and
   * dashboard rollups come from the Aggregate component instead (`ADR-0011`).
   */
  inventoryBalances: defineTable(
    tenantFields({
      /** The canonical bucket encoding. Unique per organization by contract. */
      bucketKey: v.string(),
      warehouseId: v.id("warehouses"),
      itemId: v.id("items"),
      locationKind: ledgerLocationKind,
      locationId: v.optional(v.id("locations")),
      virtualBoundary: v.optional(virtualBoundaryCode),
      lotId: v.optional(v.id("lots")),
      serialId: v.optional(v.string()),
      handlingUnitId: v.optional(v.id("handlingUnits")),
      ownerId: v.optional(v.id("owners")),
      stockStatus,
      /** Signed; zero is a real, retained value. */
      quantity: signedQuantity,
      /** The transaction that last moved this bucket, for explainability. */
      lastTransactionId: v.id("inventoryTransactions"),
      updatedAt: v.number(),
    }),
  )
    // The posting path's lookup, and the uniqueness contract it owes.
    .index("by_orgId_bucketKey", byOrg("bucketKey"))
    // Bounded pages for reconciliation and for a warehouse's balance screen.
    .index("by_orgId_warehouseId_bucketKey", byOrg("warehouseId", "bucketKey"))
    // "What is on hand for this item, in this status, at this site" — the
    // question `inventory.balance.read` answers.
    .index(
      "by_orgId_warehouseId_itemId_stockStatus",
      byOrg("warehouseId", "itemId", "stockStatus"),
    ),

  /* ------------------------------------------------------------------------ */
  /* Order to ship — sales (Phase 5A)                                          */
  /* ------------------------------------------------------------------------ */

  /**
   * A party the tenant sells to (`G-119`).
   *
   * A separate table from `suppliers`, not a `partyKind` discriminator on a
   * shared one. The two are read by different people under different permissions
   * (`sales.customer.read` versus `masterdata.supplier.read`), and a shared table
   * would mean every supplier lookup returned rows a receiving clerk has no
   * business seeing and every sales lookup returned rows a salesperson does not.
   * A firm that is both is two rows, which is the honest description: the
   * commercial relationships are separate and so are their references.
   *
   * Organization-scoped: a customer belongs to the tenant, not to a site. Which
   * site makes their boxes is a property of the factory packet, not of the party.
   */
  customers: defineTable(
    tenantFields({
      /** Tenant's normalized customer code. Unique per organization by contract. */
      code: v.string(),
      /** Display name, as the tenant writes it — Thai or English (D-06). */
      name: v.string(),
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_code", byOrg("code"))
    .index("by_orgId_status_code", byOrg("status", "code")),

  /**
   * What a customer asked the tenant to make (`G-120`).
   *
   * **Never a `purchaseOrders` row.** That table is what the tenant sends *to a
   * supplier* so goods arrive at a dock; this is what arrives *from a customer* so
   * a box gets made. Opposite direction of goods, different counterparty,
   * different permissions, different lifecycle. Sharing the table would put sales
   * demand inside every receiving query — silently, and only noticed at a dock.
   *
   * `customerReference` is the customer's own PO number. It is optional because
   * plenty of orders arrive by phone or LINE with no document, and unique per
   * customer *when present* by contract rather than unique per organization: two
   * customers may both call their order `PO-001`, and refusing the second would be
   * this system telling a customer their own numbering is wrong.
   */
  customerOrders: defineTable(
    tenantFields({
      /** Tenant's normalized order number. Unique per organization by contract. */
      orderNumber: v.string(),
      customerId: v.id("customers"),
      /** The customer's own PO reference, when they sent one. */
      customerReference: v.optional(v.string()),
      status: customerOrderStatus,
      /** The day the customer placed it, as an epoch millisecond timestamp. */
      orderedAt: v.number(),
    }),
  )
    .index("by_orgId_orderNumber", byOrg("orderNumber"))
    .index(
      "by_orgId_customerId_customerReference",
      byOrg("customerId", "customerReference"),
    )
    .index("by_orgId_status_orderNumber", byOrg("status", "orderNumber")),

  /**
   * One box, in one quantity, on one customer order (`G-121`).
   *
   * The line carries three things that would otherwise be spread across tables,
   * and each is here because it is one-to-one with the line:
   *
   * - `specification` — what was ordered, stored by value. The customer ordered
   *   *these* dimensions; if the master card is later revised, this line still
   *   records what was agreed.
   * - `designKey` — an advisory structural fingerprint
   *   (`convex/model/orderToShip/designSpecification.ts`). Stored, not recomputed
   *   on read, because it is what the design-matching index is built on.
   * - `designSource` plus `masterCardRevisionId` — the decision and its
   *   consequence. `EXISTING` pins a released revision at the moment the line was
   *   written; `NEW` leaves the pin empty and puts a `designRequests` row in front
   *   of engineering.
   *
   * There is no `designRequestId` here, and its absence is deliberate: the link
   * lives once, on `designRequests.customerOrderLineId`, under a uniqueness
   * contract, and is read through `by_orgId_customerOrderLineId`. Storing it on
   * both rows would need the two inserts to be circular — the request needs the
   * line's ID, the line would need the request's — and would give the pair a way
   * to disagree about which request answers which line.
   *
   * `orderedQuantity` is a plain integer count of boxes, deliberately not
   * `signedQuantity`: this is customer demand, not a ledger posting, it is never
   * negative, and it is not counted in an item's UOM because at this point in the
   * flow there is no item yet — the box has not been designed.
   */
  customerOrderLines: defineTable(
    tenantFields({
      customerOrderId: v.id("customerOrders"),
      /** Position within the order. Unique per order by contract. */
      lineNumber: v.number(),
      /** Customer-owned identity used for automatic exact reuse. */
      customerProductCode: v.string(),
      specification: boxSpecification,
      /** Derived from `specification`; used for bounded similarity lookup only. */
      designKey: v.string(),
      designSource,
      status: customerOrderLineStatus,
      /** Whole boxes. Positive; never a ledger quantity. */
      orderedQuantity: v.number(),
      /** The released revision this line pins. Absent until design is ready. */
      masterCardRevisionId: v.optional(v.id("masterCardRevisions")),
    }),
  )
    .index(
      "by_orgId_customerOrderId_lineNumber",
      byOrg("customerOrderId", "lineNumber"),
    )
    .index(
      "by_orgId_customerOrderId_status",
      byOrg("customerOrderId", "status"),
    )
    .index("by_orgId_status_designKey", byOrg("status", "designKey")),

  /* ------------------------------------------------------------------------ */
  /* Order to ship — engineering (Phase 5A)                                    */
  /* ------------------------------------------------------------------------ */

  /**
   * Work engineering owes on one order line (`G-123`).
   *
   * One request per line, by contract, because the thing being asked for is "a
   * released design for this line" and a second request for the same line would
   * be two people waiting on one drawing with no way to tell which one the
   * eventual revision answered.
   *
   * The line is the source of truth for customer, product, fingerprint, and
   * specification. Repeating those attributes here would create the transitive
   * dependency `designRequest -> customerOrderLine -> requested design` and let
   * the two rows drift. Engineering queries join the line and its order inside
   * the tenant boundary; callers still need only engineering permissions.
   */
  designRequests: defineTable(
    tenantFields({
      /** Tenant's normalized request number. Unique per organization by contract. */
      requestNumber: v.string(),
      /** Unique per organization by contract: one open ask per line. */
      customerOrderLineId: v.id("customerOrderLines"),
      status: designRequestStatus,
      priority: designRequestPriority,
      dueAt: v.optional(v.number()),
      /** Who owes the drawing. Absent while the request is `OPEN`. */
      assignedToUserId: v.optional(v.id("users")),
      /** The released revision that answered it. Set when `FULFILLED`. */
      masterCardRevisionId: v.optional(v.id("masterCardRevisions")),
      /** Present only when a person explicitly accepted a similar design. */
      similarityConfirmation: v.optional(
        v.object({
          score: v.number(),
          reason: v.string(),
          confirmedByUserId: v.id("users"),
          confirmedAt: v.number(),
        }),
      ),
    }),
  )
    .index("by_orgId_requestNumber", byOrg("requestNumber"))
    .index("by_orgId_customerOrderLineId", byOrg("customerOrderLineId"))
    .index("by_orgId_status_requestNumber", byOrg("status", "requestNumber")),

  /**
   * The identity of one design, across every revision of it (`G-126`).
   *
   * The card is the stable name — "the 300×200×150 RSC we make for Siam Foods" —
   * and holds no specification of its own. Every dimension, grade, and colour
   * count lives on a revision, because a card whose fields could be edited would
   * be a card that silently changes what a released revision claimed.
   *
   * `releasedRevisionId` is a **cache of the current release**, maintained when a
   * revision is released. It is not the source of truth — the revision's own
   * `RELEASED` status is — and it exists so the exact-match lookup a salesperson
   * triggers on every line is one indexed read plus one get, rather than a page
   * through a card's revision history.
   *
   * `customerProductCode` is the authoritative exact identity and is unique per
   * customer. `designKey` is the current revision's structural fingerprint,
   * retained for bounded similarity suggestions only.
   */
  masterCards: defineTable(
    tenantFields({
      /** Tenant's normalized card number. Unique per organization by contract. */
      cardNumber: v.string(),
      customerId: v.id("customers"),
      /** Exact identity within a customer account. */
      customerProductCode: v.string(),
      /** Structural fingerprint for human-confirmed similarity suggestions. */
      designKey: v.string(),
      /** Display name, as engineering writes it (D-06). */
      name: v.string(),
      /** Preserved legacy document/file reference when imported. */
      legacySourceReference: v.optional(v.string()),
      status: masterDataStatus,
      /** The current release, cached for the exact-match lookup. */
      releasedRevisionId: v.optional(v.id("masterCardRevisions")),
    }),
  )
    .index("by_orgId_cardNumber", byOrg("cardNumber"))
    .index(
      "by_orgId_customerId_customerProductCode",
      byOrg("customerId", "customerProductCode"),
    )
    .index("by_orgId_customerId_designKey", byOrg("customerId", "designKey"))
    .index("by_orgId_status_cardNumber", byOrg("status", "cardNumber")),

  /**
   * One version of a design, and the only thing a factory packet may pin
   * (`G-127`).
   *
   * A `RELEASED` row is **immutable in every field except `supersededByRevisionId`**
   * (`INV-0013-02`). That single exception records that a later revision now
   * exists; it changes no dimension, no grade, and no file, so a packet issued
   * against this revision describes exactly the same box it described the day it
   * was printed. Changing a released specification means a *new* revision with a
   * new number, reviewed on its own merits.
   *
   * The three actor fields are the maker-checker record, kept here as well as in
   * `auditEvents` because the separation-of-duties check reads them inside the
   * same transaction that enforces it: `authoredByUserId` and `submittedByUserId`
   * are the makers, `decidedByUserId` is the checker, and
   * `convex/model/orderToShip/masterCardRevision.ts` refuses a decider who is
   * either maker. Deriving the makers from the audit trail on every decision would
   * make the rule depend on a read of an append-only table that is written for
   * humans, not for policy.
   *
   * Revision numbers are gap-free from 1 and never reused, including after a
   * rejection. "Rev 3" has to name one document forever, because it gets written
   * on paper on a factory floor.
   */
  masterCardRevisions: defineTable(
    tenantFields({
      masterCardId: v.id("masterCards"),
      /** Gap-free from 1. Unique per card by contract; never reused. */
      revisionNumber: v.number(),
      status: masterCardRevisionStatus,
      specification: boxSpecification,
      /** Derived from `specification`; recorded so a release can index the card. */
      designKey: v.string(),
      /** The maker. Refused as decider (`INV-0013-03`). */
      authoredByUserId: v.id("users"),
      /** The second maker, when a lead submits somebody else's draft. */
      submittedByUserId: v.optional(v.id("users")),
      /** The checker. Set exactly when the revision leaves `IN_REVIEW`. */
      decidedByUserId: v.optional(v.id("users")),
      decidedAt: v.optional(v.number()),
      /** Why it was approved or rejected, in the reviewer's own words. */
      decisionNote: v.optional(v.string()),
      /** Set when a later revision is released. The only patch a release takes. */
      supersededByRevisionId: v.optional(v.id("masterCardRevisions")),
      legacySourceReference: v.optional(v.string()),
    }),
  )
    .index(
      "by_orgId_masterCardId_revisionNumber",
      byOrg("masterCardId", "revisionNumber"),
    )
    .index("by_orgId_masterCardId_status", byOrg("masterCardId", "status"))
    .index("by_orgId_status_masterCardId", byOrg("status", "masterCardId")),

  /**
   * A dieline, artwork file, or photo attached to one revision (`G-128`).
   *
   * This row owns the tenant-scoped metadata and the private storage reference.
   * `AVAILABLE` is written only after the adapter resolves the object; metadata
   * without retrievable bytes cannot satisfy review or packet issue.
   *
   * Files are private, and privacy here is a permission decision made on **every
   * access**, not a property of a link. `engineering.file.read` is checked at each
   * request and each request is audited, because a signed URL that has escaped is
   * a permission check that happened once, months ago, for somebody who may since
   * have left.
   */
  masterCardFiles: defineTable(
    tenantFields({
      masterCardRevisionId: v.id("masterCardRevisions"),
      /** Tenant's normalized key for the file. Unique per revision by contract. */
      fileKey: v.string(),
      /** The name a person recognises, as uploaded (D-06). */
      fileName: v.string(),
      kind: masterCardFileKind,
      /** Declared MIME type. Unverified until an adapter reads the bytes. */
      contentType: v.string(),
      /** Declared size in bytes. Unverified for the same reason. */
      byteSize: v.number(),
      /** Lowercase hex SHA-256 the uploader declared, for later verification. */
      contentDigest: v.string(),
      storageId: v.optional(v.id("_storage")),
      verifiedAt: v.optional(v.number()),
      storageState: masterCardFileStorageState,
      attachedByUserId: v.id("users"),
    }),
  )
    .index(
      "by_orgId_masterCardRevisionId_fileKey",
      byOrg("masterCardRevisionId", "fileKey"),
    )
    .index(
      "by_orgId_masterCardRevisionId_storageState",
      byOrg("masterCardRevisionId", "storageState"),
    ),

  /** One-use tenant/revision binding for a private upload authorization. */
  masterCardUploadGrants: defineTable(
    tenantFields({
      masterCardRevisionId: v.optional(v.id("masterCardRevisions")),
      batchRef: v.optional(v.string()),
      sourceRow: v.optional(v.number()),
      authorizedByUserId: v.id("users"),
      expiresAt: v.number(),
      uploadStartedAt: v.optional(v.number()),
      consumedStorageId: v.optional(v.id("_storage")),
      consumedAt: v.optional(v.number()),
      attachedAt: v.optional(v.number()),
    }),
  )
    .index("by_orgId_expiresAt", byOrg("expiresAt"))
    .index(
      "by_orgId_masterCardRevisionId_expiresAt",
      byOrg("masterCardRevisionId", "expiresAt"),
    )
    .index(
      "by_orgId_batchRef_sourceRow_expiresAt",
      byOrg("batchRef", "sourceRow", "expiresAt"),
    ),

  /** One-use short-lived capability minted after an audited permission check. */
  masterCardFileAccessGrants: defineTable(
    tenantFields({
      masterCardFileId: v.id("masterCardFiles"),
      issuedToUserId: v.id("users"),
      expiresAt: v.number(),
      consumedAt: v.optional(v.number()),
    }),
  ).index(
    "by_orgId_masterCardFileId_expiresAt",
    byOrg("masterCardFileId", "expiresAt"),
  ),

  /** Durable cursor/evidence for one applied legacy master-card import chunk. */
  masterCardImportChunks: defineTable(
    tenantFields({
      batchRef: v.string(),
      startSourceRow: v.number(),
      nextSourceRow: v.number(),
      importedCount: v.number(),
      releasedCount: v.number(),
      draftCount: v.number(),
      importedByUserId: v.id("users"),
      completedAt: v.number(),
    }),
  )
    .index(
      "by_orgId_batchRef_startSourceRow",
      byOrg("batchRef", "startSourceRow"),
    )
    .index(
      "by_orgId_batchRef_nextSourceRow",
      byOrg("batchRef", "nextSourceRow"),
    ),

  /* ------------------------------------------------------------------------ */
  /* Order to ship — production hand-off (Phase 5A)                            */
  /* ------------------------------------------------------------------------ */

  /**
   * The one document that crosses from the office to the shop floor (`G-129`).
   *
   * A packet pins exactly one released revision by id. Production queries resolve
   * the immutable revision, order line, and order inside the tenant boundary and
   * return the same floor-facing projection. Keeping those values only on their
   * authoritative rows avoids transitive dependencies while preserving narrow
   * production permissions at the public function boundary.
   *
   * `warehouseId` names the production site. This is provisional: `WF-03` — how
   * production sites are modelled against warehouses — is open, and reusing
   * `warehouses` is the honest smallest thing that works today, because the
   * permission scope machinery already understands it (`ADR-0013` §4). If sites
   * turn out to be distinct, this field is the migration.
   *
   * One packet per order line, by contract. Splitting a line across production
   * runs is a factory-order concern (`WF-02`, Phase 5B), and a table that allowed
   * many packets per line without anything to reconcile them against would let a
   * line be built twice.
   */
  factoryPackets: defineTable(
    tenantFields({
      /** The production site. Provisional per `WF-03`. */
      warehouseId: v.id("warehouses"),
      /** Tenant's normalized packet number. Unique per organization by contract. */
      packetNumber: v.string(),
      /** Unique per organization by contract: one packet per line. */
      customerOrderLineId: v.id("customerOrderLines"),
      /** The pinned release. Never changes for the life of the packet. */
      masterCardRevisionId: v.id("masterCardRevisions"),
      status: factoryPacketStatus,
      issuedByUserId: v.id("users"),
      acknowledgedByUserId: v.optional(v.id("users")),
      acknowledgedAt: v.optional(v.number()),
    }),
  )
    .index("by_orgId_packetNumber", byOrg("packetNumber"))
    .index("by_orgId_customerOrderLineId", byOrg("customerOrderLineId"))
    .index(
      "by_orgId_warehouseId_status_packetNumber",
      byOrg("warehouseId", "status", "packetNumber"),
    ),

  /**
   * Files approved for one factory packet.
   *
   * One row per packet/file relationship keeps the packet in first normal form,
   * makes membership independently indexable, and freezes the exact file set
   * approved at issue time without embedding a repeating group.
   */
  factoryPacketFiles: defineTable(
    tenantFields({
      factoryPacketId: v.id("factoryPackets"),
      masterCardFileId: v.id("masterCardFiles"),
    }),
  )
    .index(
      "by_orgId_factoryPacketId_masterCardFileId",
      byOrg("factoryPacketId", "masterCardFileId"),
    )
    .index(
      "by_orgId_masterCardFileId_factoryPacketId",
      byOrg("masterCardFileId", "factoryPacketId"),
    ),
});

export default schema;

/**
 * The data model these declarations describe.
 *
 * Named here because there is no `convex/_generated/`: nothing has been deployed,
 * so this is the only place a document or ID type can come from and still be the
 * real one. Modules that need `Doc`/`Id`-shaped types derive them from this
 * (`convex/lib/tenantContext.ts`), rather than restating field lists that would
 * then be free to drift from the schema above.
 *
 * When Convex codegen exists, this alias is what it replaces.
 */
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
