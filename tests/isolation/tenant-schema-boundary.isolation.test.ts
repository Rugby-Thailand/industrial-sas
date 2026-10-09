import { describe, expect, it } from "vitest";

import {
  GLOBAL_TABLES,
  TENANT_TABLES,
  describeSchema,
  forbiddenFieldPaths,
  globalTableViolations,
  missingTables,
  schemaPolicyViolations,
  tenantTableViolations,
  unclassifiedTables,
  type TableFacts,
} from "../../convex/lib/schemaPolicy";
import schema from "../../convex/schema";

const facts = describeSchema(schema);
const tenantFacts = facts.filter((table) => table.classification === "tenant");
const globalFacts = facts.filter((table) => table.classification === "global");

function tableFacts(name: string): TableFacts {
  const table = facts.find((candidate) => candidate.name === name);
  if (table === undefined) {
    throw new Error(`Table "${name}" is missing from the schema.`);
  }
  return table;
}

describe("the schema as a whole", () => {
  it("violates no policy rule", () => {
    expect(schemaPolicyViolations(facts)).toEqual([]);
  });

  it("names its session table exactly as plan §7.1 names it", () => {
    const names = facts.map((table) => table.name);
    expect(names).toContain("sessionsAudit");
    expect(names).not.toContain("sessionAudit");
  });
});

describe("schema table classification", () => {
  it("classifies every table in the schema", () => {
    expect(unclassifiedTables(facts)).toEqual([]);
  });

  it("defines every table the policy expects", () => {
    expect(missingTables(facts)).toEqual([]);
  });

  it("allows exactly organizations, users, and permissions to omit orgId", () => {
    expect([...GLOBAL_TABLES]).toEqual([
      "organizations",
      "users",
      "permissions",
    ]);
    expect(globalFacts.map((table) => table.name).sort()).toEqual(
      [...GLOBAL_TABLES].sort(),
    );
  });

  it("accounts for every table as either global or tenant-scoped", () => {
    expect(facts.length).toBe(GLOBAL_TABLES.length + TENANT_TABLES.length);
  });
});

describe("tenant tables", () => {
  it("declares every tenant table this slice needs", () => {
    expect(tenantFacts.length).toBe(TENANT_TABLES.length);
  });

  it.each([...TENANT_TABLES])(
    "%s carries orgId and indexes it first",
    (name) => {
      expect(tenantTableViolations(tableFacts(name))).toEqual([]);
    },
  );

  it.each([...TENANT_TABLES])(
    "%s declares orgId as a required field",
    (name) => {
      const table = tableFacts(name);
      expect(table.fieldNames[0]).toBe("orgId");
      expect(table.optionalFieldNames).not.toContain("orgId");
    },
  );

  it("has no tenant index that could range across tenants", () => {
    const offending = tenantFacts.flatMap((table) =>
      table.indexes
        .filter((index) => index.fields[0] !== "orgId")
        .map((index) => `${table.name}.${index.name}`),
    );
    expect(offending).toEqual([]);
  });

  it("normalizes membership warehouse scope into rows rather than an array", () => {
    const memberships = tableFacts("memberships");
    const arrayFields = memberships.fieldPaths.filter((path) =>
      path.includes("[]"),
    );
    expect(arrayFields).toEqual([]);
    expect(tableFacts("membershipWarehouses").fieldNames).toContain(
      "warehouseId",
    );
    expect(tableFacts("membershipRoles").fieldNames).toContain("roleId");
  });
});

describe("global tables", () => {
  it.each([...GLOBAL_TABLES])(
    "%s does not carry a tenant discriminator",
    (name) => {
      expect(globalTableViolations(tableFacts(name))).toEqual([]);
    },
  );
});

describe("credential material", () => {
  it("stores no field named after a password, MFA secret, token, or API key", () => {
    const offending = facts.flatMap((table) => forbiddenFieldPaths(table));
    expect(offending).toEqual([]);
  });

  it("checks nested field paths, not only top-level fields", () => {
    expect(tableFacts("organizations").fieldPaths).toContain("settings.locale");
    expect(tableFacts("auditEvents").fieldPaths).toContain("changes[].field");
  });
});
