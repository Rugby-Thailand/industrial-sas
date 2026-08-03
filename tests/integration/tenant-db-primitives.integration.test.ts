/**
 * Integration tier — the tenant document boundary primitives
 * (`convex/lib/tenantDb.ts`, T05b1a).
 *
 * This tier proves the primitives behave as their contract says: the runtime
 * allowlist is derived and immutable, the table assertion narrows or fails
 * closed, ownership is asserted rather than assumed, and write payloads are
 * validated without the caller's object ever being touched.
 *
 * The cross-tenant properties — absent and foreign being indistinguishable, and
 * no failure carrying a value — are proved separately in
 * `tests/isolation/tenant-db-primitives.isolation.test.ts`, because those are the
 * properties that block the merge gate (`RG-031`) rather than merely describing
 * the API.
 *
 * Runs with no Convex deployment, no generated code, and no environment
 * variable: every function under test is pure, and a document is an ordinary
 * object.
 */
import { describe, expect, it } from "vitest";

import { GLOBAL_TABLES, TENANT_TABLES } from "../../convex/lib/schemaPolicy";
import {
  FORBIDDEN_WRITE_FIELDS,
  TENANT_DB_ERROR_CODES,
  TENANT_DB_ERROR_MESSAGE,
  TENANT_TABLE_NAMES,
  TenantDbError,
  assertOwnedDocument,
  assertTenantTableName,
  tenantInsertPayload,
  tenantUpdatePayload,
  type TenantOrgId,
  type TenantOwnedDocument,
  type TenantTableName,
} from "../../convex/lib/tenantDb";
import { fixtureId } from "../fixtures/tenant-context-world";

const REQUEST_ID = "req_01JBZ0000000000000000000";
const ORG_A: TenantOrgId = fixtureId("organizations", "a");
const ORG_B: TenantOrgId = fixtureId("organizations", "b");

/** A document shape with more than the discriminator, as a real table has. */
interface WarehouseLike extends TenantOwnedDocument {
  readonly _id: string;
  readonly code: string;
  readonly status: "ACTIVE" | "INACTIVE";
}

function warehouse(orgId: TenantOrgId): WarehouseLike {
  return {
    orgId,
    _id: fixtureId("warehouses", "north"),
    code: "NORTH",
    status: "ACTIVE",
  };
}

/** The failure a caller can observe, reduced to what is actually comparable. */
function observe(call: () => unknown): {
  readonly code: string;
  readonly message: string;
  readonly publicKeys: readonly string[];
  readonly publicPayload: unknown;
} {
  try {
    call();
  } catch (error) {
    if (!(error instanceof TenantDbError)) {
      throw new Error(
        `Expected a TenantDbError, received ${String(error)}. The boundary must ` +
          "raise exactly one error type.",
      );
    }
    const payload = error.toPublic();
    return {
      code: error.code,
      message: error.message,
      publicKeys: Object.keys(payload),
      publicPayload: payload,
    };
  }
  throw new Error("Expected the call to throw, but it returned.");
}

describe("the runtime tenant table allowlist", () => {
  it("is derived from TENANT_TABLES rather than restated", () => {
    expect([...TENANT_TABLE_NAMES].sort()).toEqual([...TENANT_TABLES].sort());
    expect(TENANT_TABLE_NAMES.size).toBe(TENANT_TABLES.length);
  });

  it("contains no global table", () => {
    for (const name of GLOBAL_TABLES) {
      expect(TENANT_TABLE_NAMES.has(name as unknown as TenantTableName)).toBe(
        false,
      );
    }
  });

  it("answers membership only for own entries, not for prototype members", () => {
    for (const inherited of ["toString", "constructor", "__proto__", "has"]) {
      expect(TENANT_TABLE_NAMES.has(inherited as TenantTableName)).toBe(false);
    }
  });

  it("cannot be widened, narrowed, or emptied at runtime", () => {
    const mutable = TENANT_TABLE_NAMES as unknown as Set<string>;

    expect(Object.isFrozen(TENANT_TABLE_NAMES)).toBe(true);
    expect(() => mutable.add("smuggledTable")).toThrow(/immutable/);
    expect(() => mutable.delete("warehouses")).toThrow(/immutable/);
    expect(() => mutable.clear()).toThrow(/immutable/);
    expect([...TENANT_TABLE_NAMES].sort()).toEqual([...TENANT_TABLES].sort());
  });
});

