/**
 * Convex schema — tenant, identity, authorization, audit, idempotency, device,
 * entitlement, and (disabled) support-grant foundation.
 *
 * Status: **schema foundation only.** This file declares tables, fields, and
 * indexes. It declares no behaviour. There is no auth wrapper, no tenant-bound
 * accessor (`G-102`), no Clerk webhook sync, no role seed, no permission
 * evaluation, no inventory, and no deployment. Every guarantee below is a shape
 * the code that lands later must respect; none of it is enforced at runtime yet
 * because there is no runtime.
 *
 * Structure, in three groups:
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
 *    `code`, warehouse `code`, role `key`, idempotency `requestId`, …) has an
 *    index that makes its lookup bounded. Convex has no unique constraint, so
 *    nothing below is enforced by the database and nothing is enforced today:
 *    every "unique" in this file means **unique by contract** — a bounded index
 *    plus the check the future mutation owes on every write. The contracts are
 *    enumerated in `schemaPolicy.ts`, and a bounded index does not by itself
 *    imply uniqueness: some contracts are conditional (`devices.installationId`
 *    is unique per organization *when present*) and some indexed keys are
 *    deliberately many-per-key (`supportGrants.ticketRef`). Which is which is
 *    stated there as data, never left to inference from the index name.
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
 *   configured through `admin.settings.policy.manage`, but nothing in this task
 *   evaluates a policy, so a table here would be invented domain with no reader.
 *   It arrives with the authorization work that needs it.
 * - **No master data beyond warehouse identity.** `warehouses` exists only
 *   because warehouse scope is part of every authorization decision
 *   (`INV-0006-04`). Locations, items, lots, and the rest of §7.2 are later
 *   slices.
 *
 * Baseline: [PROJECT_PLAN.md](../PROJECT_PLAN.md) §7.1, §6.1, §6.2;
 * [ADR-0001](../docs/adr/0001-multi-tenant-saas-and-identity-ownership.md),
 * [ADR-0002](../docs/adr/0002-convex-tenant-boundary-and-index-discipline.md),
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
  locale,
  membershipScopeMode,
  membershipStatus,
  organizationSettings,
  organizationStatus,
  permissionScope,
  roleStatus,
  sessionsAuditEventType,
  supportAccessMode,
  supportGrantStatus,
  userStatus,
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
