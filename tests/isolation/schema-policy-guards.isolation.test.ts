/**
 * Isolation tier — proof that the schema guards fail on a bad schema.
 *
 * `tenant-schema-boundary.isolation.test.ts` proves the real schema passes the
 * policy. On its own that is a weak claim: a check that returns "no problems" for
 * every input passes just as happily. This file feeds each check the shape it is
 * supposed to catch and asserts it complains.
 *
 * The inputs are synthetic: hand-written `TableFacts` values, and throwaway
 * `defineTable`/`defineSchema` values that exist only inside a test. The real
 * schema is never modified to demonstrate a guard, because a demonstration that
 * requires editing `convex/schema.ts` is one forgotten revert away from being the
 * committed state.
 *
 * Nothing here proves runtime isolation. These are shape checks over declarations;
 * there is no database, no Convex function, and no tenant-bound accessor yet.
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { describe, expect, it } from "vitest";

import {
  ALWAYS,
  FORBIDDEN_FIELD_PHRASES,
  FORBIDDEN_FIELD_WORDS,
  GLOBAL_TABLES,
  UNIQUENESS_CONTRACTS,
  cardinalityContradictions,
  classifyTable,
  closedValueSet,
  describeSchema,
  describeTable,
  fieldWords,
  forbiddenFieldPaths,
  globalTableViolations,
  lookupContractViolations,
  missingTables,
  schemaPolicyViolations,
  tenantTableViolations,
  unclassifiedTables,
  uniquenessContractViolations,
  type LookupContract,
  type TableFacts,
} from "../../convex/lib/schemaPolicy";

/**
 * A legal tenant table, as facts. Each test below mutates exactly one property of
 * a copy, so a failure names the single rule under test rather than "the fixture".
 */
const soundTenantTable: TableFacts = {
  name: "widgets",
  classification: "tenant",
  fieldNames: ["orgId", "code", "status"],
  optionalFieldNames: [],
  fieldPaths: ["orgId", "code", "status"],
  indexes: [
    { name: "by_orgId_code", fields: ["orgId", "code"] },
    { name: "by_orgId_status_code", fields: ["orgId", "status", "code"] },
  ],
};

function withFacts(overrides: Partial<TableFacts>): TableFacts {
  return { ...soundTenantTable, ...overrides };
}

describe("the fixture itself is legal", () => {
  it("reports no violation before anything is broken", () => {
    expect(tenantTableViolations(soundTenantTable)).toEqual([]);
    expect(forbiddenFieldPaths(soundTenantTable)).toEqual([]);
  });
});

describe("a missing or misplaced tenant discriminator is caught", () => {
  it("catches a tenant table with no orgId at all", () => {
    const problems = tenantTableViolations(
      withFacts({
        fieldNames: ["code", "status"],
        fieldPaths: ["code", "status"],
        indexes: [{ name: "by_code", fields: ["code"] }],
      }),
    );
    expect(problems).toContain('widgets: tenant table has no "orgId" field');
  });

  it("catches orgId declared somewhere other than first", () => {
    const problems = tenantTableViolations(
      withFacts({
        fieldNames: ["code", "orgId", "status"],
        fieldPaths: ["code", "orgId", "status"],
      }),
    );
    expect(problems).toEqual([
      'widgets: "orgId" is not the first declared field (found "code")',
    ]);
  });

  it("catches an optional orgId, which would let a document belong to no tenant", () => {
    const problems = tenantTableViolations(
      withFacts({ optionalFieldNames: ["orgId"] }),
    );
    expect(problems).toEqual([
      'widgets: "orgId" is optional; a document with no tenant belongs to every tenant',
    ]);
  });

  it("catches a wrongly named discriminator such as organizationId", () => {
    const problems = tenantTableViolations(
      withFacts({
        fieldNames: ["organizationId", "code"],
        fieldPaths: ["organizationId", "code"],
        indexes: [{ name: "by_organizationId", fields: ["organizationId"] }],
      }),
    );
    expect(problems).toContain('widgets: tenant table has no "orgId" field');
    expect(problems).toContain(
      'widgets: "orgId" is not the first declared field (found "organizationId")',
    );
  });

  it("catches an empty tenant table", () => {
    const problems = tenantTableViolations(
      withFacts({ fieldNames: [], fieldPaths: [], indexes: [] }),
    );
    expect(problems).toContain(
      'widgets: "orgId" is not the first declared field (found "<none>")',
    );
  });
});

