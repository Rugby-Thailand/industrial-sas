import type { DocumentByName, UserIdentity } from "convex/server";
import type { GenericId } from "convex/values";

import type { DataModel } from "../schema";
import type {
  MembershipStatus,
  OrganizationStatus,
  UserStatus,
  WarehouseStatus,
} from "./validators";

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

export const ACTIVE_ORGANIZATION_CLAIM = "o.id";
export const LEGACY_ACTIVE_ORGANIZATION_CLAIM = "org_id";
const CLERK_V2_ORGANIZATION_CLAIM = "o";

export const MAX_EXTERNAL_REFERENCE_LENGTH = 128;

export const MAX_REQUEST_ID_LENGTH = 64;

export const TENANT_CONTEXT_DENIAL_MESSAGE =
  "This request was denied. Quote the request ID when asking for help.";

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

export type TenantContextDenial = {
  readonly code: TenantContextDenialCode;
  readonly cause: TenantContextDenialCause;
  readonly requestId: string;
};

export type PublicTenantContextDenial = {
  readonly kind: "TENANT_CONTEXT_DENIED";
  readonly code: TenantContextDenialCode;
  readonly requestId: string;
  readonly message: string;
};

export type TenantContextLookups = {
  readonly findUserByClerkUserId: (
    clerkUserId: string,
  ) => Promise<UserDocument | null>;

  readonly findOrganizationByClerkOrganizationId: (
    clerkOrganizationId: string,
  ) => Promise<OrganizationDocument | null>;

  readonly findMembershipByOrganizationAndUser: (input: {
    readonly orgId: OrganizationId;
    readonly userId: UserId;
  }) => Promise<MembershipDocument | null>;

  readonly findWarehouseByOrganizationAndId: (input: {
    readonly orgId: OrganizationId;
    readonly warehouseId: WarehouseId;
  }) => Promise<WarehouseDocument | null>;

  readonly findMembershipWarehouse: (input: {
    readonly orgId: OrganizationId;
    readonly membershipId: MembershipId;
    readonly warehouseId: WarehouseId;
  }) => Promise<MembershipWarehouseDocument | null>;
};

export type ResolveTenantContextInput = {
  readonly requestId: string;

  readonly identity: UserIdentity | null;

  readonly warehouseId?: WarehouseId;

  readonly lookups: TenantContextLookups;
};

export type ActiveTenantContext = {
  readonly requestId: string;
  readonly actor: UserDocument;
  readonly organization: OrganizationDocument;
  readonly membership: MembershipDocument;
  readonly warehouse?: WarehouseDocument;
};

export type TenantContextResult =
  | { readonly ok: true; readonly context: ActiveTenantContext }
  | { readonly ok: false; readonly denial: TenantContextDenial };

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

function boundedReferenceProblem(
  value: string,
  maxLength: number,
): ReferenceProblem | null {
  if (value.trim().length === 0) return "BLANK";
  if (value !== value.trim()) return "UNTRIMMED";
  if (value.length > maxLength) return "TOO_LONG";
  return null;
}

function referenceProblem(value: string): ReferenceProblem | null {
  return boundedReferenceProblem(value, MAX_EXTERNAL_REFERENCE_LENGTH);
}

type ReferenceProblem = "BLANK" | "UNTRIMMED" | "TOO_LONG";

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

  if (identity === null) return deny("ANONYMOUS", "NO_IDENTITY");

  const subject: unknown = identity.subject;
  if (typeof subject !== "string") {
    return deny("IDENTITY_MALFORMED", "SUBJECT_NOT_A_STRING");
  }
  const subjectProblem = referenceProblem(subject);
  if (subjectProblem !== null) {
    return deny("IDENTITY_MALFORMED", SUBJECT_PROBLEM_CAUSE[subjectProblem]);
  }

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

  const actor = await lookups.findUserByClerkUserId(subject);
  if (actor === null) return deny("USER_UNKNOWN", "USER_LOOKUP_EMPTY");
  if (actor.clerkUserId !== subject) {
    return deny("USER_UNKNOWN", "USER_LOOKUP_MISMATCH");
  }
  if (actor.status !== "ACTIVE") {
    return deny("USER_INACTIVE", USER_STATUS_CAUSE[actor.status]);
  }

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

  if (warehouse.orgId !== organization._id) {
    return deny("WAREHOUSE_UNKNOWN", "WAREHOUSE_FOREIGN_ORGANIZATION");
  }
  if (warehouse.status !== "ACTIVE") {
    return deny("WAREHOUSE_INACTIVE", WAREHOUSE_STATUS_CAUSE[warehouse.status]);
  }

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
