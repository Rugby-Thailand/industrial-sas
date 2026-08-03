/**
 * Integration tier — adapter-backed tenant document access
 * (`createTenantDocumentAccess` in `convex/lib/tenantDb.ts`, T05b1b).
 *
 * This tier proves the accessor's contract: what it answers, in what order it
 * calls the port, what it derives, what it refuses, and what it keeps to itself.
 * The cross-tenant properties — absent and foreign being one answer, a denied
 * write reaching no mutating method, and no failure carrying a value — are proved
 * separately in `tests/isolation/tenant-document-access.isolation.test.ts`,
 * because those are the properties that block the merge gate (`RG-031`).
 *
 * Storage is the in-memory port fixture, which enforces nothing: no allowlist, no
 * `orgId`, no forbidden-field check. Every guard observed here is therefore the
 * accessor's own. There is no Convex deployment, no generated code, no
 * `convex-test`, and no environment variable; `G-102` stays open until the Convex
 * adapter, the index-backed reads, and the function wrappers exist.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { GLOBAL_TABLES } from "../../convex/lib/schemaPolicy";
import {
  FORBIDDEN_WRITE_FIELDS,
  TenantDbError,
  createTenantDocumentAccess,
  type TenantDocumentAccess,
  type TenantOrgId,
  type TenantOwnedDocument,
  type TenantTableName,
} from "../../convex/lib/tenantDb";
import { fixtureId } from "../fixtures/tenant-context-world";
import {
  createTenantStoragePortFixture,
  type TenantStoragePortFixture,
} from "../fixtures/tenant-storage-port";

const REQUEST_ID = "req_01JBZ0000000000000000000";
const ORG_A: TenantOrgId = fixtureId("organizations", "a");
const ORG_B: TenantOrgId = fixtureId("organizations", "b");

const TABLE: TenantTableName = "warehouses";
const OWN_ID = fixtureId("warehouses", "north");
const FOREIGN_ID = fixtureId("warehouses", "foreignNorth");
const ABSENT_ID = fixtureId("warehouses", "neverWritten");

/** A document with more than the discriminator, as a real table has. */
interface WarehouseLike extends TenantOwnedDocument {
  readonly code: string;
  readonly status: "ACTIVE" | "INACTIVE";
}

let storage: TenantStoragePortFixture;
let access: TenantDocumentAccess;

beforeEach(() => {
  storage = createTenantStoragePortFixture();
  access = createTenantDocumentAccess(
    { orgId: ORG_A, requestId: REQUEST_ID },
    storage.port,
  );

  storage.seed(TABLE, OWN_ID, {
    orgId: ORG_A,
    code: "NORTH",
    status: "ACTIVE",
  });
  storage.seed(TABLE, FOREIGN_ID, {
    orgId: ORG_B,
    code: "NORTH",
    status: "ACTIVE",
  });
});

/** The failure a caller can observe, reduced to what is comparable. */
async function denial(call: () => Promise<unknown>): Promise<TenantDbError> {
  try {
    await call();
  } catch (error) {
    if (!(error instanceof TenantDbError)) {
      throw new Error(
        `Expected a TenantDbError, received ${String(error)}. The boundary must ` +
          "raise exactly one error type.",
      );
    }
    return error;
  }
  throw new Error("Expected the call to reject, but it resolved.");
}

describe("the accessor a caller is handed", () => {
  it("exposes exactly the seven operations and nothing else", () => {
    expect(Object.keys(access).sort()).toEqual([
      "byIndex",
      "delete",
      "get",
      "getX",
      "insert",
      "patch",
      "replace",
    ]);
  });

  it("keeps the port to itself", () => {
    const reachable: unknown[] = [
      ...Object.values(access),
      Object.getPrototypeOf(access),
    ];

    for (const value of reachable) {
      expect(value).not.toBe(storage.port);
    }
    // Nor by any name a caller might guess.
    for (const name of ["port", "db", "storage", "scope", "orgId"]) {
      expect(Object.hasOwn(access, name)).toBe(false);
      expect((access as unknown as Record<string, unknown>)[name]).toBe(
        undefined,
      );
    }
  });

  it("cannot have an operation replaced or removed", () => {
    const mutable = access as unknown as Record<string, unknown>;

    expect(Object.isFrozen(access)).toBe(true);
    expect(() => {
      mutable.get = () => Promise.resolve(null);
    }).toThrow(TypeError);
    expect(() => {
      delete mutable.patch;
    }).toThrow(TypeError);
  });
});

