/**
 * Isolation tier — cross-tenant properties of the document boundary primitives
 * (`convex/lib/tenantDb.ts`, T05b1a).
 *
 * The isolation tier is a blocking merge gate (`RG-031`). This file does not
 * close it, and it does not close `RG-013`: there is still no Convex function and
 * no tenant-bound accessor, so nothing here proves that a *deployed* query
 * rejects a cross-tenant document ID. What it proves is the layer the accessor
 * will be built on, and it proves it by attacking that layer:
 *
 * - the runtime allowlist cannot be widened to a global table, so a caller cannot
 *   reach `organizations`, `users`, or `permissions` through a tenant-scoped path
 *   (`ADR-0002` §1);
 * - a document that does not exist and a document owned by another tenant produce
 *   payloads that are equal field for field, so the boundary is not an existence
 *   oracle (`INV-0002-03`);
 * - no failure carries a table name, a document ID, an `orgId`, a field name, or
 *   any part of the payload — not in the code, not in the message, not in the
 *   public object, not in the enumerable properties of the error itself
 *   (`INV-0002-07`);
 * - the tenant discriminator on a write comes from the derived value and cannot be
 *   supplied, shadowed, or patched by a caller (`INV-0001-02`).
 *
 * Two tenants are represented by two organization IDs of deliberately similar
 * shape: similarity of shape must buy an attacker nothing, because ownership is
 * decided by comparing keys, not by how different they look.
 */
import { describe, expect, it } from "vitest";

import { GLOBAL_TABLES, TENANT_TABLES } from "../../convex/lib/schemaPolicy";
import {
  FORBIDDEN_WRITE_FIELDS,
  TENANT_DB_ERROR_MESSAGE,
  TENANT_TABLE_NAMES,
  TenantDbError,
  assertOwnedDocument,
  assertTenantTableName,
  tenantInsertPayload,
  tenantUpdatePayload,
  type TenantOrgId,
  type TenantTableName,
} from "../../convex/lib/tenantDb";
import { fixtureId } from "../fixtures/tenant-context-world";

const REQUEST_ID = "req_01JBZ0000000000000000000";

/** The reader's tenant. */
const ORG_HOME: TenantOrgId = fixtureId("organizations", "home");
/** Another customer's tenant. Same shape, different key. */
const ORG_FOREIGN: TenantOrgId = fixtureId("organizations", "foreign");

/**
 * Values that must never appear anywhere in a failure: the foreign tenant's key,
 * a document ID belonging to it, a field name a caller sent, and a payload value.
 */
const SECRETS = [
  ORG_FOREIGN,
  "foreign",
  fixtureId("warehouses", "foreignNorth"),
  "SECRET_LOT_CODE",
  "supplierPriceThb",
] as const;

/** Everything a caller can see of a thrown boundary failure. */
function failure(call: () => unknown): {
  readonly error: TenantDbError;
  readonly surface: string;
} {
  try {
    call();
  } catch (caught) {
    if (!(caught instanceof TenantDbError)) {
      throw new Error(`Expected a TenantDbError, received ${String(caught)}.`);
    }
    // Everything reachable without a debugger: the payload, the message, the
    // error's own enumerable properties, and its default serialization.
    const surface = [
      JSON.stringify(caught.toPublic()),
      caught.message,
      caught.name,
      caught.code,
      JSON.stringify({ ...caught }),
      String(caught),
    ].join("\u0000");
    return { error: caught, surface };
  }
  throw new Error("Expected the call to throw, but it returned.");
}

