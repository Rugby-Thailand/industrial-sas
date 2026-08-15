/**
 * Active tenant context resolution — the single production algorithm that turns a
 * verified Clerk identity into an organization, an actor, an active membership,
 * and (optionally) a warehouse the actor may act in.
 *
 * Status: **pure kernel only.** This module resolves; it does not enforce. It has
 * no Convex runtime dependency beyond types: no `query`/`mutation` builder, no
 * `ctx.db`, no `ConvexError`, no Clerk client, no webhook, no permission
 * evaluation. It is called by nothing yet. The tenant-bound accessor (`G-102`,
 * whose boundary primitives now live in `convex/lib/tenantDb.ts`) and the auth
 * wrapper (`INV-0002-01`) are the next slices, and they are expected to call
 * `resolveTenantContext` — exactly this function — rather than re-deriving any
 * part of it.
 *
 * Why a pure kernel with injected lookups rather than a wrapper that reads
 * `ctx.db` directly: isolation is a property of *this decision sequence*
 * (`ADR-0002` §2), and a decision sequence that can only run inside a Convex
 * transaction can only be tested inside one. Injecting five named lookups makes
 * every branch — including the ones a real database would never produce, such as
 * a lookup that answers with another tenant's document — reachable from a
 * deterministic in-memory fake. The wrapper that lands later supplies
 * index-backed implementations of the same five lookups; the algorithm does not
 * change shape when it does.
 *
 * The rules this module implements, and where they come from:
 *
 * 1. **The caller supplies no `orgId`** (`INV-0001-02`, plan §6.1). There is no
 *    `orgId` parameter anywhere in this file's input. The active organization is
 *    derived from the verified identity's active-organization claim
 *    ([INT-01](../../docs/integration-contracts/clerk-identity.md) §2) and then
 *    resolved to a Convex document by lookup — "mapping to internal IDs is a
 *    Convex lookup, not a claim" (INT-01 §3).
 * 2. **The actor is the verified subject** (`sub`), never a claim about who the
 *    caller would like to be.
 * 3. **Membership is rechecked on every call** (`INV-0001-03`), against the
 *    mirror, so revocation is observable in the same transaction as the operation
 *    it must block.
 * 4. **A warehouse is never accepted because its ID parses.** The document must
 *    exist, belong to the resolved organization, be `ACTIVE`, and be inside the
 *    membership's scope — either `ORG_WIDE` (the schema's explicit
 *    all-warehouse representation, `memberships.scopeMode`) or an explicit
 *    `membershipWarehouses` row (`INV-0002-03`, `INV-0006-04`).
 * 5. **Denials are structured, generic, and correlated** (`INV-0002-07`). One
 *    public message for every denial, a stable coarse code, the request ID, and
 *    nothing else. The internal cause survives as a non-PII enum member for
 *    server-side audit, and is not part of the public payload.
 *
 * Deliberately **not** decided here, so that no caller mistakes this for the
 * whole check:
 *
 * - **No permission evaluation.** Roles, permission codes, step-up, maker-checker,
 *   thresholds, and entitlements are `ADR-0006` work. A resolved context means
 *   "this actor is legitimately inside this tenant (and warehouse)", never "this
 *   actor may perform the operation".
 * - **No membership effective-period evaluation.** `memberships.effectiveFrom` /
 *   `effectiveTo` are a time decision, and this kernel takes no clock: a pure
 *   function that reads the wall clock is neither pure nor testable. Period
 *   evaluation lands with the authorization slice that already needs a clock for
 *   step-up freshness. Until then `status` is the only membership gate, and that
 *   is stated rather than implied.
 * - **No support-grant path.** Cross-tenant support access is disabled by
 *   organization policy (`ADR-0006` §7); there is no branch here that could
 *   resolve a context for an organization the actor has no membership in.
 * - **No `ConvexError` construction.** `toPublicDenial` produces the payload and
 *   stops. The throwing happens in the Convex layer that owns the transport.
 *
 * Baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §6.1, §6.2, §7.1;
 * [ADR-0001](../../docs/adr/0001-multi-tenant-saas-and-identity-ownership.md),
 * [ADR-0002](../../docs/adr/0002-convex-tenant-boundary-and-index-discipline.md),
 * [INT-01](../../docs/integration-contracts/clerk-identity.md).
 */
