import type {
  GenericSchema,
  SchemaDefinition,
  TableDefinition,
} from "convex/server";
import type { GenericValidator } from "convex/values";

import { TENANT_DISCRIMINATOR } from "./tenantTable";

export const GLOBAL_TABLES = ["organizations", "users", "permissions"] as const;

export const TENANT_TABLES = [
  "warehouses",
  "memberships",
  "membershipRoles",
  "membershipWarehouses",
  "roles",
  "rolePermissions",
  "entitlements",
  "auditEvents",
  "idempotencyRecords",
  "devices",
  "sessionsAudit",
  "supportGrants",
  "locations",
  "storageBuildings",
  "storageFloors",
  "storageFloorReservedBlocks",
  "storageZones",
  "storagePositions",
  "finishedGoodsProducts",
  "finishedGoodsProductSummaries",
  "finishedGoodsUnitContributions",
  "finishedGoodsSummaryReadiness",
  "finishedGoodsBatches",
  "finishedGoodsBatchRevisions",
  "finishedGoodsPallets",
  "finishedGoodsPlacements",
  "finishedGoodsCounters",
  "finishedGoodsMoves",
] as const;

export type GlobalTableName = (typeof GLOBAL_TABLES)[number];
export type TenantTableName = (typeof TENANT_TABLES)[number];

export type TableClassification = "global" | "tenant" | "unclassified";

export function classifyTable(name: string): TableClassification {
  if ((GLOBAL_TABLES as readonly string[]).includes(name)) return "global";
  if ((TENANT_TABLES as readonly string[]).includes(name)) return "tenant";
  return "unclassified";
}

export const FORBIDDEN_FIELD_WORDS = [
  "password",
  "passwd",
  "passcode",
  "secret",
  "secrets",
  "token",
  "tokens",
  "credential",
  "credentials",
  "mfa",
  "totp",
  "otp",
  "pin",
  "cookie",
  "bearer",
  "jwt",
  "authorization",
] as const;

export const FORBIDDEN_FIELD_PHRASES = [
  "apikey",
  "accesskey",
  "secretkey",
  "signingkey",
  "privatekey",
  "sessiontoken",
  "refreshtoken",
  "accesstoken",
  "recoverycode",
  "backupcode",
] as const;

export function fieldWords(fieldPath: string): readonly string[] {
  return fieldPath
    .replaceAll("[]", "")
    .replaceAll("[*]", "")
    .split(/[._]/)
    .flatMap((part) => part.split(/(?=[A-Z])/))
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 0);
}

export type UniquenessCondition =
  | { readonly kind: "always" }
  | { readonly kind: "whenPresent"; readonly fields: readonly string[] };

export const ALWAYS: UniquenessCondition = Object.freeze({
  kind: "always",
} as const);

export function whenPresent(...fields: readonly string[]): UniquenessCondition {
  return { kind: "whenPresent", fields };
}

export type UniquenessContract = {
  readonly table: string;
  readonly key: readonly string[];
  readonly condition: UniquenessCondition;
};

export function uniquenessIndexName(key: readonly string[]): string {
  return `by_${key.join("_")}`;
}

export const UNIQUENESS_CONTRACTS: readonly UniquenessContract[] = [
  {
    table: "finishedGoodsPallets",
    key: ["orgId", "warehouseId", "code"],
    condition: ALWAYS,
  },
  {
    table: "finishedGoodsPlacements",
    key: ["orgId", "warehouseId", "positionCode"],
    condition: ALWAYS,
  },
  {
    table: "finishedGoodsCounters",
    key: ["orgId", "warehouseId"],
    condition: ALWAYS,
  },
  { table: "organizations", key: ["clerkOrganizationId"], condition: ALWAYS },
  { table: "users", key: ["clerkUserId"], condition: ALWAYS },
  { table: "permissions", key: ["code"], condition: ALWAYS },
  { table: "warehouses", key: ["orgId", "code"], condition: ALWAYS },
  { table: "memberships", key: ["orgId", "userId"], condition: ALWAYS },
  {
    table: "memberships",
    key: ["orgId", "clerkMembershipId"],
    condition: ALWAYS,
  },
  {
    table: "membershipRoles",
    key: ["orgId", "membershipId", "roleId"],
    condition: ALWAYS,
  },
  {
    table: "membershipWarehouses",
    key: ["orgId", "membershipId", "warehouseId"],
    condition: ALWAYS,
  },
  { table: "roles", key: ["orgId", "key"], condition: ALWAYS },
  {
    table: "rolePermissions",
    key: ["orgId", "roleId", "permissionCode"],
    condition: ALWAYS,
  },
  { table: "entitlements", key: ["orgId", "key"], condition: ALWAYS },
  {
    table: "idempotencyRecords",
    key: ["orgId", "operation", "requestId"],
    condition: ALWAYS,
  },
  {
    table: "devices",
    key: ["orgId", "installationId"],
    condition: whenPresent("installationId"),
  },
  { table: "devices", key: ["orgId", "label"], condition: ALWAYS },
  {
    table: "locations",
    key: ["orgId", "warehouseId", "code"],
    condition: ALWAYS,
  },
  {
    table: "storagePositions",
    key: ["orgId", "locationId"],
    condition: ALWAYS,
  },
  {
    table: "storagePositions",
    key: ["orgId", "qrValue"],
    condition: ALWAYS,
  },
  {
    table: "storagePositions",
    key: ["orgId", "warehouseId", "code"],
    condition: ALWAYS,
  },
] as const;

