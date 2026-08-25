import { describe, expect, it } from "vitest";

import {
  resolveTenantContext,
  toPublicDenial,
  type TenantContextLookups,
} from "../../convex/lib/tenantContext";
import {
  FIXTURE_SENSITIVE_VALUES,
  TWO_TENANT_WORLD,
  activeOrganizationClaim,
  createFakeWorld,
  fixtureId,
  fixtureIdentity,
  type FakeWorld,
} from "../fixtures/tenant-context-world";

const REQUEST_ID = "0198f0d7-0c5b-7c19-9a1e-52a63d9f0c33";

const ALPHA_CLAIM = "org_alpha_2f8c";
const BETA_CLAIM = "org_beta_7d31";
const SIRIWAN_SUBJECT = "user_siriwan_1a2b";

function world(): FakeWorld {
  return createFakeWorld(TWO_TENANT_WORLD);
}

function requestFor(
  fake: FakeWorld,
  claim: string,
  options: {
    readonly warehouseId?: ReturnType<FakeWorld["warehouseId"]>;
    readonly lookups?: TenantContextLookups;
  } = {},
) {
  return {
    requestId: REQUEST_ID,
    identity: fixtureIdentity(SIRIWAN_SUBJECT, activeOrganizationClaim(claim)),
    lookups: options.lookups ?? fake.lookups,
    ...(options.warehouseId === undefined
      ? {}
      : { warehouseId: options.warehouseId }),
  };
}

describe("two tenants may reuse a warehouse code", () => {
  it("declares the same code in both tenants, on different documents", () => {
    const fake = world();
    const alphaNorth = fake.warehouse("alpha-north");
    const betaNorth = fake.warehouse("beta-north");

    expect(alphaNorth.code).toBe(betaNorth.code);
    expect(alphaNorth._id).not.toBe(betaNorth._id);
    expect(alphaNorth.orgId).not.toBe(betaNorth.orgId);
  });

  it("resolves each tenant's NORTH independently for the same person", async () => {
    const fake = world();

    const inAlpha = await resolveTenantContext(
      requestFor(fake, ALPHA_CLAIM, {
        warehouseId: fake.warehouseId("alpha-north"),
      }),
    );
    const inBeta = await resolveTenantContext(
      requestFor(fake, BETA_CLAIM, {
        warehouseId: fake.warehouseId("beta-north"),
      }),
    );

    expect(inAlpha.ok).toBe(true);
    expect(inBeta.ok).toBe(true);
    if (!inAlpha.ok || !inBeta.ok) return;

    expect(inAlpha.context.organization._id).toBe(fake.organizationId("alpha"));
    expect(inBeta.context.organization._id).toBe(fake.organizationId("beta"));
    expect(inAlpha.context.warehouse?.code).toBe("NORTH");
    expect(inBeta.context.warehouse?.code).toBe("NORTH");
    expect(inAlpha.context.warehouse?._id).not.toBe(
      inBeta.context.warehouse?._id,
    );
    expect(inAlpha.context.warehouse?.orgId).toBe(
      inAlpha.context.organization._id,
    );
    expect(inBeta.context.warehouse?.orgId).toBe(
      inBeta.context.organization._id,
    );
  });
});