import type { DocumentByName, UserIdentity } from "convex/server";
import type { GenericId } from "convex/values";

import type { DataModel } from "../schema";
import type {
  MembershipStatus,
  OrganizationStatus,
  UserStatus,
  WarehouseStatus,
} from "./validators";

/* -------------------------------------------------------------------------- */
/* Schema-derived types (no generated code)                                    */
/* -------------------------------------------------------------------------- */

/*
 * The document and ID types below come from `convex/schema.ts`'s exported
 * `DataModel`, not from hand-written field lists: a context that carried a
 * look-alike `OrganizationDocument` would compile long after the schema had moved
 * on. There is no `convex/_generated/` to import from — nothing has been deployed
 * — so this derivation is what stands in for codegen, and it is the only thing
 * that has to change when codegen arrives.
 */

export type OrganizationDocument = DocumentByName<DataModel, "organizations">;
export type UserDocument = DocumentByName<DataModel, "users">;
export type MembershipDocument = DocumentByName<DataModel, "memberships">;
export type WarehouseDocument = DocumentByName<DataModel, "warehouses">;
export type MembershipWarehouseDocument = DocumentByName<
  DataModel,
  "membershipWarehouses"
>;

export type OrganizationId = GenericId<"organizations">;
export type UserId = GenericId<"users">;
export type MembershipId = GenericId<"memberships">;
export type WarehouseId = GenericId<"warehouses">;

/* -------------------------------------------------------------------------- */
/* Claim and input bounds                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The verified-token claim naming the caller's active Clerk organization.
 *
 * Named once, here, because it is the hinge of tenant selection: two spellings of
 * this string in two files is a silent "no active organization" for one of them.
 * The claim is read from the identity Convex has already verified — a claim is
 * trusted only after verification (INT-01 §2) — and its value is an *external*
 * correlation key that is worth nothing on its own: it selects a row through
 * `organizations.by_clerkOrganizationId`, and the row is what the context
 * carries.
 *
 * Clerk v2 session tokens carry this value at `o.id`. The older `org_id` claim
 * remains accepted during migration because Clerk v1 tokens can still exist in
 * an upgraded development instance until sessions refresh. The v2 claim always
 * wins when both are present; no custom JWT-template claim is required.
 */
export const ACTIVE_ORGANIZATION_CLAIM = "o.id";
export const LEGACY_ACTIVE_ORGANIZATION_CLAIM = "org_id";
const CLERK_V2_ORGANIZATION_CLAIM = "o";

/**
 * Length bound on an external provider reference (the subject and the
 * active-organization claim).
 *
 * Clerk's identifiers are far shorter. The bound exists so a hostile or corrupt
 * token cannot turn a lookup argument into an unbounded string, and it is
 * deliberately not a format check: the shape of a Clerk ID is Clerk's to change,
 * and a resolver that rejects tomorrow's format would fail closed for every
 * tenant at once.
 */
export const MAX_EXTERNAL_REFERENCE_LENGTH = 128;

/** Length bound on the server-minted request ID (a UUIDv7 in practice, plan §7.4). */
export const MAX_REQUEST_ID_LENGTH = 64;

/* -------------------------------------------------------------------------- */
/* Denials                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The one message any denial from this module may show a caller.
 *
 * Deliberately uninformative and identical across every code: the client learns
 * *that* it was denied and which request to quote. Everything actionable is
 * server-side, keyed by the request ID (`INV-0002-07`).
 */
export const TENANT_CONTEXT_DENIAL_MESSAGE =
  "This request was denied. Quote the request ID when asking for help.";

/**
 * The coarse, stable, PII-free denial codes.
 *
 * Coarse on purpose. `WAREHOUSE_UNKNOWN` covers both "no such warehouse" and
 * "that warehouse belongs to another tenant", because distinguishing them would
 * make this function an existence oracle over other tenants' IDs — the leak the
 * isolation tier exists to prevent. The finer distinction survives internally as
 * a `TenantContextDenialCause`.
 *
 * These codes are part of the public contract: renaming one is a client-visible
 * change, in the same way a permission code is (D-22).
 */
