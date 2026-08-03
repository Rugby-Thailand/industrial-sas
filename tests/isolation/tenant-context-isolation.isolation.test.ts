/**
 * Isolation tier — cross-tenant properties of active tenant context resolution.
 *
 * Scope, stated before the assertions so the tier is not over-read: this suite
 * runs the production resolver
 * ([`resolveTenantContext`](../../convex/lib/tenantContext.ts)) against a
 * deterministic in-memory world, not against Convex. It does **not** close
 * `RG-013` or `RG-031`: there is still no exported Convex function, no
 * tenant-bound accessor, and no deployment, so nothing here proves that a real
 * `ctx.db` rejects a foreign document ID. What it proves is the layer above that
 * one — that the resolution algebra never lets tenant A's identity end up holding
 * tenant B's organization, membership, or warehouse, including when the lookup
 * port hands it one.
 *
 * The four properties:
 *
 * 1. **Human identifiers are tenant-local.** Two tenants both own a warehouse
 *    with `code` `NORTH` (`warehouses.code` is unique per organization, §5 Q4).
 *    Each resolves to its own document, and neither resolution mentions the
 *    other's.
 * 2. **A foreign ID buys nothing.** Presenting tenant B's warehouse ID while
 *    tenant A is active is denied, and denied as `WAREHOUSE_UNKNOWN` — the same
 *    code as an ID that never existed, so the caller cannot use the resolver as
 *    an existence oracle over another tenant's data.
 * 3. **ID shape is not identity.** The fixture mints IDs as `table:key`, so
 *    similar keys give near-identical strings. Resolution compares documents to
 *    the resolved organization, so lookalike IDs and cross-tenant swaps are
 *    refused for the same reason a random string is.
 * 4. **The same person is a different actor per tenant.** One user with active
 *    memberships in both tenants gets a different membership, a different scope
 *    mode, and therefore different warehouse access depending only on the
 *    active-organization claim — with `ORG_WIDE` as the schema's explicit
 *    all-warehouse representation and an explicit `membershipWarehouses` row as
 *    the alternative.
 */
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

/* -------------------------------------------------------------------------- */
/* Tenant-local human identifiers                                              */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Foreign and lookalike IDs                                                   */
/* -------------------------------------------------------------------------- */

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

    // The two IDs differ only in their key suffix, which is exactly the kind of
    // near-collision an attacker would try. Identity is the document, not the
    // string's shape.
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
          // Tenant B's membership for the same person: same user, wrong tenant.
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

/* -------------------------------------------------------------------------- */
/* Scope: all-warehouse mode versus explicit grants                            */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Non-leakage across tenants                                                  */
/* -------------------------------------------------------------------------- */

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