/* Bounded lookup contracts (indexed, deliberately not unique)                 */

export type LookupContract = {
  readonly table: string;
  readonly key: readonly string[];
};

export const BOUNDED_LOOKUP_CONTRACTS: readonly LookupContract[] = [
  { table: "supportGrants", key: ["orgId", "ticketRef"] },
  { table: "storagePositions", key: ["orgId", "zoneId", "status"] },
] as const;

export type ThirdNormalFormContract = {
  readonly table: string;
  readonly determinant: readonly string[];
  readonly dependentFields: readonly string[];
};

export const THIRD_NORMAL_FORM_CONTRACTS: readonly ThirdNormalFormContract[] =
  [] as const;

export type IndexFacts = {
  readonly name: string;
  readonly fields: readonly string[];
};

export type TableFacts = {
  readonly name: string;
  readonly classification: TableClassification;

  readonly fieldNames: readonly string[];

  readonly optionalFieldNames: readonly string[];

  readonly fieldPaths: readonly string[];
  readonly indexes: readonly IndexFacts[];
};

function descend(
  validator: GenericValidator,
  path: string,
  out: string[],
): void {
  switch (validator.kind) {
    case "object":
      for (const [name, child] of Object.entries(validator.fields)) {
        const childPath = `${path}.${name}`;
        out.push(childPath);
        descend(child, childPath, out);
      }
      return;
    case "array":
      descend(validator.element, `${path}[]`, out);
      return;
    case "record":
      descend(validator.value, `${path}[*]`, out);
      return;
    case "union":
      for (const member of validator.members) descend(member, path, out);
      return;
    default:
      return;
  }
}

export function describeTable(
  name: string,
  definition: TableDefinition,
): TableFacts {
  const documentValidator = definition.validator;
  if (documentValidator.kind !== "object") {
    throw new Error(
      `Table "${name}" does not have an object document validator. ` +
        "Discriminated-union tables are not part of this schema and the policy " +
        "checks do not model them.",
    );
  }

  const fieldNames = Object.keys(documentValidator.fields);
  const optionalFieldNames: string[] = [];
  const fieldPaths: string[] = [];
  for (const [fieldName, fieldValidator] of Object.entries(
    documentValidator.fields,
  )) {
    if (fieldValidator.isOptional === "optional")
      optionalFieldNames.push(fieldName);
    fieldPaths.push(fieldName);
    descend(fieldValidator, fieldName, fieldPaths);
  }

  return {
    name,
    classification: classifyTable(name),
    fieldNames,
    optionalFieldNames,
    fieldPaths,
    indexes: definition[" indexes"]().map((index) => ({
      name: index.indexDescriptor,
      fields: index.fields,
    })),
  };
}

export function describeSchema(
  schema: SchemaDefinition<GenericSchema, boolean>,
): readonly TableFacts[] {
  return Object.entries(schema.tables).map(([name, definition]) =>
    describeTable(name, definition),
  );
}