describe("the tenant-scoped path cannot be pointed at a global table", () => {
  it("refuses each global table by name", () => {
    for (const name of GLOBAL_TABLES) {
      expect(
        failure(() => assertTenantTableName(name, REQUEST_ID)).error.code,
      ).toBe("INVALID_TENANT_TABLE");
    }
  });

  it("refuses a global table identically to a table that does not exist", () => {
    const global = failure(() =>
      assertTenantTableName("organizations", REQUEST_ID),
    );
    const unknown = failure(() =>
      assertTenantTableName("noSuchTable", REQUEST_ID),
    );

    expect(global.error.toPublic()).toEqual(unknown.error.toPublic());
    expect(global.surface).toBe(unknown.surface);
  });

  it("names no table in the failure", () => {
    const { surface } = failure(() =>
      assertTenantTableName("organizations", REQUEST_ID),
    );

    for (const name of [...GLOBAL_TABLES, ...TENANT_TABLES]) {
      expect(surface).not.toContain(name);
    }
  });

  it("cannot be widened by a caller that reaches the allowlist", () => {
    const mutable = TENANT_TABLE_NAMES as unknown as Set<string>;

    expect(() => mutable.add("organizations")).toThrow();
    expect(
      failure(() => assertTenantTableName("organizations", REQUEST_ID)).error
        .code,
    ).toBe("INVALID_TENANT_TABLE");
  });
});

describe("absent and foreign are the same answer", () => {
  const absent = () =>
    failure(() => assertOwnedDocument(null, ORG_HOME, REQUEST_ID));
  const foreign = () =>
    failure(() =>
      assertOwnedDocument(
        {
          orgId: ORG_FOREIGN,
          _id: fixtureId("warehouses", "foreignNorth"),
          supplierPriceThb: 1234,
        },
        ORG_HOME,
        REQUEST_ID,
      ),
    );

  it("produces payloads that are equal field for field", () => {
    expect(foreign().error.toPublic()).toEqual(absent().error.toPublic());
    expect(Object.keys(foreign().error.toPublic())).toEqual(
      Object.keys(absent().error.toPublic()),
    );
  });

  it("produces an identical observable surface", () => {
    expect(foreign().surface).toBe(absent().surface);
  });

  it("answers the same for a malformed document as for a foreign one", () => {
    const malformed = [
      undefined,
      {},
      { orgId: null },
      { orgId: 42 },
      { orgId: "" },
      { orgId: ` ${ORG_HOME}` },
      [{ orgId: ORG_HOME }],
      "organizations:home",
    ];

    for (const document of malformed) {
      const observed = failure(() =>
        assertOwnedDocument(document, ORG_HOME, REQUEST_ID),
      );
      expect(observed.error.code).toBe("NOT_FOUND");
      expect(observed.surface).toBe(foreign().surface);
    }
  });

  it("does not let a look-alike key pass as ownership", () => {
    const lookAlikes = [
      `${ORG_HOME}x`,
      `${ORG_HOME.slice(0, -1)}`,
      ORG_HOME.toUpperCase(),
      `${ORG_HOME}\u0000`,
    ];

    for (const orgId of lookAlikes) {
      expect(
        failure(() => assertOwnedDocument({ orgId }, ORG_HOME, REQUEST_ID))
          .error.code,
      ).toBe("NOT_FOUND");
    }
  });

  it("still returns the home tenant's own document", () => {
    const document = { orgId: ORG_HOME, code: "NORTH" };
    expect(assertOwnedDocument(document, ORG_HOME, REQUEST_ID)).toBe(document);
  });
});

describe("no failure carries a value", () => {
  const calls: readonly (readonly [string, () => unknown])[] = [
    ["foreign table", () => assertTenantTableName("organizations", REQUEST_ID)],
    [
      "foreign document",
      () =>
        assertOwnedDocument(
          {
            orgId: ORG_FOREIGN,
            _id: fixtureId("warehouses", "foreignNorth"),
            code: "SECRET_LOT_CODE",
            supplierPriceThb: 9,
          },
          ORG_HOME,
          REQUEST_ID,
        ),
    ],
    [
      "caller-supplied tenant on insert",
      () =>
        tenantInsertPayload(
          { orgId: ORG_FOREIGN, code: "SECRET_LOT_CODE" } as never,
          ORG_HOME,
          REQUEST_ID,
        ),
    ],
    [
      "tenant-moving patch",
      () =>
        tenantUpdatePayload(
          { orgId: ORG_FOREIGN, supplierPriceThb: 9 } as never,
          REQUEST_ID,
        ),
    ],
  ];

  for (const [what, call] of calls) {
    it(`leaks nothing when rejecting a ${what}`, () => {
      const { error, surface } = failure(call);

      for (const secret of SECRETS) {
        expect(surface).not.toContain(secret);
      }
      expect(error.message).toBe(TENANT_DB_ERROR_MESSAGE);
      expect(Object.keys(error.toPublic())).toEqual(["code", "requestId"]);
      expect(error.toPublic().requestId).toBe(REQUEST_ID);
    });
  }

  it("uses one message for every code, so the message is not a channel", () => {
    const messages = new Set(
      calls.map(([, call]) => failure(call).error.message),
    );

    expect([...messages]).toEqual([TENANT_DB_ERROR_MESSAGE]);
  });
});

