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
  denialReason,
  deviceStatus,
  deviceType,
  idempotencyStatus,
  inventoryTransactionSource,
  inventoryTransactionType,
  itemTrackingMode,
  ledgerLocationKind,
  locale,
  locationType,
  masterDataStatus,
  membershipScopeMode,
  membershipStatus,
  organizationSettings,
  organizationStatus,
  permissionScope,
  reasonCodeScope,
  roleStatus,
  sessionsAuditEventType,
  signedQuantity,
  stockStatus,
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
    ),

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