describe("an index that could range across tenants is caught", () => {
  it("catches an index that does not begin with orgId", () => {
    const problems = tenantTableViolations(
      withFacts({ indexes: [{ name: "by_code", fields: ["code"] }] }),
    );
    expect(problems).toEqual([
      'widgets.by_code: index begins with "code" instead of "orgId"',
    ]);
  });

  it("catches orgId placed second in an otherwise plausible index", () => {
    const problems = tenantTableViolations(
      withFacts({
        indexes: [{ name: "by_status_orgId", fields: ["status", "orgId"] }],
      }),
    );
    expect(problems).toEqual([
      'widgets.by_status_orgId: index begins with "status" instead of "orgId"',
    ]);
  });

  it("catches a tenant table with no index, which can only be scanned", () => {
    const problems = tenantTableViolations(withFacts({ indexes: [] }));
    expect(problems).toEqual([
      "widgets: tenant table declares no index, so it can only be scanned",
    ]);
  });

  it("reports every offending index, not just the first", () => {
    const problems = tenantTableViolations(
      withFacts({
        indexes: [
          { name: "by_code", fields: ["code"] },
          { name: "by_status", fields: ["status"] },
        ],
      }),
    );
    expect(problems).toHaveLength(2);
  });
});

describe("a global table masquerading as tenant-scoped is caught", () => {
  it("catches a global table that carries orgId", () => {
    const problems = globalTableViolations({
      ...soundTenantTable,
      name: "permissions",
      classification: "global",
    });
    expect(problems).toEqual([
      'permissions: global table carries "orgId"; either scope it properly or ' +
        "remove it from GLOBAL_TABLES",
    ]);
  });

  it("accepts a global table with no discriminator", () => {
    expect(
      globalTableViolations({
        name: "permissions",
        classification: "global",
        fieldNames: ["code", "scope"],
        optionalFieldNames: [],
        fieldPaths: ["code", "scope"],
        indexes: [{ name: "by_code", fields: ["code"] }],
      }),
    ).toEqual([]);
  });

  it("keeps the root allowlist at exactly three tables", () => {
    expect([...GLOBAL_TABLES]).toEqual([
      "organizations",
      "users",
      "permissions",
    ]);
    expect(classifyTable("organizations")).toBe("global");
    expect(classifyTable("users")).toBe("global");
    expect(classifyTable("permissions")).toBe("global");
    expect(classifyTable("apiKeys")).toBe("unclassified");
  });
});

describe("an unclassified or missing table is caught", () => {
  it("catches a table the policy has never heard of", () => {
    const rogue = describeSchema(
      defineSchema({
        phantomWidgets: defineTable({
          orgId: v.id("organizations"),
          code: v.string(),
        }).index("by_orgId_code", ["orgId", "code"]),
      }),
    );
    expect(unclassifiedTables(rogue)).toEqual(["phantomWidgets"]);
    expect(schemaPolicyViolations(rogue)).toContain(
      "phantomWidgets: table is neither in GLOBAL_TABLES nor TENANT_TABLES; classify it " +
        "before it holds data",
    );
  });

  it("catches a policy table that the schema does not define", () => {
    expect(missingTables([])).toContain("organizations");
    expect(missingTables([])).toContain("supportGrants");
    expect(missingTables([])).toContain("sessionsAudit");
  });

  it("classifies a name in neither list as unclassified rather than tenant", () => {
    expect(classifyTable("inventorySnapshots")).toBe("unclassified");
  });
});