export const TENANT_CONTEXT_DENIAL_CODES = [
  "ANONYMOUS",
  "IDENTITY_MALFORMED",
  "ACTIVE_ORGANIZATION_MISSING",
  "ACTIVE_ORGANIZATION_MALFORMED",
  "USER_UNKNOWN",
  "USER_INACTIVE",
  "ORGANIZATION_UNKNOWN",
  "ORGANIZATION_INACTIVE",
  "MEMBERSHIP_MISSING",
  "MEMBERSHIP_INACTIVE",
  "WAREHOUSE_UNKNOWN",
  "WAREHOUSE_INACTIVE",
  "WAREHOUSE_OUT_OF_SCOPE",
] as const;

export type TenantContextDenialCode =
  (typeof TENANT_CONTEXT_DENIAL_CODES)[number];

/**
 * The internal cause of a denial: the detail an operator needs, reduced to a
 * closed set of enum members so that recording it can never record a value.
 *
 * Every member names a *reason*, never data. There is no member that could carry
 * a subject, a claim, an ID, a name, or a lookup argument, because the type is a
 * union of literals — a leak here would have to be a new literal, which is a
 * visible diff.
 *
 * `*_LOOKUP_MISMATCH` members exist because a lookup port is an interface, not a
 * promise: the algorithm re-verifies that each answer is the document it asked
 * for. A wrong answer is treated as a denial, never as the caller's document.
 */
export const TENANT_CONTEXT_DENIAL_CAUSES = [
  "NO_IDENTITY",
  "SUBJECT_BLANK",
  "SUBJECT_UNTRIMMED",
  "SUBJECT_TOO_LONG",
  "SUBJECT_NOT_A_STRING",
  "CLAIM_ABSENT",
  "CLAIM_NOT_A_STRING",
  "CLAIM_BLANK",
  "CLAIM_UNTRIMMED",
  "CLAIM_TOO_LONG",
  "USER_LOOKUP_EMPTY",
  "USER_LOOKUP_MISMATCH",
  "USER_STATUS_DEACTIVATED",
  "ORGANIZATION_LOOKUP_EMPTY",
  "ORGANIZATION_LOOKUP_MISMATCH",
  "ORGANIZATION_STATUS_SUSPENDED",
  "ORGANIZATION_STATUS_CLOSED",
  "MEMBERSHIP_LOOKUP_EMPTY",
  "MEMBERSHIP_LOOKUP_MISMATCH",
  "MEMBERSHIP_STATUS_SUSPENDED",
  "MEMBERSHIP_STATUS_REVOKED",
  "WAREHOUSE_LOOKUP_EMPTY",
  "WAREHOUSE_LOOKUP_MISMATCH",
  "WAREHOUSE_FOREIGN_ORGANIZATION",
  "WAREHOUSE_STATUS_INACTIVE",
  "WAREHOUSE_SCOPE_ROW_ABSENT",
  "WAREHOUSE_SCOPE_ROW_MISMATCH",
] as const;

export type TenantContextDenialCause =
  (typeof TENANT_CONTEXT_DENIAL_CAUSES)[number];

/**
 * An internal denial. Three fields, all of them safe to log: a code, a cause,
 * and the request that produced them.
 */
export type TenantContextDenial = {
  readonly code: TenantContextDenialCode;
  readonly cause: TenantContextDenialCause;
  readonly requestId: string;
};

/** The payload of a denial as a client may see it. Nothing else may be added. */
export type PublicTenantContextDenial = {
  readonly kind: "TENANT_CONTEXT_DENIED";
  readonly code: TenantContextDenialCode;
  readonly requestId: string;
  readonly message: string;
};

