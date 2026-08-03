/**
 * Isolation tier — cross-tenant properties of adapter-backed document access
 * (`createTenantDocumentAccess` in `convex/lib/tenantDb.ts`, T05b1b).
 *
 * The isolation tier is a blocking merge gate (`RG-031`). This file does not
 * close it, and it does not close `RG-013` or `G-102`: there is still no Convex
 * adapter, no index-backed read, and no deployed function, so nothing here proves
 * that a *deployed* query rejects a cross-tenant document ID. What it proves is
 * the layer such a query will be built on, by attacking it — two accessors, two
 * tenants, one permissive store between them.
 *
 * The store is the in-memory port fixture, which checks nothing: it will happily
 * hand over another tenant's document and happily patch it. Every refusal
 * observed here is the accessor's, and every call the fixture records is a call
 * the accessor chose to make. That is what makes "no mutation happened" a
 * provable statement rather than an inference from an answer.
 *
 * The properties under attack:
 *
 * - a document ID from another tenant is answered as `null` by `get` and as
 *   `NOT_FOUND` by `getX`, indistinguishable from an ID that was never written
 *   (`INV-0002-03`) — a document ID needs no index, so a caller can hold one
 *   without ever having been allowed to see it;
 * - a denied patch, replace, or delete reaches no mutating method on the port at
 *   all, so the denial is not a rolled-back write (`ADR-0002` §2);
 * - the tenant on a write comes from the scope, never the payload
 *   (`INV-0001-02`), on insert and on replace alike;
 * - a tenant-scoped path cannot be aimed at a global table, even one whose row
 *   would pass the ownership check (`ADR-0002` §1);
 * - no failure carries a table name, a document ID, an `orgId`, a field name, or
 *   any part of a payload (`INV-0002-07`).
 *
 * The two tenants' documents are given the same key on purpose. Similarity of
 * shape must buy an attacker nothing: ownership is decided by comparing keys, not
 * by how different they look.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { GLOBAL_TABLES, TENANT_TABLES } from "../../convex/lib/schemaPolicy";
import {
  TENANT_DB_ERROR_MESSAGE,
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

/** The reader's tenant. */
const ORG_HOME: TenantOrgId = fixtureId("organizations", "home");
/** Another customer's tenant. Same shape, different key. */
const ORG_FOREIGN: TenantOrgId = fixtureId("organizations", "foreign");

const TABLE: TenantTableName = "warehouses";
/** Same table, same key shape, different tenant. */
const HOME_ID = fixtureId("warehouses", "north-home");
const FOREIGN_ID = fixtureId("warehouses", "north-foreign");
const ABSENT_ID = fixtureId("warehouses", "north-absent");

/** The foreign document, verbatim: nothing here may ever surface in a failure. */
const FOREIGN_DOCUMENT = {
  orgId: ORG_FOREIGN,
  code: "SECRET_LOT_CODE",
  supplierPriceThb: 1234,
} as const;

/** Values that must never appear anywhere in a failure. */
const SECRETS = [
  ORG_FOREIGN,
  "foreign",
  FOREIGN_ID,
  "SECRET_LOT_CODE",
  "supplierPriceThb",
  "1234",
] as const;

interface WarehouseLike extends TenantOwnedDocument {
  readonly code: string;
}

let storage: TenantStoragePortFixture;
/** The accessor under attack. */
let home: TenantDocumentAccess;
/** The other tenant's accessor, over the same store. */
let foreign: TenantDocumentAccess;

beforeEach(() => {
  storage = createTenantStoragePortFixture();
  home = createTenantDocumentAccess(
    { orgId: ORG_HOME, requestId: REQUEST_ID },
    storage.port,
  );
  foreign = createTenantDocumentAccess(
    { orgId: ORG_FOREIGN, requestId: REQUEST_ID },
    storage.port,
  );

  storage.seed(TABLE, HOME_ID, { orgId: ORG_HOME, code: "NORTH" });
  storage.seed(TABLE, FOREIGN_ID, FOREIGN_DOCUMENT);
});