describe("credential-material field names are caught", () => {
  function pathsFor(fieldPaths: readonly string[]): readonly string[] {
    return forbiddenFieldPaths(
      withFacts({ fieldNames: [...fieldPaths], fieldPaths: [...fieldPaths] }),
    );
  }

  it("catches an apiKey, which neither word forbids on its own", () => {
    expect(pathsFor(["orgId", "apiKey"])).toEqual([
      'widgets.apiKey (phrase "apikey")',
    ]);
  });

  it("catches a password, a token, and an MFA secret", () => {
    expect(pathsFor(["passwordHash"])).toContain(
      'widgets.passwordHash (word "password")',
    );
    expect(pathsFor(["refreshToken"])).toEqual(
      expect.arrayContaining([
        'widgets.refreshToken (word "token")',
        'widgets.refreshToken (phrase "refreshtoken")',
      ]),
    );
    expect(pathsFor(["mfaSecret"])).toEqual(
      expect.arrayContaining([
        'widgets.mfaSecret (word "mfa")',
        'widgets.mfaSecret (word "secret")',
      ]),
    );
  });

  it("catches credential material nested inside an object or an array", () => {
    expect(pathsFor(["settings", "settings.signingKey"])).toEqual([
      'widgets.settings.signingKey (phrase "signingkey")',
    ]);
    expect(pathsFor(["grants", "grants[].sessionToken"])).toEqual(
      expect.arrayContaining([
        'widgets.grants[].sessionToken (word "token")',
        'widgets.grants[].sessionToken (phrase "sessiontoken")',
      ]),
    );
  });

  it("leaves legitimate names alone, so the guard stays enabled", () => {
    expect(
      pathsFor([
        "orgId",
        "key",
        "roleKey",
        "ticketRef",
        "installationId",
        "clerkSessionId",
        "shippingAddress",
        "pinnedAt",
      ]),
    ).toEqual([]);
  });

  it("splits field paths into words rather than matching substrings", () => {
    expect(fieldWords("tenantApprovalByUserId")).toEqual([
      "tenant",
      "approval",
      "by",
      "user",
      "id",
    ]);
    expect(fieldWords("settings.locale")).toEqual(["settings", "locale"]);
    expect(fieldWords("changes[].field")).toEqual(["changes", "field"]);
    expect(fieldWords("grants[*].value")).toEqual(["grants", "value"]);
  });

  it("keeps the forbidden vocabulary non-empty and lowercase", () => {
    expect(FORBIDDEN_FIELD_WORDS.length).toBeGreaterThan(0);
    expect(FORBIDDEN_FIELD_PHRASES.length).toBeGreaterThan(0);
    for (const entry of [
      ...FORBIDDEN_FIELD_WORDS,
      ...FORBIDDEN_FIELD_PHRASES,
    ]) {
      expect(entry).toBe(entry.toLowerCase());
    }
  });
});

describe("a broken bounded-lookup contract is caught", () => {
  const contract = UNIQUENESS_CONTRACTS.find(
    (candidate) => candidate.table === "warehouses",
  );

  it("names a real contract to break", () => {
    expect(contract).toBeDefined();
    expect(contract?.key).toEqual(["orgId", "code"]);
    expect(contract?.index).toBe("by_orgId_code");
  });

  it("catches an absent table", () => {
    expect(uniquenessContractViolations([])).toContain(
      "warehouses: table named by a uniqueness contract is absent",
    );
  });

  it("catches a key field that no longer exists", () => {
    const problems = uniquenessContractViolations([
      withFacts({
        name: "warehouses",
        fieldNames: ["orgId", "name"],
        fieldPaths: ["orgId", "name"],
      }),
    ]);
    expect(problems).toContain('warehouses: key field "code" is absent');
  });

  it("catches a missing index, which would make the check unbounded", () => {
    const problems = uniquenessContractViolations([
      withFacts({
        name: "warehouses",
        indexes: [
          { name: "by_orgId_status_code", fields: ["orgId", "status", "code"] },
        ],
      }),
    ]);
    expect(problems).toContain(
      'warehouses: index "by_orgId_code" is absent, so the uniqueness check on ' +
        "[orgId, code] would be unbounded",
    );
  });

  it("catches a prefix index, which reads an unbounded set of neighbours", () => {
    const problems = uniquenessContractViolations([
      withFacts({
        name: "warehouses",
        indexes: [{ name: "by_orgId_code", fields: ["orgId"] }],
      }),
    ]);
    expect(problems).toContain(
      "warehouses.by_orgId_code: indexes [orgId] but the contract key is [orgId, code]",
    );
  });

  it("catches an index whose fields are the key in the wrong order", () => {
    const problems = uniquenessContractViolations([
      withFacts({
        name: "warehouses",
        indexes: [{ name: "by_orgId_code", fields: ["code", "orgId"] }],
      }),
    ]);
    expect(problems).toContain(
      "warehouses.by_orgId_code: indexes [code, orgId] but the contract key is " +
        "[orgId, code]",
    );
  });

  it("catches an over-wide index that would not resolve the key exactly", () => {
    const problems = uniquenessContractViolations([
      withFacts({
        name: "warehouses",
        indexes: [
          { name: "by_orgId_code", fields: ["orgId", "code", "status"] },
        ],
      }),
    ]);
    expect(problems).toContain(
      "warehouses.by_orgId_code: indexes [orgId, code, status] but the contract key " +
        "is [orgId, code]",
    );
  });
});