/* -------------------------------------------------------------------------- */
/* Lookup port                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The bounded lookups tenant resolution is allowed to perform.
 *
 * Five methods, each answering with at most one document, and each named for the
 * bounded read that serves it. There is deliberately no `db`, no `query`, no
 * `getById`, and no way to express a scan, a `.filter()`, or a `collect()`
 * through this type (`INV-0002-04`, `ADR-0002` §5): an implementation that wanted
 * to scan would have to do it behind one of these names, which is a reviewable
 * lie rather than an available shortcut.
 *
 * The org-scoped signatures are not a convenience either. `findWarehouseById`
 * would have to be followed by an `orgId` comparison the caller could forget;
 * `findWarehouseByOrganizationAndId` cannot be called without a resolved
 * organization in hand — and the answer is still re-verified below.
 *
 * Backing read for each method, for the implementation that lands with the
 * wrapper. Four are index lookups; the warehouse one is a document read followed
 * by an `orgId` equality check, because a document ID needs no index — which is
 * exactly why the re-verification below is not optional:
 *
 * | Method                                  | Backing read                                             |
 * | --------------------------------------- | -------------------------------------------------------- |
 * | `findUserByClerkUserId`                 | `users.by_clerkUserId`                                   |
 * | `findOrganizationByClerkOrganizationId` | `organizations.by_clerkOrganizationId`                   |
 * | `findMembershipByOrganizationAndUser`   | `memberships.by_orgId_userId`                            |
 * | `findWarehouseByOrganizationAndId`      | document read, then `orgId` equality (no index)          |
 * | `findMembershipWarehouse`               | `membershipWarehouses.by_orgId_membershipId_warehouseId` |
 */
export type TenantContextLookups = {
  /** The mirrored global user for a verified Clerk subject, or `null`. */
  readonly findUserByClerkUserId: (
    clerkUserId: string,
  ) => Promise<UserDocument | null>;

  /** The tenant mirroring a Clerk organization, or `null`. */
  readonly findOrganizationByClerkOrganizationId: (
    clerkOrganizationId: string,
  ) => Promise<OrganizationDocument | null>;

  /** The single membership of this user in this organization, or `null`. */
  readonly findMembershipByOrganizationAndUser: (input: {
    readonly orgId: OrganizationId;
    readonly userId: UserId;
  }) => Promise<MembershipDocument | null>;

  /** The named warehouse *within this organization*, or `null`. */
  readonly findWarehouseByOrganizationAndId: (input: {
    readonly orgId: OrganizationId;
    readonly warehouseId: WarehouseId;
  }) => Promise<WarehouseDocument | null>;

  /** The explicit scope row granting this membership this warehouse, or `null`. */
  readonly findMembershipWarehouse: (input: {
    readonly orgId: OrganizationId;
    readonly membershipId: MembershipId;
    readonly warehouseId: WarehouseId;
  }) => Promise<MembershipWarehouseDocument | null>;
};

/* -------------------------------------------------------------------------- */
/* Input and output                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Everything resolution needs. Note what is absent: `orgId`
 * (`INV-0001-02`), any role, any permission, and any status.
 *
 * `warehouseId` is the one client-influenced value, and its type is not its
 * check: a `GenericId` is a branded string, not a proof of existence, ownership,
 * or scope. Every one of those is verified below.
 */
export type ResolveTenantContextInput = {
  /** Server-minted correlation ID for this request (plan §7.4). */
  readonly requestId: string;
  /** The already-verified identity, or `null` when the caller is anonymous. */
  readonly identity: UserIdentity | null;
  /** The warehouse the operation targets, when it targets one. */
  readonly warehouseId?: WarehouseId;
  /** The bounded lookups this resolution may use. */
  readonly lookups: TenantContextLookups;
};

/**
 * A resolved active tenant context: the documents every later decision is made
 * against, and the request they belong to.
 *
 * Documents, not IDs, because the alternative is re-reading them — and a second
 * read is a second chance to read the wrong tenant's row. Frozen, because a
 * downstream wrapper that could reassign `organization` would be able to undo the
 * resolution it just paid for.
 */
export type ActiveTenantContext = {
  readonly requestId: string;
  readonly actor: UserDocument;
  readonly organization: OrganizationDocument;
  readonly membership: MembershipDocument;
  readonly warehouse?: WarehouseDocument;
};