describe("get", () => {
  it("answers with this tenant's document, exactly as stored", async () => {
    const document = await access.get<WarehouseLike>(TABLE, OWN_ID);

    expect(document).toBe(storage.stored(TABLE, OWN_ID));
    expect(document?.code).toBe("NORTH");
  });

  it("answers null for an absent document", async () => {
    expect(await access.get(TABLE, ABSENT_ID)).toBeNull();
  });

  it("answers null for another tenant's document", async () => {
    expect(await access.get(TABLE, FOREIGN_ID)).toBeNull();
  });

  it("answers null for a stored value that is not a usable document", async () => {
    const malformed: readonly unknown[] = [
      undefined,
      null,
      42,
      "warehouses:north",
      [{ orgId: ORG_A }],
      {},
      { orgId: null },
      { orgId: "" },
      { orgId: ` ${ORG_A}` },
    ];

    for (const [index, value] of malformed.entries()) {
      const id = storage.seed(TABLE, `warehouses:malformed-${index}`, value);
      expect(await access.get(TABLE, id)).toBeNull();
    }
  });

  it("answers null for an unusable ID without asking storage", async () => {
    for (const id of ["", " ", ` ${OWN_ID}`, `${OWN_ID} `]) {
      expect(await access.get(TABLE, id)).toBeNull();
    }
    expect(storage.calls()).toEqual([]);
  });
});

describe("getX", () => {
  it("answers with this tenant's document", async () => {
    const document = await access.getX<WarehouseLike>(TABLE, OWN_ID);

    expect(document).toBe(storage.stored(TABLE, OWN_ID));
  });

  it("raises NOT_FOUND for absent, foreign, and malformed alike", async () => {
    const malformedId = storage.seed(TABLE, "warehouses:untenanted", {
      code: "NORTH",
    });

    for (const id of [ABSENT_ID, FOREIGN_ID, malformedId]) {
      const error = await denial(() => access.getX(TABLE, id));

      expect(error.code).toBe("NOT_FOUND");
      expect(error.requestId).toBe(REQUEST_ID);
    }
  });

  it("agrees with get on every document, differing only in how it says no", async () => {
    for (const id of [OWN_ID, FOREIGN_ID, ABSENT_ID]) {
      const answer = await access.get(TABLE, id);

      if (answer === null) {
        expect((await denial(() => access.getX(TABLE, id))).code).toBe(
          "NOT_FOUND",
        );
      } else {
        expect(await access.getX(TABLE, id)).toBe(answer);
      }
    }
  });
});

describe("insert", () => {
  it("derives the tenant, stamps it first, and answers with the new ID", async () => {
    const id = await access.insert(TABLE, { code: "SOUTH", status: "ACTIVE" });
    const stored = storage.stored(TABLE, id) as Record<string, unknown>;

    expect(Object.keys(stored)).toEqual(["orgId", "code", "status"]);
    expect(stored.orgId).toBe(ORG_A);
  });

  it("stores a document no later step can add a field to", async () => {
    const id = await access.insert(TABLE, { code: "SOUTH" });

    expect(Object.isFrozen(storage.stored(TABLE, id))).toBe(true);
  });

  it("never writes the caller's own object", async () => {
    const payload = { code: "SOUTH" };
    const id = await access.insert(TABLE, payload);

    expect(storage.stored(TABLE, id)).not.toBe(payload);
    expect(payload).toEqual({ code: "SOUTH" });
    expect(Object.hasOwn(payload, "orgId")).toBe(false);
  });

  it("refuses a payload naming a field the caller does not own", async () => {
    for (const field of FORBIDDEN_WRITE_FIELDS) {
      const error = await denial(() =>
        access.insert(TABLE, { [field]: ORG_B, code: "SOUTH" } as never),
      );

      expect(error.code).toBe("INVALID_WRITE");
    }
    expect(storage.mutationCalls()).toEqual([]);
  });

  it("refuses a payload that is not a writable record", async () => {
    for (const payload of [null, undefined, 42, "SOUTH", [{ code: "SOUTH" }]]) {
      expect(
        (await denial(() => access.insert(TABLE, payload as never))).code,
      ).toBe("INVALID_WRITE");
    }
    expect(storage.mutationCalls()).toEqual([]);
  });
});