export function tenantTableViolations(facts: TableFacts): readonly string[] {
  const problems: string[] = [];

  if (!facts.fieldNames.includes(TENANT_DISCRIMINATOR)) {
    problems.push(
      `${facts.name}: tenant table has no "${TENANT_DISCRIMINATOR}" field`,
    );
  }
  if (facts.fieldNames[0] !== TENANT_DISCRIMINATOR) {
    problems.push(
      `${facts.name}: "${TENANT_DISCRIMINATOR}" is not the first declared field ` +
        `(found "${facts.fieldNames[0] ?? "<none>"}")`,
    );
  }
  if (facts.optionalFieldNames.includes(TENANT_DISCRIMINATOR)) {
    problems.push(
      `${facts.name}: "${TENANT_DISCRIMINATOR}" is optional; a document with no ` +
        "tenant belongs to every tenant",
    );
  }
  if (facts.indexes.length === 0) {
    problems.push(
      `${facts.name}: tenant table declares no index, so it can only be scanned`,
    );
  }
  for (const index of facts.indexes) {
    if (index.fields[0] !== TENANT_DISCRIMINATOR) {
      problems.push(
        `${facts.name}.${index.name}: index begins with "${index.fields[0] ?? "<none>"}" ` +
          `instead of "${TENANT_DISCRIMINATOR}"`,
      );
    }
  }

  return problems;
}

export function globalTableViolations(facts: TableFacts): readonly string[] {
  return facts.fieldNames.includes(TENANT_DISCRIMINATOR)
    ? [
        `${facts.name}: global table carries "${TENANT_DISCRIMINATOR}"; ` +
          "either scope it properly or remove it from GLOBAL_TABLES",
      ]
    : [];
}

export function forbiddenFieldPaths(facts: TableFacts): readonly string[] {
  const forbidden: string[] = [];

  for (const path of facts.fieldPaths) {
    const words = fieldWords(path);
    for (const word of words) {
      if ((FORBIDDEN_FIELD_WORDS as readonly string[]).includes(word)) {
        forbidden.push(`${facts.name}.${path} (word "${word}")`);
      }
    }
    for (let index = 0; index + 1 < words.length; index += 1) {
      const phrase = `${words[index]}${words[index + 1]}`;
      if ((FORBIDDEN_FIELD_PHRASES as readonly string[]).includes(phrase)) {
        forbidden.push(`${facts.name}.${path} (phrase "${phrase}")`);
      }
    }
  }

  return forbidden;
}

export function uniquenessContractViolations(
  allFacts: readonly TableFacts[],
): readonly string[] {
  const byName = new Map(allFacts.map((facts) => [facts.name, facts]));
  const problems: string[] = [];

  for (const contract of UNIQUENESS_CONTRACTS) {
    const keyLabel = `[${contract.key.join(", ")}]`;
    const indexName = uniquenessIndexName(contract.key);
    const facts = byName.get(contract.table);
    if (facts === undefined) {
      problems.push(
        `${contract.table}: table named by a uniqueness contract is absent`,
      );
      continue;
    }

    for (const field of contract.key) {
      if (!facts.fieldNames.includes(field)) {
        problems.push(`${contract.table}: key field "${field}" is absent`);
      }
    }

    const conditionalFields =
      contract.condition.kind === "whenPresent"
        ? contract.condition.fields
        : [];

    for (const field of conditionalFields) {
      if (!contract.key.includes(field)) {
        problems.push(
          `${contract.table}.${indexName}: contract ${keyLabel} is conditional on ` +
            `"${field}", which is not part of the key`,
        );
        continue;
      }
      if (!facts.optionalFieldNames.includes(field)) {
        problems.push(
          `${contract.table}.${indexName}: contract ${keyLabel} is marked "when present" ` +
            `for "${field}", but the schema declares it required, so the condition can never apply`,
        );
      }
    }

    for (const field of contract.key) {
      if (
        facts.optionalFieldNames.includes(field) &&
        !conditionalFields.includes(field)
      ) {
        problems.push(
          `${contract.table}.${indexName}: key field "${field}" is optional but the ` +
            `contract ${keyLabel} is unconditional; two absent values are not a collision, so ` +
            'declare it with whenPresent("' +
            field +
            '")',
        );
      }
    }

    const index = facts.indexes.find(
      (candidate) => candidate.name === indexName,
    );
    if (index === undefined) {
      problems.push(
        `${contract.table}: index "${indexName}" is absent, so the uniqueness ` +
          `check on ${keyLabel} would be unbounded`,
      );
      continue;
    }
    if (index.fields.join(",") !== contract.key.join(",")) {
      problems.push(
        `${contract.table}.${indexName}: indexes [${index.fields.join(", ")}] ` +
          `but the contract key is ${keyLabel}`,
      );
    }
  }

  return problems;
}