describe("assertTenantTableName", () => {
  it("accepts every declared tenant table", () => {
    for (const name of TENANT_TABLES) {
      expect(() => {
        assertTenantTableName(name, REQUEST_ID);
      }).not.toThrow();
    }
  });

  it("narrows a string to TenantTableName", () => {
    const candidate: string = "warehouses";
    assertTenantTableName(candidate, REQUEST_ID);

    // Only reachable if the assertion narrowed: `string` is not assignable here.
    const narrowed: TenantTableName = candidate;
    expect(narrowed).toBe("warehouses");
  });

  it("rejects every global table with INVALID_TENANT_TABLE", () => {
    for (const name of GLOBAL_TABLES) {
      expect(observe(() => assertTenantTableName(name, REQUEST_ID)).code).toBe(
        "INVALID_TENANT_TABLE",
      );
    }
  });

  it("rejects unknown, empty, and near-miss names", () => {
    for (const name of [
      "",
      " warehouses",
      "warehouses ",
      "Warehouses",
      "WAREHOUSES",
      "warehouse",
      "purchaseOrders",
      "sessionAudit",
      "__proto__",
      "toString",
    ]) {
      expect(observe(() => assertTenantTableName(name, REQUEST_ID)).code).toBe(
        "INVALID_TENANT_TABLE",
      );
    }
  });
});

describe("TenantDbError", () => {
  it("declares exactly the codes the contract names", () => {
    expect([...TENANT_DB_ERROR_CODES]).toEqual([
      "INVALID_TENANT_TABLE",
      "NOT_FOUND",
      "INVALID_WRITE",
      "INVALID_LIMIT",
      "INVALID_INDEX_RESULT",
    ]);
  });

  it("is an Error with the one fixed message", () => {
    const error = new TenantDbError("NOT_FOUND", REQUEST_ID);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("TenantDbError");
    expect(error.message).toBe(TENANT_DB_ERROR_MESSAGE);
  });

  it("exposes a frozen public payload of exactly code and requestId", () => {
    const payload = new TenantDbError("INVALID_WRITE", REQUEST_ID).toPublic();

    expect(Object.keys(payload)).toEqual(["code", "requestId"]);
    expect(payload).toEqual({ code: "INVALID_WRITE", requestId: REQUEST_ID });
    expect(Object.isFrozen(payload)).toBe(true);
  });
});

describe("assertOwnedDocument", () => {
  it("returns the caller's document, by reference and untouched", () => {
    const document = warehouse(ORG_A);
    const result = assertOwnedDocument<WarehouseLike>(
      document,
      ORG_A,
      REQUEST_ID,
    );

    expect(result).toBe(document);
    expect(Object.isFrozen(document)).toBe(false);
    expect(document).toEqual(warehouse(ORG_A));
  });

  it("carries the caller's document type through", () => {
    const result = assertOwnedDocument<WarehouseLike>(
      warehouse(ORG_A),
      ORG_A,
      REQUEST_ID,
    );

    const code: string = result.code;
    expect(code).toBe("NORTH");
  });

  it("accepts a document that carries only the discriminator", () => {
    const document: TenantOwnedDocument = { orgId: ORG_A };
    expect(assertOwnedDocument(document, ORG_A, REQUEST_ID)).toBe(document);
  });

  it("rejects an unusable expected tenant key", () => {
    for (const expected of ["", " ", ` ${ORG_A}`, `${ORG_A} `]) {
      expect(
        observe(() =>
          assertOwnedDocument(
            warehouse(ORG_A),
            expected as TenantOrgId,
            REQUEST_ID,
          ),
        ).code,
      ).toBe("NOT_FOUND");
    }
  });

  it("rejects a document whose orgId is present but unusable", () => {
    for (const orgId of ["", " ", ` ${ORG_A}`, 1, true, null, {}, [ORG_A]]) {
      expect(
        observe(() => assertOwnedDocument({ orgId }, ORG_A, REQUEST_ID)).code,
      ).toBe("NOT_FOUND");
    }
  });

  it("rejects an inherited orgId", () => {
    const document = Object.create({ orgId: ORG_A }) as object;

    expect((document as TenantOwnedDocument).orgId).toBe(ORG_A);
    expect(
      observe(() => assertOwnedDocument(document, ORG_A, REQUEST_ID)).code,
    ).toBe("NOT_FOUND");
  });

  it("rejects a caller-supplied tenant key that is not an organization ID", () => {
    // @ts-expect-error a plain string is not a GenericId<"organizations">
    assertOwnedDocument(warehouse(ORG_A), "organizations:a", REQUEST_ID);
  });
});