describe("patch, replace, and delete on this tenant's own document", () => {
  it("merges a patch and leaves the tenant alone", async () => {
    await access.patch(TABLE, OWN_ID, { status: "INACTIVE" });

    expect(storage.stored(TABLE, OWN_ID)).toEqual({
      orgId: ORG_A,
      code: "NORTH",
      status: "INACTIVE",
    });
  });

  it("passes the patch fields through unchanged, with no tenant added", async () => {
    const fields = { status: "INACTIVE" };
    await access.patch(TABLE, OWN_ID, fields);

    const [call] = storage.callsTo("patch");
    expect(call?.payload).toBe(fields);
    expect(fields).toEqual({ status: "INACTIVE" });
    expect(Object.hasOwn(fields, "orgId")).toBe(false);
  });

  it("re-derives the tenant on a replace, so a whole-document write keeps it", async () => {
    await access.replace(TABLE, OWN_ID, { code: "NORTH-2", status: "ACTIVE" });

    expect(storage.stored(TABLE, OWN_ID)).toEqual({
      orgId: ORG_A,
      code: "NORTH-2",
      status: "ACTIVE",
    });
  });

  it("removes the document on delete", async () => {
    await access.delete(TABLE, OWN_ID);

    expect(storage.stored(TABLE, OWN_ID)).toBe(undefined);
    expect(await access.get(TABLE, OWN_ID)).toBeNull();
  });

  it("reads before it writes, on every write path", async () => {
    await access.patch(TABLE, OWN_ID, { status: "INACTIVE" });
    await access.replace(TABLE, OWN_ID, { code: "NORTH", status: "ACTIVE" });
    await access.delete(TABLE, OWN_ID);

    expect(storage.calls().map((call) => call.method)).toEqual([
      "get",
      "patch",
      "get",
      "replace",
      "get",
      "delete",
    ]);
  });

  it("refuses an unsafe patch or replace payload after the ownership read", async () => {
    for (const field of FORBIDDEN_WRITE_FIELDS) {
      expect(
        (
          await denial(() =>
            access.patch(TABLE, OWN_ID, { [field]: ORG_B } as never),
          )
        ).code,
      ).toBe("INVALID_WRITE");
      expect(
        (
          await denial(() =>
            access.replace(TABLE, OWN_ID, { [field]: ORG_B } as never),
          )
        ).code,
      ).toBe("INVALID_WRITE");
    }

    expect(storage.mutationCalls()).toEqual([]);
    expect(storage.stored(TABLE, OWN_ID)).toEqual({
      orgId: ORG_A,
      code: "NORTH",
      status: "ACTIVE",
    });
  });
});

