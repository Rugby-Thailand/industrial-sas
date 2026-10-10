import { describe, expect, it } from "vitest";

import {
  ACTIVE_ORGANIZATION_CLAIM,
  LEGACY_ACTIVE_ORGANIZATION_CLAIM,
  MAX_EXTERNAL_REFERENCE_LENGTH,
  MAX_REQUEST_ID_LENGTH,
  TENANT_CONTEXT_DENIAL_CAUSES,
  TENANT_CONTEXT_DENIAL_CODES,
  TENANT_CONTEXT_DENIAL_MESSAGE,
  resolveTenantContext,
  toPublicDenial,
  type MembershipWarehouseDocument,
  type ResolveTenantContextInput,
  type TenantContextDenialCause,
  type TenantContextDenialCode,
  type TenantContextLookups,
} from "../../convex/lib/tenantContext";
import {
  FIXTURE_CREATION_TIME,
  FIXTURE_SENSITIVE_VALUES,
  TWO_TENANT_WORLD,
  activeOrganizationClaim,
  createFakeWorld,
  fixtureId,
  fixtureIdentity,
  type FakeWorld,
} from "../fixtures/tenant-context-world";

const REQUEST_ID = "0198f0d7-0c5b-7c19-9a1e-52a63d9f0a11";

const ALPHA_CLAIM = "org_alpha_2f8c";
const BETA_CLAIM = "org_beta_7d31";
const SIRIWAN_SUBJECT = "user_siriwan_1a2b";

function world(): FakeWorld {
  return createFakeWorld(TWO_TENANT_WORLD);
}

function lyingPort(
  base: FakeWorld,
  overrides: Partial<TenantContextLookups>,
): TenantContextLookups {
  return { ...base.lookups, ...overrides };
}