export function lookupContractViolations(
  allFacts: readonly TableFacts[],
  contracts: readonly LookupContract[] = BOUNDED_LOOKUP_CONTRACTS,
): readonly string[] {
  const byName = new Map(allFacts.map((facts) => [facts.name, facts]));
  const problems: string[] = [];

  for (const contract of contracts) {
    const keyLabel = `[${contract.key.join(", ")}]`;
    const facts = byName.get(contract.table);
    if (facts === undefined) {
      problems.push(
        `${contract.table}: table named by a bounded-lookup contract is absent`,
      );
      continue;
    }

    for (const field of contract.key) {
      if (!facts.fieldNames.includes(field)) {
        problems.push(
          `${contract.table}: bounded-lookup key field "${field}" is absent`,
        );
      }
    }

    const key = contract.key.join(",");
    const indexed = facts.indexes.some(
      (candidate) =>
        candidate.fields.slice(0, contract.key.length).join(",") === key,
    );
    if (!indexed) {
      problems.push(
        `${contract.table}: no index begins with ${keyLabel}, so reading it ` +
          "would scan the table",
      );
    }
  }

  return problems;
}

export function cardinalityContradictions(
  unique: readonly UniquenessContract[] = UNIQUENESS_CONTRACTS,
  lookups: readonly LookupContract[] = BOUNDED_LOOKUP_CONTRACTS,
): readonly string[] {
  const uniqueKeys = new Set(
    unique.map((contract) => `${contract.table}:${contract.key.join(",")}`),
  );
  return lookups
    .filter((contract) =>
      uniqueKeys.has(`${contract.table}:${contract.key.join(",")}`),
    )
    .map(
      (contract) =>
        `${contract.table}: [${contract.key.join(", ")}] is declared both unique and ` +
        'cardinality "many"; the two contracts contradict each other',
    );
}

export function thirdNormalFormViolations(
  allFacts: readonly TableFacts[],
  contracts: readonly ThirdNormalFormContract[] = THIRD_NORMAL_FORM_CONTRACTS,
): readonly string[] {
  const byName = new Map(allFacts.map((facts) => [facts.name, facts]));
  const problems: string[] = [];

  for (const contract of contracts) {
    const facts = byName.get(contract.table);
    if (facts === undefined) {
      problems.push(
        `${contract.table}: table named by a third-normal-form contract is absent`,
      );
      continue;
    }
    for (const determinant of contract.determinant) {
      if (!facts.fieldNames.includes(determinant)) {
        problems.push(
          `${contract.table}: third-normal-form determinant "${determinant}" is absent`,
        );
      }
    }
    for (const dependent of contract.dependentFields) {
      if (facts.fieldNames.includes(dependent)) {
        problems.push(
          `${contract.table}.${dependent}: copied attribute is transitively determined by ` +
            `[${contract.determinant.join(", ")}]; resolve it from the authoritative relation`,
        );
      }
    }
  }

  return problems;
}

export function unclassifiedTables(
  allFacts: readonly TableFacts[],
): readonly string[] {
  return allFacts
    .filter((facts) => facts.classification === "unclassified")
    .map((facts) => facts.name);
}

export function missingTables(
  allFacts: readonly TableFacts[],
): readonly string[] {
  const present = new Set(allFacts.map((facts) => facts.name));
  return [...GLOBAL_TABLES, ...TENANT_TABLES].filter(
    (name) => !present.has(name),
  );
}

export function schemaPolicyViolations(
  allFacts: readonly TableFacts[],
): readonly string[] {
  return [
    ...missingTables(allFacts).map(
      (name) =>
        `${name}: table expected by the policy is not defined in the schema`,
    ),
    ...unclassifiedTables(allFacts).map(
      (name) =>
        `${name}: table is neither in GLOBAL_TABLES nor TENANT_TABLES; classify it ` +
        "before it holds data",
    ),
    ...allFacts.flatMap((facts) => {
      switch (facts.classification) {
        case "tenant":
          return tenantTableViolations(facts);
        case "global":
          return globalTableViolations(facts);
        case "unclassified":
          return [];
      }
    }),
    ...allFacts.flatMap((facts) =>
      forbiddenFieldPaths(facts).map(
        (path) =>
          `${path}: field name suggests credential material (INV-0001-06)`,
      ),
    ),
    ...uniquenessContractViolations(allFacts),
    ...lookupContractViolations(allFacts),
    ...cardinalityContradictions(),
    ...thirdNormalFormViolations(allFacts),
  ];
}

export function closedValueSet(validator: GenericValidator): readonly string[] {
  if (validator.kind !== "union") {
    throw new Error(
      `Validator is "${validator.kind}", not a closed union of literals`,
    );
  }
  return validator.members.map((member) => {
    if (member.kind !== "literal" || typeof member.value !== "string") {
      throw new Error(`Union member is "${member.kind}", not a string literal`);
    }
    return member.value;
  });
}