describe("the table allowlist is checked at run time, on every method", () => {
  const rejected: readonly string[] = [
    ...GLOBAL_TABLES,
    "noSuchTable",
    "",
    " warehouses",
    "WAREHOUSES",
    "__proto__",
    "constructor",
  ];

  /** Every operation, as a caller would invoke it against a given table name. */
  const operations: readonly (readonly [
    string,
    (table: TenantTableName) => Promise<unknown>,
  ])[] = [
    ["get", (table) => access.get(table, OWN_ID)],
    ["getX", (table) => access.getX(table, OWN_ID)],
    ["insert", (table) => access.insert(table, { code: "SOUTH" })],
    ["patch", (table) => access.patch(table, OWN_ID, { code: "SOUTH" })],
    ["replace", (table) => access.replace(table, OWN_ID, { code: "SOUTH" })],
    ["delete", (table) => access.delete(table, OWN_ID)],
  ];

  for (const [name, operation] of operations) {
    it(`refuses a global or unknown table on ${name}`, async () => {
      for (const table of rejected) {
        // Boundary cast: the point of the test is a name the compiler would
        // reject arriving from a `string` it never saw.
        const smuggled = table as TenantTableName;

        expect((await denial(() => operation(smuggled))).code).toBe(
          "INVALID_TENANT_TABLE",
        );
      }
    });
  }

  it("touches storage for none of them", async () => {
    for (const table of rejected) {
      const smuggled = table as TenantTableName;

      for (const [, operation] of operations) {
        await denial(() => operation(smuggled));
      }
    }

    expect(storage.calls()).toEqual([]);
  });

  it("still refuses a global table whose row exists and looks owned", async () => {
    const id = storage.seed("organizations", "organizations:a", {
      orgId: ORG_A,
      name: "Tenant A",
    });

    expect(
      (await denial(() => access.getX("organizations" as TenantTableName, id)))
        .code,
    ).toBe("INVALID_TENANT_TABLE");
    expect(storage.calls()).toEqual([]);
  });
});

describe("a failure raised by the adapter", () => {
  it("reaches the caller with its safe shape intact", async () => {
    const raised = new TenantDbError("INVALID_INDEX_RESULT", REQUEST_ID);
    storage.failOn("get", raised);

    const error = await denial(() => access.getX(TABLE, OWN_ID));

    expect(error).toBe(raised);
    expect(error.toPublic()).toEqual({
      code: "INVALID_INDEX_RESULT",
      requestId: REQUEST_ID,
    });
  });

  it("is not absorbed by get, which folds only NOT_FOUND", async () => {
    storage.failOn("get", new TenantDbError("INVALID_WRITE", REQUEST_ID));

    expect((await denial(() => access.get(TABLE, OWN_ID))).code).toBe(
      "INVALID_WRITE",
    );
  });

  it("lets a NOT_FOUND from the adapter mean the same as an absent document", async () => {
    storage.failOn("get", new TenantDbError("NOT_FOUND", REQUEST_ID));

    expect(await access.get(TABLE, OWN_ID)).toBeNull();
    expect((await denial(() => access.getX(TABLE, OWN_ID))).code).toBe(
      "NOT_FOUND",
    );
  });

  it("travels unchanged when it is not a boundary error at all", async () => {
    const raised = new Error("adapter exploded");
    storage.failOn("get", raised);

    await expect(access.get(TABLE, OWN_ID)).rejects.toBe(raised);
    await expect(access.patch(TABLE, OWN_ID, { code: "S" })).rejects.toBe(
      raised,
    );
    expect(storage.mutationCalls()).toEqual([]);
  });
});

describe("a scope the auth wrapper could not resolve properly", () => {
  it("fails closed on every path rather than failing differently", async () => {
    for (const orgId of ["", " ", `${ORG_A} `]) {
      const unusable = createTenantDocumentAccess(
        // Boundary cast: an unusable tenant key cannot be written in the
        // accessor's own types, and is exactly what must not resolve anything.
        { orgId: orgId as TenantOrgId, requestId: REQUEST_ID },
        storage.port,
      );

      expect(await unusable.get(TABLE, OWN_ID)).toBeNull();
      expect((await denial(() => unusable.getX(TABLE, OWN_ID))).code).toBe(
        "NOT_FOUND",
      );
      expect(
        (await denial(() => unusable.insert(TABLE, { code: "SOUTH" }))).code,
      ).toBe("INVALID_WRITE");
      expect((await denial(() => unusable.delete(TABLE, OWN_ID))).code).toBe(
        "NOT_FOUND",
      );
    }

    expect(storage.mutationCalls()).toEqual([]);
  });
});