/** Everything a caller can see of a rejected operation. */
async function failure(call: () => Promise<unknown>): Promise<{
  readonly error: TenantDbError;
  readonly surface: string;
}> {
  try {
    await call();
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
  throw new Error("Expected the call to reject, but it resolved.");
}

describe("two tenants reading by document ID over one store", () => {
  it("each reads its own document and no other", async () => {
    expect((await home.getX<WarehouseLike>(TABLE, HOME_ID)).orgId).toBe(
      ORG_HOME,
    );
    expect((await foreign.getX<WarehouseLike>(TABLE, FOREIGN_ID)).orgId).toBe(
      ORG_FOREIGN,
    );
  });

  it("answers null for the other tenant's ID in both directions", async () => {
    expect(await home.get(TABLE, FOREIGN_ID)).toBeNull();
    expect(await foreign.get(TABLE, HOME_ID)).toBeNull();
  });

  it("hands back the foreign document to nobody, though the store offers it", async () => {
    // The store is willing: the accessor is what refuses.
    expect(await storage.port.get(TABLE, FOREIGN_ID)).toEqual(FOREIGN_DOCUMENT);
    expect(await home.get(TABLE, FOREIGN_ID)).toBeNull();
  });
});

describe("absent and foreign are the same answer", () => {
  it("are both null from get", async () => {
    expect(await home.get(TABLE, FOREIGN_ID)).toBeNull();
    expect(await home.get(TABLE, ABSENT_ID)).toBeNull();
  });

  it("produce payloads from getX that are equal field for field", async () => {
    const absent = await failure(() => home.getX(TABLE, ABSENT_ID));
    const other = await failure(() => home.getX(TABLE, FOREIGN_ID));

    expect(other.error.toPublic()).toEqual(absent.error.toPublic());
    expect(Object.keys(other.error.toPublic())).toEqual(
      Object.keys(absent.error.toPublic()),
    );
  });

  it("produce an identical observable surface from every ID-addressed method", async () => {
    const attempts: readonly ((
      access: TenantDocumentAccess,
      id: string,
    ) => Promise<unknown>)[] = [
      (access, id) => access.getX(TABLE, id),
      (access, id) => access.patch(TABLE, id, { code: "TAKEN" }),
      (access, id) => access.replace(TABLE, id, { code: "TAKEN" }),
      (access, id) => access.delete(TABLE, id),
    ];

    for (const attempt of attempts) {
      const absent = await failure(() => attempt(home, ABSENT_ID));
      const other = await failure(() => attempt(home, FOREIGN_ID));

      expect(other.error.code).toBe("NOT_FOUND");
      expect(other.surface).toBe(absent.surface);
    }
  });

  it("answers the same for a malformed document as for a foreign one", async () => {
    const malformed: readonly unknown[] = [
      undefined,
      {},
      { orgId: null },
      { orgId: 42 },
      { orgId: "" },
      { orgId: ` ${ORG_HOME}` },
      { orgId: `${ORG_HOME}x` },
      { orgId: ORG_HOME.toUpperCase() },
      [{ orgId: ORG_HOME }],
      "warehouses:north-home",
    ];
    const other = await failure(() => home.getX(TABLE, FOREIGN_ID));

    for (const [index, document] of malformed.entries()) {
      const id = storage.seed(TABLE, `warehouses:malformed-${index}`, document);
      const observed = await failure(() => home.getX(TABLE, id));

      expect(observed.error.code).toBe("NOT_FOUND");
      expect(observed.surface).toBe(other.surface);
      expect(await home.get(TABLE, id)).toBeNull();
    }
  });
});

describe("a denied write is not a rolled-back write", () => {
  const denied: readonly (readonly [
    string,
    (id: string) => Promise<unknown>,
  ])[] = [
    ["patch", (id) => home.patch(TABLE, id, { code: "TAKEN" })],
    ["replace", (id) => home.replace(TABLE, id, { code: "TAKEN" })],
    ["delete", (id) => home.delete(TABLE, id)],
  ];

  for (const [name, attempt] of denied) {
    it(`reaches no mutating method when ${name} names another tenant's document`, async () => {
      expect((await failure(() => attempt(FOREIGN_ID))).error.code).toBe(
        "NOT_FOUND",
      );

      expect(storage.mutationCalls()).toEqual([]);
      expect(storage.callsTo("get")).toHaveLength(1);
      expect(storage.stored(TABLE, FOREIGN_ID)).toEqual(FOREIGN_DOCUMENT);
    });

    it(`reaches no mutating method when ${name} names an absent document`, async () => {
      expect((await failure(() => attempt(ABSENT_ID))).error.code).toBe(
        "NOT_FOUND",
      );

      expect(storage.mutationCalls()).toEqual([]);
      expect(storage.size()).toBe(2);
    });

    it(`asks storage nothing when ${name} names an unusable document ID`, async () => {
      for (const id of ["", " ", `${FOREIGN_ID} `]) {
        expect((await failure(() => attempt(id))).error.code).toBe("NOT_FOUND");
      }

      expect(storage.calls()).toEqual([]);
    });
  }

  it("leaves the foreign document byte-for-byte after every attempt", async () => {
    const before = storage.stored(TABLE, FOREIGN_ID);

    for (const [, attempt] of denied) {
      await failure(() => attempt(FOREIGN_ID));
    }

    // The very object seeded, not an equal copy: a merge or a replace would have
    // substituted a new one, and a delete would have left `undefined`.
    expect(storage.stored(TABLE, FOREIGN_ID)).toBe(before);
    expect(storage.stored(TABLE, FOREIGN_ID)).toEqual(FOREIGN_DOCUMENT);
    expect(await foreign.getX<WarehouseLike>(TABLE, FOREIGN_ID)).toEqual(
      FOREIGN_DOCUMENT,
    );
  });
});

describe("a write cannot choose its tenant", () => {
  it("stamps the scope's tenant on insert, never another's", async () => {
    const id = await home.insert(TABLE, { code: "NEW" });
    const stored = storage.stored(TABLE, id) as Record<string, unknown>;

    expect(stored.orgId).toBe(ORG_HOME);
    expect(stored.orgId).not.toBe(ORG_FOREIGN);
    expect(await foreign.get(TABLE, id)).toBeNull();
  });

  it("refuses rather than overwrites when the payload names a tenant", async () => {
    for (const orgId of [ORG_HOME, ORG_FOREIGN]) {
      expect(
        (await failure(() => home.insert(TABLE, { orgId } as never))).error
          .code,
      ).toBe("INVALID_WRITE");
      expect(
        (await failure(() => home.replace(TABLE, HOME_ID, { orgId } as never)))
          .error.code,
      ).toBe("INVALID_WRITE");
    }

    expect(storage.mutationCalls()).toEqual([]);
  });

  it("keeps the tenant on a replace, which rewrites the whole document", async () => {
    await home.replace(TABLE, HOME_ID, { code: "NORTH-2" });

    expect(storage.stored(TABLE, HOME_ID)).toEqual({
      orgId: ORG_HOME,
      code: "NORTH-2",
    });
    expect((await home.getX<WarehouseLike>(TABLE, HOME_ID)).code).toBe(
      "NORTH-2",
    );
    expect(await foreign.get(TABLE, HOME_ID)).toBeNull();
  });

  it("cannot be talked into replacing a document it may not read", async () => {
    expect(
      (await failure(() => home.replace(TABLE, FOREIGN_ID, { code: "TAKEN" })))
        .error.code,
    ).toBe("NOT_FOUND");
    expect(storage.stored(TABLE, FOREIGN_ID)).toEqual(FOREIGN_DOCUMENT);
  });
});

describe("the tenant-scoped path cannot be pointed at a global table", () => {
  it("refuses each global table on a read, and asks storage nothing", async () => {
    for (const name of GLOBAL_TABLES) {
      // Boundary cast: a name the compiler would reject, arriving as a `string`.
      const table = name as unknown as TenantTableName;

      expect((await failure(() => home.getX(table, HOME_ID))).error.code).toBe(
        "INVALID_TENANT_TABLE",
      );
    }

    expect(storage.calls()).toEqual([]);
  });

  it("refuses a global table identically to a table that does not exist", async () => {
    const global = await failure(() =>
      home.getX("organizations" as unknown as TenantTableName, HOME_ID),
    );
    const unknown = await failure(() =>
      home.getX("noSuchTable" as unknown as TenantTableName, HOME_ID),
    );

    expect(global.error.toPublic()).toEqual(unknown.error.toPublic());
    expect(global.surface).toBe(unknown.surface);
  });

  it("names no table in the failure", async () => {
    const { surface } = await failure(() =>
      home.getX("organizations" as unknown as TenantTableName, HOME_ID),
    );

    for (const name of [...GLOBAL_TABLES, ...TENANT_TABLES]) {
      expect(surface).not.toContain(name);
    }
  });
});

describe("no failure carries a value", () => {
  const calls: readonly (readonly [string, () => Promise<unknown>])[] = [
    [
      "global table",
      () => home.getX("organizations" as unknown as TenantTableName, HOME_ID),
    ],
    ["foreign read", () => home.getX(TABLE, FOREIGN_ID)],
    ["foreign patch", () => home.patch(TABLE, FOREIGN_ID, { code: "TAKEN" })],
    ["foreign delete", () => home.delete(TABLE, FOREIGN_ID)],
    [
      "caller-supplied tenant",
      () =>
        home.insert(TABLE, {
          orgId: ORG_FOREIGN,
          code: "SECRET_LOT_CODE",
          supplierPriceThb: 1234,
        } as never),
    ],
  ];

  for (const [what, call] of calls) {
    it(`leaks nothing when rejecting a ${what}`, async () => {
      const { error, surface } = await failure(call);

      for (const secret of SECRETS) {
        expect(surface).not.toContain(secret);
      }
      expect(error.message).toBe(TENANT_DB_ERROR_MESSAGE);
      expect(Object.keys(error.toPublic())).toEqual(["code", "requestId"]);
      expect(error.toPublic().requestId).toBe(REQUEST_ID);
    });
  }

  it("uses one message for every code, so the message is not a channel", async () => {
    const messages = new Set<string>();

    for (const [, call] of calls) {
      messages.add((await failure(call)).error.message);
    }

    expect([...messages]).toEqual([TENANT_DB_ERROR_MESSAGE]);
  });

  it("says nothing about the foreign document even when the store holds it", async () => {
    const { surface } = await failure(() => home.getX(TABLE, FOREIGN_ID));

    expect(JSON.stringify(FOREIGN_DOCUMENT)).toContain("SECRET_LOT_CODE");
    expect(surface).not.toContain("SECRET_LOT_CODE");
  });
});
