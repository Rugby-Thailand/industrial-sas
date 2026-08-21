/**
 * Integration tier — the derived tenant index metadata
 * (`convex/lib/tenantIndexPolicy.ts`, T05b1c).
 *
 * Two questions, and they are different: *does the metadata describe the real
 * schema?* and *does the derivation fail closed on a schema that has drifted?*
 * The first is answered against `convex/schema.ts`. The second cannot be — proving
 * a guard by breaking the real schema would leave the repository one forgotten
 * revert away from shipping the break — so it is answered against synthetic
 * `TableFacts`, the same arrangement
 * `tests/isolation/schema-policy-guards.isolation.test.ts` uses.
 *
 * Nothing here reads a document. There is no Convex deployment and no
 * `convex-test`; `G-102` stays open until the Convex adapter and the function
 * wrappers exist.
 */
import { describe, expect, it } from "vitest";

import schema from "../../convex/schema";
import {
  TENANT_TABLES,
  describeSchema,
  type TableFacts,
} from "../../convex/lib/schemaPolicy";
import {
  TENANT_INDEX_METADATA,
  deriveTenantIndexMetadata,
  describeTenantIndex,
  tenantIndexMetadataDrift,
} from "../../convex/lib/tenantIndexPolicy";

const REAL_FACTS = describeSchema(schema);

/** A table as the policy would describe it, with only what this module reads. */
function facts(
  overrides: Partial<TableFacts> & Pick<TableFacts, "name" | "classification">,
): TableFacts {
  return {
    fieldNames: ["orgId"],
    optionalFieldNames: [],
    fieldPaths: ["orgId"],
    indexes: [],
    ...overrides,
  };
}

describe("metadata derived from the real schema", () => {
  it("describes every tenant table", () => {
    for (const table of TENANT_TABLES) {
      expect(TENANT_INDEX_METADATA.has(table)).toBe(true);
      expect(TENANT_INDEX_METADATA.get(table)?.size ?? 0).toBeGreaterThan(0);
    }
  });

  it("describes no global or unknown table", () => {
    for (const table of ["organizations", "users", "permissions", "nope"]) {
      expect(TENANT_INDEX_METADATA.has(table)).toBe(false);
    }
  });

  it("describes exactly the canonical tenant tables and nothing else", () => {
    expect([...TENANT_INDEX_METADATA.keys()].sort()).toEqual(
      [...TENANT_TABLES].sort(),
    );
  });

  it("records each index exactly as declared, orgId first", () => {
    const declared = new Map(REAL_FACTS.map((table) => [table.name, table]));

    for (const [table, indexes] of TENANT_INDEX_METADATA) {
      for (const [name, index] of indexes) {
        const source = declared
          .get(table)
          ?.indexes.find((candidate) => candidate.name === name);

        expect(source).toBeDefined();
        expect([...index.fields]).toEqual([...(source?.fields ?? [])]);
        expect(index.fields[0]).toBe("orgId");
        expect([...index.fieldsAfterOrg]).toEqual(index.fields.slice(1));
        expect(index.table).toBe(table);
      }
    }
  });

  it("reports no drift", () => {
    expect(tenantIndexMetadataDrift(REAL_FACTS, TENANT_INDEX_METADATA)).toEqual(
      [],
    );
  });

  it("cannot be widened by a holder of the metadata", () => {
    const mutable = TENANT_INDEX_METADATA as Map<string, never>;

    expect(() => mutable.set("organizations", undefined as never)).toThrow(
      /immutable/,
    );
    expect(() => mutable.delete("warehouses")).toThrow(/immutable/);
    expect(() => mutable.clear()).toThrow(/immutable/);

    const indexes = TENANT_INDEX_METADATA.get("warehouses") as Map<
      string,
      never
    >;
    expect(() => indexes.set("by_anything", undefined as never)).toThrow(
      /immutable/,
    );

    // Unchanged after every attempt.
    expect(TENANT_INDEX_METADATA.has("organizations")).toBe(false);
    expect(TENANT_INDEX_METADATA.has("warehouses")).toBe(true);
  });

  it("freezes the field lists it hands out", () => {
    const index = describeTenantIndex("warehouses", "by_orgId_status_code");

    expect(index).toBeDefined();
    expect(Object.isFrozen(index)).toBe(true);
    expect(Object.isFrozen(index?.fields)).toBe(true);
    expect(Object.isFrozen(index?.fieldsAfterOrg)).toBe(true);
  });
});

describe("lookup by (table, index)", () => {
  it("answers a declared tenant index", () => {
    expect(describeTenantIndex("warehouses", "by_orgId_code")).toEqual({
      table: "warehouses",
      name: "by_orgId_code",
      fields: ["orgId", "code"],
      fieldsAfterOrg: ["code"],
    });
  });

  it("answers undefined for every kind of miss", () => {
    for (const [table, index] of [
      // A global table, whose index exists and is not tenant-scoped.
      ["organizations", "by_clerkOrganizationId"],
      // A table in no part of the schema.
      ["invoices", "by_orgId_number"],
      // A tenant table, with an index it does not declare.
      ["warehouses", "by_orgId_name"],
      // A tenant table, with the name of another table's index.
      ["warehouses", "by_orgId_userId"],
      // Names that are not names.
      ["warehouses", ""],
      ["", "by_orgId_code"],
      ["warehouses", "__proto__"],
      ["__proto__", "by_orgId_code"],
    ]) {
      expect(describeTenantIndex(table ?? "", index ?? "")).toBeUndefined();
    }
  });
});