describe("tenantInsertPayload", () => {
  it("derives orgId and writes it first", () => {
    const result = tenantInsertPayload(
      { code: "NORTH", status: "ACTIVE" },
      ORG_A,
      REQUEST_ID,
    );

    expect(Object.keys(result)).toEqual(["orgId", "code", "status"]);
    expect(result).toEqual({ orgId: ORG_A, code: "NORTH", status: "ACTIVE" });
  });

  it("returns a new frozen object and leaves the caller's payload alone", () => {
    const payload = { code: "NORTH" };
    const result = tenantInsertPayload(payload, ORG_A, REQUEST_ID);

    expect(result as unknown).not.toBe(payload);
    expect(payload).toEqual({ code: "NORTH" });
    expect(Object.hasOwn(payload, "orgId")).toBe(false);
    expect(Object.isFrozen(payload)).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => {
      (result as unknown as Record<string, unknown>).orgId = ORG_B;
    }).toThrow(TypeError);
    expect(result.orgId).toBe(ORG_A);
  });

  it("preserves an explicitly undefined field rather than dropping it", () => {
    const result = tenantInsertPayload(
      { code: "NORTH", note: undefined },
      ORG_A,
      REQUEST_ID,
    );

    expect(Object.hasOwn(result, "note")).toBe(true);
    expect(result.note).toBeUndefined();
  });

  it("rejects a payload that names any forbidden field", () => {
    expect([...FORBIDDEN_WRITE_FIELDS]).toEqual([
      "orgId",
      "_id",
      "_creationTime",
    ]);

    for (const field of FORBIDDEN_WRITE_FIELDS) {
      expect(
        observe(() =>
          tenantInsertPayload(
            { code: "NORTH", [field]: "anything" } as never,
            ORG_A,
            REQUEST_ID,
          ),
        ).code,
      ).toBe("INVALID_WRITE");
    }
  });

  it("rejects a forbidden field that is present but undefined", () => {
    expect(
      observe(() =>
        tenantInsertPayload({ orgId: undefined } as never, ORG_A, REQUEST_ID),
      ).code,
    ).toBe("INVALID_WRITE");
  });

  it("rejects any other Convex system field", () => {
    for (const field of ["_meta", "_deleted", "__proto__"]) {
      expect(
        observe(() =>
          tenantInsertPayload({ [field]: 1 } as never, ORG_A, REQUEST_ID),
        ).code,
      ).toBe("INVALID_WRITE");
    }
  });

  it("rejects a payload that is not a record", () => {
    for (const payload of [null, undefined, 0, "code", true, ["code"]]) {
      expect(
        observe(() => tenantInsertPayload(payload as never, ORG_A, REQUEST_ID))
          .code,
      ).toBe("INVALID_WRITE");
    }
  });

  it("rejects an unusable derived tenant key", () => {
    for (const orgId of ["", " ", ` ${ORG_A}`]) {
      expect(
        observe(() =>
          tenantInsertPayload(
            { code: "NORTH" },
            orgId as TenantOrgId,
            REQUEST_ID,
          ),
        ).code,
      ).toBe("INVALID_WRITE");
    }
  });

  it("makes a caller-chosen tenant a compile error as well as a runtime one", () => {
    expect(
      observe(() =>
        // @ts-expect-error the tenant discriminator is derived, never supplied
        tenantInsertPayload({ orgId: ORG_A, code: "NORTH" }, ORG_A, REQUEST_ID),
      ).code,
    ).toBe("INVALID_WRITE");
    expect(
      observe(() =>
        // @ts-expect-error Convex owns _id
        tenantInsertPayload({ _id: "warehouses:north" }, ORG_A, REQUEST_ID),
      ).code,
    ).toBe("INVALID_WRITE");
    expect(
      observe(() =>
        // @ts-expect-error Convex owns _creationTime
        tenantInsertPayload({ _creationTime: 0 }, ORG_A, REQUEST_ID),
      ).code,
    ).toBe("INVALID_WRITE");
  });
});

describe("tenantUpdatePayload", () => {
  it("returns the safe payload unchanged", () => {
    const payload = { code: "SOUTH", status: "INACTIVE" };
    const result = tenantUpdatePayload(payload, REQUEST_ID);

    expect(result).toBe(payload);
    expect(result).toEqual({ code: "SOUTH", status: "INACTIVE" });
    expect(Object.isFrozen(payload)).toBe(false);
  });

  it("adds no tenant discriminator, so a patch cannot move a document", () => {
    const result = tenantUpdatePayload({ code: "SOUTH" }, REQUEST_ID);

    expect(Object.hasOwn(result, "orgId")).toBe(false);
  });

  it("rejects every forbidden field", () => {
    for (const field of FORBIDDEN_WRITE_FIELDS) {
      expect(
        observe(() =>
          tenantUpdatePayload({ [field]: "anything" } as never, REQUEST_ID),
        ).code,
      ).toBe("INVALID_WRITE");
    }
  });

  it("rejects a payload that is not a record", () => {
    for (const payload of [null, undefined, 7, "code", ["code"]]) {
      expect(
        observe(() => tenantUpdatePayload(payload as never, REQUEST_ID)).code,
      ).toBe("INVALID_WRITE");
    }
  });

  it("makes a tenant-moving patch a compile error as well as a runtime one", () => {
    expect(
      observe(() =>
        // @ts-expect-error a patch may never restate the tenant
        tenantUpdatePayload({ orgId: ORG_B }, REQUEST_ID),
      ).code,
    ).toBe("INVALID_WRITE");
  });
});