describe("resolving a context without a warehouse", () => {
  it("returns the mirrored actor, organization, and active membership", async () => {
    const fake = world();

    const result = await resolveTenantContext({
      requestId: REQUEST_ID,
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      lookups: fake.lookups,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.requestId).toBe(REQUEST_ID);
    expect(result.context.actor).toBe(fake.user("siriwan"));
    expect(result.context.organization).toBe(fake.organization("alpha"));
    expect(result.context.membership).toBe(fake.membership("siriwan-alpha"));
    expect(result.context.warehouse).toBeUndefined();
    expect("warehouse" in result.context).toBe(false);
  });

  it("accepts the legacy Clerk v1 organization claim during session migration", async () => {
    const fake = world();

    const result = await resolveTenantContext({
      requestId: REQUEST_ID,
      identity: fixtureIdentity(SIRIWAN_SUBJECT, {
        [LEGACY_ACTIVE_ORGANIZATION_CLAIM]: ALPHA_CLAIM,
      }),
      lookups: fake.lookups,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.organization).toBe(fake.organization("alpha"));
  });

  it("resolves actor, organization, and membership on every call, and nothing else", async () => {
    const fake = world();

    await resolveTenantContext({
      requestId: REQUEST_ID,
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      lookups: fake.lookups,
    });

    expect(fake.calls).toEqual([
      "findUserByClerkUserId",
      "findOrganizationByClerkOrganizationId",
      "findMembershipByOrganizationAndUser",
    ]);
  });

  it("freezes the context, so no caller can re-point it at another tenant", async () => {
    const fake = world();

    const result = await resolveTenantContext({
      requestId: REQUEST_ID,
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      lookups: fake.lookups,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.context)).toBe(true);
  });

  it("takes no orgId from its caller", async () => {
    const fake = world();

    await resolveTenantContext({
      requestId: REQUEST_ID,
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      lookups: fake.lookups,
      // @ts-expect-error the active organization is derived, never supplied (INV-0001-02).
      orgId: fake.organizationId("beta"),
    });

    // The directive above is the assertion: if the input type ever grows an
    // `orgId`, `tsc` fails here on an unused `@ts-expect-error`.
    expect(fake.calls).toContain("findOrganizationByClerkOrganizationId");
  });
});

describe("resolving a context with a warehouse", () => {
  it("accepts any warehouse of the tenant for an ORG_WIDE membership", async () => {
    const fake = world();

    const result = await resolveTenantContext({
      requestId: REQUEST_ID,
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      warehouseId: fake.warehouseId("alpha-north"),
      lookups: fake.lookups,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.warehouse).toBe(fake.warehouse("alpha-north"));

    expect(fake.calls).not.toContain("findMembershipWarehouse");
  });

  it("accepts a granted warehouse for a WAREHOUSE_SCOPED membership", async () => {
    const fake = world();

    const result = await resolveTenantContext({
      requestId: REQUEST_ID,
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim(BETA_CLAIM),
      ),
      warehouseId: fake.warehouseId("beta-north"),
      lookups: fake.lookups,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.warehouse).toBe(fake.warehouse("beta-north"));
    expect(result.context.membership.scopeMode).toBe("WAREHOUSE_SCOPED");
    expect(fake.calls).toEqual([
      "findUserByClerkUserId",
      "findOrganizationByClerkOrganizationId",
      "findMembershipByOrganizationAndUser",
      "findWarehouseByOrganizationAndId",
      "findMembershipWarehouse",
    ]);
  });
});

type DenialCase = {
  readonly name: string;
  readonly code: TenantContextDenialCode;
  readonly cause: TenantContextDenialCause;
  readonly request: (
    fake: FakeWorld,
  ) => Omit<ResolveTenantContextInput, "requestId">;
};

const TOO_LONG_REFERENCE = "u".repeat(MAX_EXTERNAL_REFERENCE_LENGTH + 1);

const DENIAL_CASES: readonly DenialCase[] = [
  {
    name: "an anonymous caller",
    code: "ANONYMOUS",
    cause: "NO_IDENTITY",
    request: (fake) => ({ identity: null, lookups: fake.lookups }),
  },
  {
    name: "a token whose subject is not a string",
    code: "IDENTITY_MALFORMED",
    cause: "SUBJECT_NOT_A_STRING",
    request: (fake) => ({
      identity: {
        ...fixtureIdentity(
          SIRIWAN_SUBJECT,
          activeOrganizationClaim(ALPHA_CLAIM),
        ),
        subject: 42,
      } as unknown as ResolveTenantContextInput["identity"],
      lookups: fake.lookups,
    }),
  },
  {
    name: "a blank subject",
    code: "IDENTITY_MALFORMED",
    cause: "SUBJECT_BLANK",
    request: (fake) => ({
      identity: fixtureIdentity("   ", activeOrganizationClaim(ALPHA_CLAIM)),
      lookups: fake.lookups,
    }),
  },
  {
    name: "a padded subject",
    code: "IDENTITY_MALFORMED",
    cause: "SUBJECT_UNTRIMMED",
    request: (fake) => ({
      identity: fixtureIdentity(
        ` ${SIRIWAN_SUBJECT} `,
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      lookups: fake.lookups,
    }),
  },
  {
    name: "an unbounded subject",
    code: "IDENTITY_MALFORMED",
    cause: "SUBJECT_TOO_LONG",
    request: (fake) => ({
      identity: fixtureIdentity(
        TOO_LONG_REFERENCE,
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      lookups: fake.lookups,
    }),
  },
  {
    name: "a token with no active-organization claim",
    code: "ACTIVE_ORGANIZATION_MISSING",
    cause: "CLAIM_ABSENT",
    request: (fake) => ({
      identity: fixtureIdentity(SIRIWAN_SUBJECT),
      lookups: fake.lookups,
    }),
  },
  {
    name: "a null active-organization claim",
    code: "ACTIVE_ORGANIZATION_MISSING",
    cause: "CLAIM_ABSENT",
    request: (fake) => ({
      identity: fixtureIdentity(SIRIWAN_SUBJECT, activeOrganizationClaim(null)),
      lookups: fake.lookups,
    }),
  },
  {
    name: "an active-organization claim that is a number",
    code: "ACTIVE_ORGANIZATION_MALFORMED",
    cause: "CLAIM_NOT_A_STRING",
    request: (fake) => ({
      identity: fixtureIdentity(SIRIWAN_SUBJECT, activeOrganizationClaim(7)),
      lookups: fake.lookups,
    }),
  },
  {
    name: "an active-organization claim that is an object",
    code: "ACTIVE_ORGANIZATION_MALFORMED",
    cause: "CLAIM_NOT_A_STRING",
    request: (fake) => ({
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim({ id: ALPHA_CLAIM }),
      ),
      lookups: fake.lookups,
    }),
  },
  {
    name: "a blank active-organization claim",
    code: "ACTIVE_ORGANIZATION_MALFORMED",
    cause: "CLAIM_BLANK",
    request: (fake) => ({
      identity: fixtureIdentity(SIRIWAN_SUBJECT, activeOrganizationClaim("")),
      lookups: fake.lookups,
    }),
  },
  {
    name: "a padded active-organization claim",
    code: "ACTIVE_ORGANIZATION_MALFORMED",
    cause: "CLAIM_UNTRIMMED",
    request: (fake) => ({
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim(`${ALPHA_CLAIM} `),
      ),
      lookups: fake.lookups,
    }),
  },
  {
    name: "an unbounded active-organization claim",
    code: "ACTIVE_ORGANIZATION_MALFORMED",
    cause: "CLAIM_TOO_LONG",
    request: (fake) => ({
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim(TOO_LONG_REFERENCE),
      ),
      lookups: fake.lookups,
    }),
  },
  {
    name: "a subject with no mirrored user",
    code: "USER_UNKNOWN",
    cause: "USER_LOOKUP_EMPTY",
    request: (fake) => ({
      identity: fixtureIdentity(
        "user_never_mirrored_0000",
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      lookups: fake.lookups,
    }),
  },
  {
    name: "a user lookup that answers with a different user",
    code: "USER_UNKNOWN",
    cause: "USER_LOOKUP_MISMATCH",
    request: (fake) => ({
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      lookups: lyingPort(fake, {
        findUserByClerkUserId: () => Promise.resolve(fake.user("chaiwat")),
      }),
    }),
  },
  {
    name: "a deactivated user",
    code: "USER_INACTIVE",
    cause: "USER_STATUS_DEACTIVATED",
    request: (fake) => ({
      identity: fixtureIdentity(
        "user_deactivated_5e6f",
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      lookups: fake.lookups,
    }),
  },
  {
    name: "a claim naming no mirrored organization",
    code: "ORGANIZATION_UNKNOWN",
    cause: "ORGANIZATION_LOOKUP_EMPTY",
    request: (fake) => ({
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim("org_never_provisioned_0000"),
      ),
      lookups: fake.lookups,
    }),
  },
  {
    name: "an organization lookup that answers with a different tenant",
    code: "ORGANIZATION_UNKNOWN",
    cause: "ORGANIZATION_LOOKUP_MISMATCH",
    request: (fake) => ({
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      lookups: lyingPort(fake, {
        findOrganizationByClerkOrganizationId: () =>
          Promise.resolve(fake.organization("beta")),
      }),
    }),
  },
  {
    name: "a suspended organization",
    code: "ORGANIZATION_INACTIVE",
    cause: "ORGANIZATION_STATUS_SUSPENDED",
    request: (fake) => ({
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim("org_suspended_9a02"),
      ),
      lookups: fake.lookups,
    }),
  },
  {
    name: "a closed organization",
    code: "ORGANIZATION_INACTIVE",
    cause: "ORGANIZATION_STATUS_CLOSED",
    request: (fake) => ({
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim("org_closed_4b55"),
      ),
      lookups: fake.lookups,
    }),
  },
  {
    name: "a mirrored user with no membership in the active organization",
    code: "MEMBERSHIP_MISSING",
    cause: "MEMBERSHIP_LOOKUP_EMPTY",
    request: (fake) => ({
      identity: fixtureIdentity(
        "user_outsider_7a8b",
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      lookups: fake.lookups,
    }),
  },
  {
    name: "a membership lookup that answers with another tenant's membership",
    code: "MEMBERSHIP_MISSING",
    cause: "MEMBERSHIP_LOOKUP_MISMATCH",
    request: (fake) => ({
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      lookups: lyingPort(fake, {
        findMembershipByOrganizationAndUser: () =>
          Promise.resolve(fake.membership("siriwan-beta")),
      }),
    }),
  },
  {
    name: "a suspended membership",
    code: "MEMBERSHIP_INACTIVE",
    cause: "MEMBERSHIP_STATUS_SUSPENDED",
    request: (fake) => ({
      identity: fixtureIdentity(
        "user_chaiwat_3c4d",
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      lookups: fake.lookups,
    }),
  },
  {
    name: "a revoked membership",
    code: "MEMBERSHIP_INACTIVE",
    cause: "MEMBERSHIP_STATUS_REVOKED",
    request: (fake) => ({
      identity: fixtureIdentity(
        "user_chaiwat_3c4d",
        activeOrganizationClaim(BETA_CLAIM),
      ),
      lookups: fake.lookups,
    }),
  },
  {
    name: "a warehouse ID that names no document",
    code: "WAREHOUSE_UNKNOWN",
    cause: "WAREHOUSE_LOOKUP_EMPTY",
    request: (fake) => ({
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      warehouseId: fixtureId("warehouses", "never-created"),
      lookups: fake.lookups,
    }),
  },
  {
    name: "a warehouse lookup that answers with a different warehouse",
    code: "WAREHOUSE_UNKNOWN",
    cause: "WAREHOUSE_LOOKUP_MISMATCH",
    request: (fake) => ({
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      warehouseId: fake.warehouseId("alpha-north"),
      lookups: lyingPort(fake, {
        findWarehouseByOrganizationAndId: () =>
          Promise.resolve(fake.warehouse("alpha-retired")),
      }),
    }),
  },
  {
    name: "a warehouse belonging to another tenant",
    code: "WAREHOUSE_UNKNOWN",
    cause: "WAREHOUSE_FOREIGN_ORGANIZATION",
    request: (fake) => ({
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      warehouseId: fake.warehouseId("beta-north"),

      lookups: lyingPort(fake, {
        findWarehouseByOrganizationAndId: () =>
          Promise.resolve(fake.warehouse("beta-north")),
      }),
    }),
  },
  {
    name: "an inactive warehouse of the active tenant",
    code: "WAREHOUSE_INACTIVE",
    cause: "WAREHOUSE_STATUS_INACTIVE",
    request: (fake) => ({
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      warehouseId: fake.warehouseId("alpha-retired"),
      lookups: fake.lookups,
    }),
  },
  {
    name: "a warehouse outside a scoped membership's grants",
    code: "WAREHOUSE_OUT_OF_SCOPE",
    cause: "WAREHOUSE_SCOPE_ROW_ABSENT",
    request: (fake) => ({
      identity: fixtureIdentity(
        SIRIWAN_SUBJECT,
        activeOrganizationClaim(BETA_CLAIM),
      ),
      warehouseId: fake.warehouseId("beta-south"),
      lookups: fake.lookups,
    }),
  },
  {
    name: "a scope row that grants a different warehouse",
    code: "WAREHOUSE_OUT_OF_SCOPE",
    cause: "WAREHOUSE_SCOPE_ROW_MISMATCH",
    request: (fake) => {
      const wrongRow: MembershipWarehouseDocument = {
        _id: fixtureId("membershipWarehouses", "siriwan-beta-beta-north"),
        _creationTime: FIXTURE_CREATION_TIME,
        orgId: fake.organizationId("beta"),
        membershipId: fake.membershipId("siriwan-beta"),
        warehouseId: fake.warehouseId("beta-north"),
      };
      return {
        identity: fixtureIdentity(
          SIRIWAN_SUBJECT,
          activeOrganizationClaim(BETA_CLAIM),
        ),
        warehouseId: fake.warehouseId("beta-south"),
        lookups: lyingPort(fake, {
          findMembershipWarehouse: () => Promise.resolve(wrongRow),
        }),
      };
    },
  },
];

describe("denials", () => {
  for (const denialCase of DENIAL_CASES) {
    it(`denies ${denialCase.name} as ${denialCase.code}/${denialCase.cause}`, async () => {
      const fake = world();

      const result = await resolveTenantContext({
        requestId: REQUEST_ID,
        ...denialCase.request(fake),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.denial).toEqual({
        code: denialCase.code,
        cause: denialCase.cause,
        requestId: REQUEST_ID,
      });
    });
  }

  it("exercises every declared code and every declared cause", () => {
    const codes = [...new Set(DENIAL_CASES.map((c) => c.code))].sort();
    const causes = [...new Set(DENIAL_CASES.map((c) => c.cause))].sort();

    expect(codes).toEqual([...TENANT_CONTEXT_DENIAL_CODES].sort());
    expect(causes).toEqual([...TENANT_CONTEXT_DENIAL_CAUSES].sort());
  });

  it("reads nothing at all when the caller is anonymous", async () => {
    const fake = world();

    await resolveTenantContext({
      requestId: REQUEST_ID,
      identity: null,
      warehouseId: fake.warehouseId("alpha-north"),
      lookups: fake.lookups,
    });

    expect(fake.calls).toEqual([]);
  });

  it("does not look up an organization for an unknown subject", async () => {
    const fake = world();

    await resolveTenantContext({
      requestId: REQUEST_ID,
      identity: fixtureIdentity(
        "user_never_mirrored_0000",
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      lookups: fake.lookups,
    });

    expect(fake.calls).toEqual(["findUserByClerkUserId"]);
  });

  it("does not look up a warehouse when the membership is not active", async () => {
    const fake = world();

    await resolveTenantContext({
      requestId: REQUEST_ID,
      identity: fixtureIdentity(
        "user_chaiwat_3c4d",
        activeOrganizationClaim(ALPHA_CLAIM),
      ),
      warehouseId: fake.warehouseId("alpha-north"),
      lookups: fake.lookups,
    });

    expect(fake.calls).not.toContain("findWarehouseByOrganizationAndId");
  });
});

describe("every denial is correlated and carries nothing else", () => {
  it("uses the caller's request ID, whatever the denial", async () => {
    const other = "0198f0d7-0c5b-7c19-9a1e-52a63d9f0b22";

    for (const denialCase of DENIAL_CASES) {
      const first = await resolveTenantContext({
        requestId: REQUEST_ID,
        ...denialCase.request(world()),
      });
      const second = await resolveTenantContext({
        requestId: other,
        ...denialCase.request(world()),
      });

      expect(first.ok).toBe(false);
      expect(second.ok).toBe(false);
      if (first.ok || second.ok) return;
      expect(first.denial.requestId).toBe(REQUEST_ID);
      expect(second.denial.requestId).toBe(other);
    }
  });

  it("leaks no fixture name, reference, claim, code, or document ID", async () => {
    expect(FIXTURE_SENSITIVE_VALUES.length).toBeGreaterThan(20);

    for (const denialCase of DENIAL_CASES) {
      const result = await resolveTenantContext({
        requestId: REQUEST_ID,
        ...denialCase.request(world()),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const serialized = [
        JSON.stringify(result.denial),
        JSON.stringify(toPublicDenial(result.denial)),
      ].join(" ");

      for (const sensitive of FIXTURE_SENSITIVE_VALUES) {
        expect(serialized).not.toContain(sensitive);
      }
      expect(serialized).not.toContain(ACTIVE_ORGANIZATION_CLAIM);
      expect(serialized).not.toContain("clerk");
    }
  });

  it("denies with exactly a code, a cause, and a request ID", async () => {
    const result = await resolveTenantContext({
      requestId: REQUEST_ID,
      identity: null,
      lookups: world().lookups,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.denial).sort()).toEqual([
      "cause",
      "code",
      "requestId",
    ]);
    expect(Object.isFrozen(result.denial)).toBe(true);
  });
});

describe("the public conversion seam", () => {
  it("emits one generic message for every code", () => {
    const messages = new Set(
      TENANT_CONTEXT_DENIAL_CODES.map(
        (code) =>
          toPublicDenial({ code, cause: "NO_IDENTITY", requestId: REQUEST_ID })
            .message,
      ),
    );

    expect([...messages]).toEqual([TENANT_CONTEXT_DENIAL_MESSAGE]);
  });

  it("carries the code, the request ID, and no internal cause", () => {
    const publicDenial = toPublicDenial({
      code: "WAREHOUSE_OUT_OF_SCOPE",
      cause: "WAREHOUSE_SCOPE_ROW_ABSENT",
      requestId: REQUEST_ID,
    });

    expect(publicDenial).toEqual({
      kind: "TENANT_CONTEXT_DENIED",
      code: "WAREHOUSE_OUT_OF_SCOPE",
      requestId: REQUEST_ID,
      message: TENANT_CONTEXT_DENIAL_MESSAGE,
    });
    expect("cause" in publicDenial).toBe(false);
    expect(Object.isFrozen(publicDenial)).toBe(true);
  });
});

describe("the request ID is a server obligation, not a denial", () => {
  const identity = fixtureIdentity(
    SIRIWAN_SUBJECT,
    activeOrganizationClaim(ALPHA_CLAIM),
  );

  const defective: readonly {
    readonly name: string;
    readonly value: string;
  }[] = [
    { name: "empty", value: "" },
    { name: "blank", value: "   " },
    { name: "padded", value: ` ${REQUEST_ID} ` },
    { name: "unbounded", value: "r".repeat(MAX_REQUEST_ID_LENGTH + 1) },
  ];

  for (const { name, value } of defective) {
    it(`throws on a ${name} request ID without reading anything`, async () => {
      const fake = world();

      await expect(
        resolveTenantContext({
          requestId: value,
          identity,
          lookups: fake.lookups,
        }),
      ).rejects.toThrow(/unusable requestId/);
      expect(fake.calls).toEqual([]);
    });
  }

  it("does not repeat the defective value in the thrown message", async () => {
    const secretish = "req_".concat("z".repeat(MAX_REQUEST_ID_LENGTH));
    let message = "";

    try {
      await resolveTenantContext({
        requestId: secretish,
        identity,
        lookups: world().lookups,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("unusable requestId");
    expect(message).toContain("TOO_LONG");
    expect(message).not.toContain(secretish);
  });

  it("accepts a request ID at the bound", async () => {
    const atBound = "r".repeat(MAX_REQUEST_ID_LENGTH);

    const result = await resolveTenantContext({
      requestId: atBound,
      identity,
      lookups: world().lookups,
    });

    expect(result.ok).toBe(true);
  });
});