describe("derivation on a drifted schema", () => {
  it("omits an index that does not begin with orgId, and reports it", () => {
    const drifted = [
      facts({
        name: "warehouses",
        classification: "tenant",
        indexes: [
          { name: "by_code", fields: ["code"] },
          { name: "by_orgId_code", fields: ["orgId", "code"] },
        ],
      }),
    ];
    const metadata = deriveTenantIndexMetadata(drifted);

    expect([...(metadata.get("warehouses")?.keys() ?? [])]).toEqual([
      "by_orgId_code",
    ]);
    expect(
      describeTenantIndex("warehouses", "by_code", metadata),
    ).toBeUndefined();
    expect(tenantIndexMetadataDrift(drifted, metadata)).toContainEqual(
      expect.stringContaining("warehouses.by_code"),
    );
  });

  it("omits an index that repeats a field", () => {
    const drifted = [
      facts({
        name: "devices",
        classification: "tenant",
        indexes: [{ name: "by_orgId_orgId", fields: ["orgId", "orgId"] }],
      }),
    ];
    const metadata = deriveTenantIndexMetadata(drifted);

    expect(metadata.get("devices")?.size).toBe(0);
    const drift = tenantIndexMetadataDrift(drifted, metadata);
    expect(drift).toContainEqual(
      expect.stringContaining("devices.by_orgId_orgId"),
    );
    expect(drift).toContainEqual(
      expect.stringContaining("devices: tenant table has no usable"),
    );
  });

  it("omits every index of a table it does not classify as tenant", () => {
    const metadata = deriveTenantIndexMetadata([
      facts({
        name: "warehouses",
        classification: "global",
        indexes: [{ name: "by_orgId_code", fields: ["orgId", "code"] }],
      }),
      facts({
        name: "invoices",
        classification: "unclassified",
        indexes: [{ name: "by_orgId_number", fields: ["orgId", "number"] }],
      }),
    ]);

    expect([...metadata.keys()]).toEqual([]);
  });

  it("reports a tenant table with no index at all", () => {
    const drifted = [facts({ name: "roles", classification: "tenant" })];

    expect(tenantIndexMetadataDrift(drifted)).toContainEqual(
      expect.stringContaining(
        "roles: tenant table has no usable orgId-first index",
      ),
    );
  });

  it("reports a tenant table the schema never defined", () => {
    expect(tenantIndexMetadataDrift([])).toEqual(
      TENANT_TABLES.map((name) =>
        expect.stringContaining(`${name}: tenant table named by TENANT_TABLES`),
      ),
    );
  });
});

describe("the canonical allowlist, not the claimed classification", () => {
  it("admits no name outside TENANT_TABLES, however it classifies itself", () => {
    for (const name of ["invoices", "vehicleManifests", "__proto__", ""]) {
      const drifted = [
        facts({
          name,
          classification: "tenant",
          indexes: [{ name: "by_orgId_number", fields: ["orgId", "number"] }],
        }),
      ];
      const metadata = deriveTenantIndexMetadata(drifted);

      expect([...metadata.keys()]).toEqual([]);
      expect(
        describeTenantIndex(name, "by_orgId_number", metadata),
      ).toBeUndefined();
    }
  });

  it("reports such a table as unclassified, not as a tenant table missing indexes", () => {
    const drifted = [
      facts({
        name: "invoices",
        classification: "tenant",
        indexes: [{ name: "by_orgId_number", fields: ["orgId", "number"] }],
      }),
    ];
    const drift = tenantIndexMetadataDrift(drifted);

    expect(drift).toContainEqual(
      expect.stringContaining(
        'invoices: table is classified "tenant" but is not named by TENANT_TABLES',
      ),
    );
    expect(drift).not.toContainEqual(
      expect.stringContaining("invoices: tenant table has no usable"),
    );
    expect(drift).not.toContainEqual(
      expect.stringContaining("invoices.by_orgId_number"),
    );
  });

  it("admits no canonical name whose classification disagrees", () => {
    for (const classification of ["global", "unclassified"] as const) {
      const drifted = [
        facts({
          name: "warehouses",
          classification,
          indexes: [{ name: "by_orgId_code", fields: ["orgId", "code"] }],
        }),
      ];
      const metadata = deriveTenantIndexMetadata(drifted);

      expect(metadata.has("warehouses")).toBe(false);
      expect(
        describeTenantIndex("warehouses", "by_orgId_code", metadata),
      ).toBeUndefined();
      expect(tenantIndexMetadataDrift(drifted, metadata)).toContainEqual(
        expect.stringContaining(
          "warehouses: tenant table contributes no index metadata",
        ),
      );
    }
  });

  it("still admits every acceptable index the real schema declares", () => {
    for (const table of TENANT_TABLES) {
      const declared = REAL_FACTS.find((candidate) => candidate.name === table);
      const acceptable = (declared?.indexes ?? [])
        .filter(
          (index) =>
            index.fields[0] === "orgId" &&
            new Set(index.fields).size === index.fields.length,
        )
        .map((index) => index.name);

      expect(acceptable.length).toBeGreaterThan(0);
      expect(
        [...(TENANT_INDEX_METADATA.get(table)?.keys() ?? [])].sort(),
      ).toEqual([...acceptable].sort());
    }
  });
});