/** Resolution succeeds with a context or fails with a denial. Never both. */
export type TenantContextResult =
  | { readonly ok: true; readonly context: ActiveTenantContext }
  | { readonly ok: false; readonly denial: TenantContextDenial };

/* -------------------------------------------------------------------------- */
/* Status-to-cause maps                                                        */
/* -------------------------------------------------------------------------- */

/*
 * One map per lifecycle, keyed by the non-`ACTIVE` members of the closed union in
 * `validators.ts`. A `Record<Exclude<Status, "ACTIVE">, …>` makes a new status a
 * compile error here rather than a status that silently resolves.
 */

const USER_STATUS_CAUSE: Record<
  Exclude<UserStatus, "ACTIVE">,
  TenantContextDenialCause
> = { DEACTIVATED: "USER_STATUS_DEACTIVATED" };

const ORGANIZATION_STATUS_CAUSE: Record<
  Exclude<OrganizationStatus, "ACTIVE">,
  TenantContextDenialCause
> = {
  SUSPENDED: "ORGANIZATION_STATUS_SUSPENDED",
  CLOSED: "ORGANIZATION_STATUS_CLOSED",
};

const MEMBERSHIP_STATUS_CAUSE: Record<
  Exclude<MembershipStatus, "ACTIVE">,
  TenantContextDenialCause
> = {
  SUSPENDED: "MEMBERSHIP_STATUS_SUSPENDED",
  REVOKED: "MEMBERSHIP_STATUS_REVOKED",
};

const WAREHOUSE_STATUS_CAUSE: Record<
  Exclude<WarehouseStatus, "ACTIVE">,
  TenantContextDenialCause
> = { INACTIVE: "WAREHOUSE_STATUS_INACTIVE" };

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Whether a string is a usable external reference: present, not blank, not
 * padded, and bounded.
 *
 * Untrimmed values are rejected rather than trimmed. Normalizing here would mean
 * `"org_1"` and `" org_1"` select the same tenant, which makes the mirror's
 * uniqueness contract depend on this function agreeing with every writer of the
 * mirror. Rejecting keeps one spelling of one key.
 */
function boundedReferenceProblem(
  value: string,
  maxLength: number,
): ReferenceProblem | null {
  if (value.trim().length === 0) return "BLANK";
  if (value !== value.trim()) return "UNTRIMMED";
  if (value.length > maxLength) return "TOO_LONG";
  return null;
}

/** The same check at the bound that applies to a provider reference. */
function referenceProblem(value: string): ReferenceProblem | null {
  return boundedReferenceProblem(value, MAX_EXTERNAL_REFERENCE_LENGTH);
}

/** What can be wrong with an external reference string. */
type ReferenceProblem = "BLANK" | "UNTRIMMED" | "TOO_LONG";

/*
 * The problem-to-cause maps are written out rather than composed from a template
 * string, so every cause member in this file is a literal that can be found by
 * search.
 */

const SUBJECT_PROBLEM_CAUSE: Record<
  ReferenceProblem,
  TenantContextDenialCause
> = {
  BLANK: "SUBJECT_BLANK",
  UNTRIMMED: "SUBJECT_UNTRIMMED",
  TOO_LONG: "SUBJECT_TOO_LONG",
};

const CLAIM_PROBLEM_CAUSE: Record<ReferenceProblem, TenantContextDenialCause> =
  {
    BLANK: "CLAIM_BLANK",
    UNTRIMMED: "CLAIM_UNTRIMMED",
    TOO_LONG: "CLAIM_TOO_LONG",
  };

/** Read Clerk's v2 `o.id` shape, with a bounded v1 migration fallback. */
function activeOrganizationClaim(identity: UserIdentity): unknown {
  const version2: unknown = identity[CLERK_V2_ORGANIZATION_CLAIM];
  if (version2 !== undefined && version2 !== null) {
    if (
      typeof version2 === "object" &&
      !Array.isArray(version2) &&
      "id" in version2
    ) {
      return (version2 as { readonly id?: unknown }).id;
    }
    return version2;
  }
  return identity[LEGACY_ACTIVE_ORGANIZATION_CLAIM];
}