describe("a uniqueness condition that disagrees with the schema is caught", () => {
  const devices = UNIQUENESS_CONTRACTS.find(
    (candidate) => candidate.table === "devices",
  );

  it("names the conditional contract it is about to break", () => {
    expect(devices?.key).toEqual(["orgId", "installationId"]);
    expect(devices?.condition).toEqual({
      kind: "whenPresent",
      fields: ["installationId"],
    });
  });

  it("catches an unconditional contract over an optional key field", () => {
    // `warehouses.code` is unconditionally unique. If the schema ever made it
    // optional, a mutation honouring the contract literally would treat two
    // code-less warehouses as duplicates of each other.
    const problems = uniquenessContractViolations([
      withFacts({ name: "warehouses", optionalFieldNames: ["code"] }),
    ]);
    expect(problems).toContain(
      'warehouses.by_orgId_code: key field "code" is optional but the contract ' +
        "[orgId, code] is unconditional; two absent values are not a collision, so " +
        'declare it with whenPresent("code")',
    );
  });

  it("catches a 'when present' qualifier on a field the schema requires", () => {
    const problems = uniquenessContractViolations([
      withFacts({
        name: "devices",
        fieldNames: ["orgId", "installationId"],
        fieldPaths: ["orgId", "installationId"],
        optionalFieldNames: [],
        indexes: [
          {
            name: "by_orgId_installationId",
            fields: ["orgId", "installationId"],
          },
        ],
      }),
    ]);
    expect(problems).toContain(
      "devices.by_orgId_installationId: contract [orgId, installationId] is marked " +
        '"when present" for "installationId", but the schema declares it required, so ' +
        "the condition can never apply",
    );
  });

  it("accepts the conditional contract when the field is optional", () => {
    /*
     * The synthetic table carries *both* of the device contracts — the
     * unconditional `label` one and the conditional `installationId` one —
     * because the assertion below is "no device problem at all". A fixture
     * describing only half the table would fail on the missing half and say
     * nothing about the qualifier this test exists for.
     */
    const problems = uniquenessContractViolations([
      withFacts({
        name: "devices",
        fieldNames: ["orgId", "label", "installationId"],
        fieldPaths: ["orgId", "label", "installationId"],
        optionalFieldNames: ["installationId"],
        indexes: [
          { name: "by_orgId_label", fields: ["orgId", "label"] },
          {
            name: "by_orgId_installationId",
            fields: ["orgId", "installationId"],
          },
        ],
      }),
    ]);
    expect(problems.filter((problem) => problem.startsWith("devices"))).toEqual(
      [],
    );
  });
});

describe("a broken many-per-key lookup contract is caught", () => {
  const manyPerTicket: readonly LookupContract[] = [
    {
      table: "supportGrants",
      key: ["orgId", "ticketRef"],
      index: "by_orgId_ticketRef",
      cardinality: "many",
      rationale: "Synthetic copy of the real contract, for guard proof.",
    },
  ];

  it("catches an absent table", () => {
    expect(lookupContractViolations([], manyPerTicket)).toContain(
      "supportGrants: table named by a bounded-lookup contract is absent",
    );
  });

  it("catches a missing index, which would turn ticket history into a scan", () => {
    const problems = lookupContractViolations(
      [
        withFacts({
          name: "supportGrants",
          fieldNames: ["orgId", "ticketRef"],
          fieldPaths: ["orgId", "ticketRef"],
          indexes: [{ name: "by_orgId_expiresAt", fields: ["orgId"] }],
        }),
      ],
      manyPerTicket,
    );
    expect(problems).toContain(
      'supportGrants: index "by_orgId_ticketRef" is absent, so reading ' +
        "[orgId, ticketRef] would scan the table",
    );
  });

  it("catches an index that does not begin with the key", () => {
    const problems = lookupContractViolations(
      [
        withFacts({
          name: "supportGrants",
          fieldNames: ["orgId", "ticketRef"],
          fieldPaths: ["orgId", "ticketRef"],
          indexes: [
            { name: "by_orgId_ticketRef", fields: ["orgId", "status"] },
          ],
        }),
      ],
      manyPerTicket,
    );
    expect(problems).toContain(
      "supportGrants.by_orgId_ticketRef: indexes [orgId, status] but the " +
        "bounded-lookup key is [orgId, ticketRef]",
    );
  });

  it("accepts a wider index, because a many-per-key read is a range", () => {
    const problems = lookupContractViolations(
      [
        withFacts({
          name: "supportGrants",
          fieldNames: ["orgId", "ticketRef", "requestedAt"],
          fieldPaths: ["orgId", "ticketRef", "requestedAt"],
          indexes: [
            {
              name: "by_orgId_ticketRef",
              fields: ["orgId", "ticketRef", "requestedAt"],
            },
          ],
        }),
      ],
      manyPerTicket,
    );
    expect(problems).toEqual([]);
  });

  it("catches a key declared both unique and many-per-key", () => {
    expect(
      cardinalityContradictions(
        [
          {
            table: "supportGrants",
            key: ["orgId", "ticketRef"],
            index: "by_orgId_ticketRef",
            condition: ALWAYS,
            rationale: "Synthetic contradiction, for guard proof.",
          },
        ],
        manyPerTicket,
      ),
    ).toEqual([
      "supportGrants: [orgId, ticketRef] is declared both unique and cardinality " +
        '"many"; the two contracts contradict each other',
    ]);
  });

  it("finds no contradiction between the real declarations", () => {
    expect(cardinalityContradictions()).toEqual([]);
  });
});