describe("a write cannot choose its tenant", () => {
  it("stamps the derived tenant, never the caller's", () => {
    const inserted = tenantInsertPayload(
      { code: "NORTH" },
      ORG_HOME,
      REQUEST_ID,
    );

    expect(inserted.orgId).toBe(ORG_HOME);
    expect(inserted.orgId).not.toBe(ORG_FOREIGN);
  });

  it("refuses rather than overwrites when the caller supplies a tenant", () => {
    for (const orgId of [ORG_HOME, ORG_FOREIGN]) {
      expect(
        failure(() =>
          tenantInsertPayload({ orgId } as never, ORG_HOME, REQUEST_ID),
        ).error.code,
      ).toBe("INVALID_WRITE");
    }
  });

  it("refuses every forbidden field on both write paths", () => {
    for (const field of FORBIDDEN_WRITE_FIELDS) {
      expect(
        failure(() =>
          tenantInsertPayload(
            { [field]: ORG_FOREIGN } as never,
            ORG_HOME,
            REQUEST_ID,
          ),
        ).error.code,
      ).toBe("INVALID_WRITE");
      expect(
        failure(() =>
          tenantUpdatePayload({ [field]: ORG_FOREIGN } as never, REQUEST_ID),
        ).error.code,
      ).toBe("INVALID_WRITE");
    }
  });

  it("cannot have its stamped tenant rewritten afterwards", () => {
    const inserted = tenantInsertPayload(
      { code: "NORTH" },
      ORG_HOME,
      REQUEST_ID,
    );
    const mutable = inserted as unknown as Record<string, unknown>;

    expect(() => {
      mutable.orgId = ORG_FOREIGN;
    }).toThrow(TypeError);
    expect(() => {
      delete mutable.orgId;
    }).toThrow(TypeError);
    expect(inserted.orgId).toBe(ORG_HOME);
  });

  it("never mutates the caller's payload on either path", () => {
    const insertPayload = { code: "NORTH" };
    const patchPayload = { code: "SOUTH" };

    tenantInsertPayload(insertPayload, ORG_HOME, REQUEST_ID);
    tenantUpdatePayload(patchPayload, REQUEST_ID);

    expect(insertPayload).toEqual({ code: "NORTH" });
    expect(patchPayload).toEqual({ code: "SOUTH" });
    expect(Object.hasOwn(insertPayload, "orgId")).toBe(false);
    expect(Object.hasOwn(patchPayload, "orgId")).toBe(false);
  });

  it("gives a patch no way to name a tenant, at compile time or run time", () => {
    expect(
      failure(() =>
        // @ts-expect-error a patch may never restate the tenant
        tenantUpdatePayload({ orgId: ORG_FOREIGN }, REQUEST_ID),
      ).error.code,
    ).toBe("INVALID_WRITE");
  });

  it("keeps the allowlist as the only source of tenant table names", () => {
    for (const name of TENANT_TABLES) {
      const candidate: string = name;
      assertTenantTableName(candidate, REQUEST_ID);

      const narrowed: TenantTableName = candidate;
      expect(TENANT_TABLE_NAMES.has(narrowed)).toBe(true);
    }
  });
});