/**
 * Resolve a verified identity to an active tenant context.
 *
 * The order of the checks is part of the design: identity before claim, claim
 * before lookup, organization and actor before membership, membership before
 * warehouse. Nothing is looked up on behalf of an actor who has not been
 * resolved, and no warehouse is considered before there is a membership to judge
 * it against.
 *
 * Throws only for a defective `requestId`. That is not a denial: the request ID
 * is minted server-side, so an invalid one is a bug in the caller, and it is also
 * the single field a denial cannot omit (`INV-0002-07`). Returning a denial with
 * no usable correlation would be worse than failing loudly, and echoing the bad
 * value into the denial would be exactly the leak this module refuses elsewhere —
 * so the thrown message reports its length and nothing else.
 */
export async function resolveTenantContext(
  input: ResolveTenantContextInput,
): Promise<TenantContextResult> {
  const { requestId, identity, warehouseId, lookups } = input;

  const requestIdProblem = boundedReferenceProblem(
    requestId,
    MAX_REQUEST_ID_LENGTH,
  );
  if (requestIdProblem !== null) {
    throw new Error(
      "resolveTenantContext() received an unusable requestId " +
        `(${requestIdProblem}, length ${String(requestId.length)}). ` +
        "The request ID is minted server-side and every denial must carry it; " +
        "its value is not repeated here.",
    );
  }

  const deny = (
    code: TenantContextDenialCode,
    cause: TenantContextDenialCause,
  ): TenantContextResult =>
    Object.freeze({
      ok: false as const,
      denial: Object.freeze({ code, cause, requestId }),
    });

  /* -- identity ----------------------------------------------------------- */

  if (identity === null) return deny("ANONYMOUS", "NO_IDENTITY");

  // Read as `unknown`: the declared type says `string`, but the value arrives
  // from a token, and a resolver that trusts a declaration about untrusted input
  // is trusting the wrong thing.
  const subject: unknown = identity.subject;
  if (typeof subject !== "string") {
    return deny("IDENTITY_MALFORMED", "SUBJECT_NOT_A_STRING");
  }
  const subjectProblem = referenceProblem(subject);
  if (subjectProblem !== null) {
    return deny("IDENTITY_MALFORMED", SUBJECT_PROBLEM_CAUSE[subjectProblem]);
  }

  /* -- active organization claim ------------------------------------------ */

  const claim = activeOrganizationClaim(identity);
  if (claim === undefined || claim === null) {
    return deny("ACTIVE_ORGANIZATION_MISSING", "CLAIM_ABSENT");
  }
  if (typeof claim !== "string") {
    return deny("ACTIVE_ORGANIZATION_MALFORMED", "CLAIM_NOT_A_STRING");
  }
  const claimProblem = referenceProblem(claim);
  if (claimProblem !== null) {
    return deny(
      "ACTIVE_ORGANIZATION_MALFORMED",
      CLAIM_PROBLEM_CAUSE[claimProblem],
    );
  }

  /* -- actor -------------------------------------------------------------- */

  const actor = await lookups.findUserByClerkUserId(subject);
  if (actor === null) return deny("USER_UNKNOWN", "USER_LOOKUP_EMPTY");
  if (actor.clerkUserId !== subject) {
    return deny("USER_UNKNOWN", "USER_LOOKUP_MISMATCH");
  }
  if (actor.status !== "ACTIVE") {
    return deny("USER_INACTIVE", USER_STATUS_CAUSE[actor.status]);
  }

  /* -- organization ------------------------------------------------------- */

  const organization =
    await lookups.findOrganizationByClerkOrganizationId(claim);
  if (organization === null) {
    return deny("ORGANIZATION_UNKNOWN", "ORGANIZATION_LOOKUP_EMPTY");
  }
  if (organization.clerkOrganizationId !== claim) {
    return deny("ORGANIZATION_UNKNOWN", "ORGANIZATION_LOOKUP_MISMATCH");
  }
  if (organization.status !== "ACTIVE") {
    return deny(
      "ORGANIZATION_INACTIVE",
      ORGANIZATION_STATUS_CAUSE[organization.status],
    );
  }

  /* -- membership --------------------------------------------------------- */

  const membership = await lookups.findMembershipByOrganizationAndUser({
    orgId: organization._id,
    userId: actor._id,
  });
  if (membership === null) {
    return deny("MEMBERSHIP_MISSING", "MEMBERSHIP_LOOKUP_EMPTY");
  }
  if (
    membership.orgId !== organization._id ||
    membership.userId !== actor._id
  ) {
    return deny("MEMBERSHIP_MISSING", "MEMBERSHIP_LOOKUP_MISMATCH");
  }
  if (membership.status !== "ACTIVE") {
    return deny(
      "MEMBERSHIP_INACTIVE",
      MEMBERSHIP_STATUS_CAUSE[membership.status],
    );
  }

  /* -- warehouse (optional) ----------------------------------------------- */

  if (warehouseId === undefined) {
    return Object.freeze({
      ok: true as const,
      context: Object.freeze({
        requestId,
        actor,
        organization,
        membership,
      }),
    });
  }

  const warehouse = await lookups.findWarehouseByOrganizationAndId({
    orgId: organization._id,
    warehouseId,
  });
  if (warehouse === null) {
    return deny("WAREHOUSE_UNKNOWN", "WAREHOUSE_LOOKUP_EMPTY");
  }
  if (warehouse._id !== warehouseId) {
    return deny("WAREHOUSE_UNKNOWN", "WAREHOUSE_LOOKUP_MISMATCH");
  }
  // A foreign warehouse is denied as *unknown*, on purpose: the caller learns
  // nothing about whether the ID exists in some other tenant (`INV-0002-03`).
  if (warehouse.orgId !== organization._id) {
    return deny("WAREHOUSE_UNKNOWN", "WAREHOUSE_FOREIGN_ORGANIZATION");
  }
  if (warehouse.status !== "ACTIVE") {
    return deny("WAREHOUSE_INACTIVE", WAREHOUSE_STATUS_CAUSE[warehouse.status]);
  }

  // `ORG_WIDE` is the schema's explicit all-warehouse representation. It is a
  // mode rather than "no scope rows means all", so an accidentally empty scope
  // set denies instead of escalating (`validators.ts`, §5 Q13).
  if (membership.scopeMode === "WAREHOUSE_SCOPED") {
    const scope = await lookups.findMembershipWarehouse({
      orgId: organization._id,
      membershipId: membership._id,
      warehouseId: warehouse._id,
    });
    if (scope === null) {
      return deny("WAREHOUSE_OUT_OF_SCOPE", "WAREHOUSE_SCOPE_ROW_ABSENT");
    }
    if (
      scope.orgId !== organization._id ||
      scope.membershipId !== membership._id ||
      scope.warehouseId !== warehouse._id
    ) {
      return deny("WAREHOUSE_OUT_OF_SCOPE", "WAREHOUSE_SCOPE_ROW_MISMATCH");
    }
  }

  return Object.freeze({
    ok: true as const,
    context: Object.freeze({
      requestId,
      actor,
      organization,
      membership,
      warehouse,
    }),
  });
}

/* -------------------------------------------------------------------------- */
/* The one conversion seam                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Convert an internal denial into the payload a client may receive.
 *
 * This is the only sanctioned way to make a denial public, so the question "can
 * this leak?" has one place to be answered. The Convex layer that lands later is
 * expected to do exactly:
 *
 * ```ts
 * throw new ConvexError(toPublicDenial(result.denial));
 * ```
 *
 * and nothing else — no message interpolation, no cause, no context. `cause` is
 * dropped here, not because it carries data (it cannot, it is a literal union)
 * but because it is an internal diagnosis: pairing it with the request ID in an
 * audit row is useful, and handing it to a client is a hint about other tenants'
 * state.
 */
export function toPublicDenial(
  denial: TenantContextDenial,
): PublicTenantContextDenial {
  return Object.freeze({
    kind: "TENANT_CONTEXT_DENIED" as const,
    code: denial.code,
    requestId: denial.requestId,
    message: TENANT_CONTEXT_DENIAL_MESSAGE,
  });
}