describe("a warehouse ID from another tenant", () => {
  it("is denied while the other tenant is active", async () => {
    const fake = world();

    const result = await resolveTenantContext(
      requestFor(fake, ALPHA_CLAIM, {
        warehouseId: fake.warehouseId("beta-north"),
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denial.code).toBe("WAREHOUSE_UNKNOWN");
  });

  it("is indistinguishable from an ID that never existed", async () => {
    const fake = world();

    const foreign = await resolveTenantContext(
      requestFor(fake, ALPHA_CLAIM, {
        warehouseId: fake.warehouseId("beta-south"),
      }),
    );
    const nonexistent = await resolveTenantContext(
      requestFor(fake, ALPHA_CLAIM, {
        warehouseId: fixtureId("warehouses", "no-such-warehouse"),
      }),
    );

    expect(foreign.ok).toBe(false);
    expect(nonexistent.ok).toBe(false);
    if (foreign.ok || nonexistent.ok) return;
    expect(toPublicDenial(foreign.denial)).toEqual(
      toPublicDenial(nonexistent.denial),
    );
  });

  it("is refused even when the lookup port hands the document over", async () => {
    const fake = world();

    const result = await resolveTenantContext(
      requestFor(fake, ALPHA_CLAIM, {
        warehouseId: fake.warehouseId("beta-north"),
        lookups: {
          ...fake.lookups,
          findWarehouseByOrganizationAndId: () =>
            Promise.resolve(fake.warehouse("beta-north")),
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denial.code).toBe("WAREHOUSE_UNKNOWN");
    expect(result.denial.cause).toBe("WAREHOUSE_FOREIGN_ORGANIZATION");
  });

  it("is refused when the port answers with a lookalike ID from the same tenant", async () => {
    const fake = world();
    const requested = fake.warehouseId("beta-north");
    const lookalike = fake.warehouse("beta-south");

    expect(String(requested).startsWith("warehouses:beta-")).toBe(true);
    expect(String(lookalike._id).startsWith("warehouses:beta-")).toBe(true);

    const result = await resolveTenantContext(
      requestFor(fake, BETA_CLAIM, {
        warehouseId: requested,
        lookups: {
          ...fake.lookups,
          findWarehouseByOrganizationAndId: () => Promise.resolve(lookalike),
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denial.cause).toBe("WAREHOUSE_LOOKUP_MISMATCH");
  });
});

describe("a membership from another tenant", () => {
  it("cannot stand in for the active organization's membership", async () => {
    const fake = world();

    const result = await resolveTenantContext(
      requestFor(fake, ALPHA_CLAIM, {
        lookups: {
          ...fake.lookups,

          findMembershipByOrganizationAndUser: () =>
            Promise.resolve(fake.membership("siriwan-beta")),
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denial.code).toBe("MEMBERSHIP_MISSING");
    expect(result.denial.cause).toBe("MEMBERSHIP_LOOKUP_MISMATCH");
  });

  it("cannot be reached by claiming another tenant the person does not belong to", async () => {
    const fake = world();

    const result = await resolveTenantContext({
      requestId: REQUEST_ID,
      identity: fixtureIdentity(
        "user_outsider_7a8b",
        activeOrganizationClaim(BETA_CLAIM),
      ),
      lookups: fake.lookups,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denial.code).toBe("MEMBERSHIP_MISSING");
  });
});

describe("warehouse scope depends on the active tenant's membership", () => {
  it("gives an ORG_WIDE membership every active warehouse of its own tenant", async () => {
    const fake = world();

    const result = await resolveTenantContext(
      requestFor(fake, ALPHA_CLAIM, {
        warehouseId: fake.warehouseId("alpha-north"),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.membership.scopeMode).toBe("ORG_WIDE");
    expect(fake.calls).not.toContain("findMembershipWarehouse");
  });

  it("gives a WAREHOUSE_SCOPED membership only its granted warehouses", async () => {
    const fake = world();

    const granted = await resolveTenantContext(
      requestFor(fake, BETA_CLAIM, {
        warehouseId: fake.warehouseId("beta-north"),
      }),
    );
    const notGranted = await resolveTenantContext(
      requestFor(fake, BETA_CLAIM, {
        warehouseId: fake.warehouseId("beta-south"),
      }),
    );

    expect(granted.ok).toBe(true);
    expect(notGranted.ok).toBe(false);
    if (!granted.ok || notGranted.ok) return;
    expect(granted.context.warehouse?._id).toBe(fake.warehouseId("beta-north"));
    expect(notGranted.denial.code).toBe("WAREHOUSE_OUT_OF_SCOPE");
    expect(notGranted.denial.cause).toBe("WAREHOUSE_SCOPE_ROW_ABSENT");
  });

  it("does not carry a grant from one tenant into the other", async () => {
    const fake = world();

    // In tenant B this person is scoped to NORTH only. That grant must not make
    // tenant A's NORTH reachable, nor the reverse.
    const crossGrant = await resolveTenantContext(
      requestFor(fake, BETA_CLAIM, {
        warehouseId: fake.warehouseId("alpha-north"),
      }),
    );

    expect(crossGrant.ok).toBe(false);
    if (crossGrant.ok) return;
    expect(crossGrant.denial.code).toBe("WAREHOUSE_UNKNOWN");
  });

  it("denies an empty grant set rather than reading it as all warehouses", async () => {
    const fake = createFakeWorld({
      ...TWO_TENANT_WORLD,
      membershipWarehouses: [],
    });

    const result = await resolveTenantContext(
      requestFor(fake, BETA_CLAIM, {
        warehouseId: fake.warehouseId("beta-north"),
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denial.code).toBe("WAREHOUSE_OUT_OF_SCOPE");
  });
});

describe("a cross-tenant denial says nothing about the other tenant", () => {
  it("mentions no fixture value from either tenant", async () => {
    const fake = world();

    const result = await resolveTenantContext(
      requestFor(fake, ALPHA_CLAIM, {
        warehouseId: fake.warehouseId("beta-south"),
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const serialized = [
      JSON.stringify(result.denial),
      JSON.stringify(toPublicDenial(result.denial)),
    ].join(" ");

    for (const sensitive of FIXTURE_SENSITIVE_VALUES) {
      expect(serialized).not.toContain(sensitive);
    }
  });
});