describe("the composed check reports every rule at once", () => {
  it("collects tenant, global, credential, and contract failures together", () => {
    const problems = schemaPolicyViolations([
      withFacts({
        name: "warehouses",
        fieldNames: ["code", "orgId", "apiKey"],
        fieldPaths: ["code", "orgId", "apiKey"],
        indexes: [{ name: "by_code", fields: ["code"] }],
      }),
      {
        name: "users",
        classification: "global",
        fieldNames: ["orgId", "clerkUserId"],
        optionalFieldNames: [],
        fieldPaths: ["orgId", "clerkUserId"],
        indexes: [{ name: "by_clerkUserId", fields: ["clerkUserId"] }],
      },
    ]);

    expect(problems).toEqual(
      expect.arrayContaining([
        'warehouses: "orgId" is not the first declared field (found "code")',
        'warehouses.by_code: index begins with "code" instead of "orgId"',
        'warehouses.apiKey (phrase "apikey"): field name suggests credential material (INV-0001-06)',
        'users: global table carries "orgId"; either scope it properly or remove it ' +
          "from GLOBAL_TABLES",
      ]),
    );
    // Tables the policy expects but this synthetic set omits are reported too.
    expect(problems).toContain(
      "supportGrants: table expected by the policy is not defined in the schema",
    );
  });
});

describe("schema introspection refuses shapes it cannot model", () => {
  it("rejects a table whose document validator is not an object", () => {
    const union = defineTable(
      v.union(v.object({ a: v.string() }), v.object({ b: v.string() })),
    );
    expect(() => describeTable("weird", union)).toThrow(
      /does not have an object document validator/,
    );
  });

  it("records optionality and nested paths from a real table definition", () => {
    const table = defineTable({
      orgId: v.id("organizations"),
      settings: v.object({ locale: v.string() }),
      rows: v.array(v.object({ field: v.string() })),
      note: v.optional(v.string()),
    }).index("by_orgId", ["orgId"]);

    const described = describeTable("widgets", table);
    expect(described.fieldNames).toEqual(["orgId", "settings", "rows", "note"]);
    expect(described.optionalFieldNames).toEqual(["note"]);
    expect(described.fieldPaths).toContain("settings.locale");
    expect(described.fieldPaths).toContain("rows[].field");
    expect(described.indexes).toEqual([
      { name: "by_orgId", fields: ["orgId"] },
    ]);
  });
});

describe("a value set that drifted open is caught", () => {
  it("rejects a plain string where a closed union is required", () => {
    expect(() => closedValueSet(v.string())).toThrow(
      /not a closed union of literals/,
    );
  });

  it("rejects a union of non-string literals", () => {
    expect(() => closedValueSet(v.union(v.literal(1), v.literal(2)))).toThrow(
      /not a string literal/,
    );
  });

  it("rejects a union that admits an open string member", () => {
    expect(() =>
      closedValueSet(v.union(v.literal("ACTIVE"), v.string())),
    ).toThrow(/not a string literal/);
  });

  it("returns the members of a genuinely closed union", () => {
    expect(closedValueSet(v.union(v.literal("A"), v.literal("B")))).toEqual([
      "A",
      "B",
    ]);
  });
});
