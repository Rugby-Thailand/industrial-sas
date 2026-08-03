/**
 * Schema policy: the machine-readable statement of what the schema is allowed to
 * look like, plus the introspection needed to check it.
 *
 * Status: **schema foundation only.** This module is metadata and pure
 * functions. It reads a `SchemaDefinition`; it never touches a database.
 *
 * Why this exists rather than a prose rule in an ADR: `orgId`-first tenancy
 * (D-18, `INV-0002-02`), a fixed global-table allowlist, bounded external
 * lookups, and the absence of credential fields are all properties of the
 * finished schema. A property that only a reviewer checks decays on the first
 * busy week. Everything below is stated once, as data, and asserted by
 * `tests/isolation/` and `tests/integration/`.
 *
 * The design intent is that this file is the *expectation* and `convex/schema.ts`
 * is the *implementation*, so drift in either direction fails: a new table that
 * nobody classified fails as loudly as a tenant table that lost its `orgId`.
 *
 * `schemaPolicyViolations` is the composed entry point; the individual checks stay
 * exported so a failure names one rule. The checks are proved to *fire*, not only
 * to pass, by `tests/isolation/schema-policy-guards.isolation.test.ts`, which
 * feeds them synthetic `TableFacts` and throwaway schema values. Proving a guard
 * by breaking the real schema would leave the repository one forgotten revert away
 * from shipping the break.
 *
 * Baseline:
 * [ADR-0002](../../docs/adr/0002-convex-tenant-boundary-and-index-discipline.md),
 * [ADR-0001](../../docs/adr/0001-multi-tenant-saas-and-identity-ownership.md),
 * [ADR-0006](../../docs/adr/0006-authorization-and-support-access.md).
 */
import type {
  GenericSchema,
  SchemaDefinition,
  TableDefinition,
} from "convex/server";
import type { GenericValidator } from "convex/values";

import { TENANT_DISCRIMINATOR } from "./tenantTable";

/* -------------------------------------------------------------------------- */
/* Table classification                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The complete allowlist of tables that legitimately have no `orgId`
 * (`ADR-0002` §1).
 *
 * - `organizations` is the tenant root: its document ID *is* the `orgId`.
 * - `users` is a global Clerk identity reference, because one person may hold
 *   memberships in several tenants (C-02). Tenancy lives in `memberships`.
 * - `permissions` is code-owned reference data, identical for every tenant
 *   (`INV-0006-02`).
 *
 * Adding a fourth entry is a security decision, not a schema convenience. It
 * means "this data is readable without a tenant in hand".
 */
export const GLOBAL_TABLES = ["organizations", "users", "permissions"] as const;

/** Tables that must carry `orgId` and index it first. */
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
] as const;

export type GlobalTableName = (typeof GLOBAL_TABLES)[number];
export type TenantTableName = (typeof TENANT_TABLES)[number];

export type TableClassification = "global" | "tenant" | "unclassified";

/** How this policy classifies a table name. */
export function classifyTable(name: string): TableClassification {
  if ((GLOBAL_TABLES as readonly string[]).includes(name)) return "global";
  if ((TENANT_TABLES as readonly string[]).includes(name)) return "tenant";
  return "unclassified";
}

/* -------------------------------------------------------------------------- */
/* Forbidden field vocabulary                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Words that must not appear in any field name, at any depth.
 *
 * Clerk owns credentials, MFA, and sessions (C-03), so a field named after one
 * of these is either a mistake or a boundary violation (`INV-0001-06`). The check
 * is on *words*, not substrings, because substring matching on "pin" or "key"
 * flags innocent names like `shipping` or `roles.key` and a noisy guard gets
 * disabled.
 */
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

/**
 * Two-word combinations that are credential material even though neither word is
 * alone. `roles.key` is legitimate; `apiKey` is not.
 */
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

/**
 * Split a field path into lowercase words: `tenantApprovalByUserId` becomes
 * `["tenant", "approval", "by", "user", "id"]`. Array and record markers are
 * dropped; dots and underscores are separators.
 */
export function fieldWords(fieldPath: string): readonly string[] {
  return fieldPath
    .replaceAll("[]", "")
    .replaceAll("[*]", "")
    .split(/[._]/)
    .flatMap((part) => part.split(/(?=[A-Z])/))
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 0);
}

/* -------------------------------------------------------------------------- */
/* Uniqueness and bounded-lookup contracts                                     */
/* -------------------------------------------------------------------------- */

/**
 * A key that must be unique, and the index that makes checking it bounded.
 *
 * Convex has no unique constraint, so uniqueness is always a code obligation.
 * The obligation is only affordable if the check is a single indexed lookup —
 * which is why the contract names both the key and the index, and why a test
 * asserts the index exists with exactly those fields in that order.
 *
 * Every tenant contract begins with `orgId`, so a uniqueness scope never spans
 * tenants: one tenant's warehouse code can never collide with, or disclose,
 * another's.
 */
export type UniquenessContract = {
  readonly table: string;
  readonly key: readonly string[];
  readonly index: string;
  readonly rationale: string;
};

export const UNIQUENESS_CONTRACTS: readonly UniquenessContract[] = [
  {
    table: "organizations",
    key: ["clerkOrganizationId"],
    index: "by_clerkOrganizationId",
    rationale:
      "One Clerk organization maps to at most one tenant, both directions (INV-0001-05).",
  },
  {
    table: "users",
    key: ["clerkUserId"],
    index: "by_clerkUserId",
    rationale:
      "Actor resolution from a verified Clerk token happens on every request (INV-0001-02).",
  },
  {
    table: "permissions",
    key: ["code"],
    index: "by_code",
    rationale:
      "Permission codes are the stable identifiers functions and audit rows cite (INV-0006-02).",
  },
  {
    table: "warehouses",
    key: ["orgId", "code"],
    index: "by_orgId_code",
    rationale:
      "Tenant-normalized human identifier, unique per organization (§5 Q4).",
  },
  {
    table: "memberships",
    key: ["orgId", "userId"],
    index: "by_orgId_userId",
    rationale:
      "One membership per user per organization; resolved before every operation (INV-0001-03).",
  },
  {
    table: "memberships",
    key: ["orgId", "clerkMembershipId"],
    index: "by_orgId_clerkMembershipId",
    rationale:
      "Idempotent application of Clerk membership webhooks (INV-0001-04).",
  },
  {
    table: "membershipRoles",
    key: ["orgId", "membershipId", "roleId"],
    index: "by_orgId_membershipId_roleId",
    rationale: "A role is held once per membership; the row is the grant.",
  },
  {
    table: "membershipWarehouses",
    key: ["orgId", "membershipId", "warehouseId"],
    index: "by_orgId_membershipId_warehouseId",
    rationale: "Warehouse scope is a set, not a multiset (G-007).",
  },
  {
    table: "roles",
    key: ["orgId", "key"],
    index: "by_orgId_key",
    rationale: "Seeded role keys must be idempotent to reseed (INV-0006-11).",
  },
  {
    table: "rolePermissions",
    key: ["orgId", "roleId", "permissionCode"],
    index: "by_orgId_roleId_permissionCode",
    rationale: "A permission is granted to a role once; composition is a set.",
  },
  {
    table: "entitlements",
    key: ["orgId", "key"],
    index: "by_orgId_key",
    rationale:
      "One entitlement row per key per tenant; absent means disabled (D-30).",
  },
  {
    table: "idempotencyRecords",
    key: ["orgId", "operation", "requestId"],
    index: "by_orgId_operation_requestId",
    rationale:
      "Replay detection on the hot path of every mutation; scoped per tenant (§5 Q30).",
  },
  {
    table: "devices",
    key: ["orgId", "installationId"],
    index: "by_orgId_installationId",
    rationale:
      "A PWA installation correlates to at most one registered device.",
  },
  {
    table: "supportGrants",
    key: ["orgId", "ticketRef"],
    index: "by_orgId_ticketRef",
    rationale:
      "A grant is bound to one support ticket, so the tenant can reconcile it (INV-0006-09).",
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Introspection                                                               */
/* -------------------------------------------------------------------------- */

export type IndexFacts = {
  readonly name: string;
  readonly fields: readonly string[];
};

export type TableFacts = {
  readonly name: string;
  readonly classification: TableClassification;
  /** Top-level document fields, excluding Convex's `_id` and `_creationTime`. */
  readonly fieldNames: readonly string[];
  /** The subset of `fieldNames` declared with `v.optional(...)`. */
  readonly optionalFieldNames: readonly string[];
  /** Every field path, including nested object, array (`[]`), and record (`[*]`) paths. */
  readonly fieldPaths: readonly string[];
  readonly indexes: readonly IndexFacts[];
};

/** Recursively collect nested field paths beneath `path`. */
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

/**
 * Read the shape of one table definition.
 *
 * Uses `TableDefinition[" indexes"]()`, which Convex documents as experimental.
 * It is the only public read seam for declared indexes; the alternative is
 * parsing `schema.ts` as text, which is worse. If Convex renames it, this
 * function fails to compile — a loud, local failure rather than a silent gap in
 * the guard.
 */
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

/** Read the shape of every table in a schema. */
export function describeSchema(
  schema: SchemaDefinition<GenericSchema, boolean>,
): readonly TableFacts[] {
  return Object.entries(schema.tables).map(([name, definition]) =>
    describeTable(name, definition),
  );
}

/* -------------------------------------------------------------------------- */
/* Policy checks                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Violations of `orgId`-first discipline on a tenant table (D-18,
 * `INV-0002-02`).
 *
 * The discriminator must be present, first, and required. "First" is what makes
 * the rule reviewable at a glance in the schema and in generated types; required
 * is what stops a document from belonging to no tenant, and therefore to every
 * query that forgets to filter.
 *
 * Requiring at least one index is part of the rule: a tenant table with no index
 * can only be read by scanning it, and a scan is how cross-tenant reads happen
 * (`INV-0002-04`).
 */
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

/**
 * Violations on a global table. A global table must *not* carry `orgId`: a table
 * with a tenant discriminator that nothing enforces is worse than either
 * alternative, because it reads as tenant-scoped.
 */
export function globalTableViolations(facts: TableFacts): readonly string[] {
  return facts.fieldNames.includes(TENANT_DISCRIMINATOR)
    ? [
        `${facts.name}: global table carries "${TENANT_DISCRIMINATOR}"; ` +
          "either scope it properly or remove it from GLOBAL_TABLES",
      ]
    : [];
}

/** Field paths whose names suggest credential material. */
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

/**
 * Contracts that the schema does not honour: a missing table, a missing key
 * field, a missing index, or an index whose fields are not exactly the key in
 * order.
 *
 * "Exactly, in order" rather than "starts with" because a prefix index makes the
 * uniqueness check a range read over an unbounded set of neighbours, and a
 * uniqueness check that reads more than one candidate is a race waiting for
 * traffic.
 */
export function uniquenessContractViolations(
  allFacts: readonly TableFacts[],
): readonly string[] {
  const byName = new Map(allFacts.map((facts) => [facts.name, facts]));
  const problems: string[] = [];

  for (const contract of UNIQUENESS_CONTRACTS) {
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

    const index = facts.indexes.find(
      (candidate) => candidate.name === contract.index,
    );
    if (index === undefined) {
      problems.push(
        `${contract.table}: index "${contract.index}" is absent, so the uniqueness ` +
          `check on [${contract.key.join(", ")}] would be unbounded`,
      );
      continue;
    }
    if (index.fields.join(",") !== contract.key.join(",")) {
      problems.push(
        `${contract.table}.${contract.index}: indexes [${index.fields.join(", ")}] ` +
          `but the contract key is [${contract.key.join(", ")}]`,
      );
    }
  }

  return problems;
}

/** Tables present in the schema that this policy does not classify. */
export function unclassifiedTables(
  allFacts: readonly TableFacts[],
): readonly string[] {
  return allFacts
    .filter((facts) => facts.classification === "unclassified")
    .map((facts) => facts.name);
}

/** Tables this policy expects that the schema does not define. */
export function missingTables(
  allFacts: readonly TableFacts[],
): readonly string[] {
  const present = new Set(allFacts.map((facts) => facts.name));
  return [...GLOBAL_TABLES, ...TENANT_TABLES].filter(
    (name) => !present.has(name),
  );
}

/**
 * Every violation the policy can see, in one list.
 *
 * The composed function exists so a caller cannot honour four of the five checks
 * and believe the schema was vetted. Adding a check here makes it part of the
 * guard everywhere the guard runs; the individual functions stay exported so a
 * failure can be attributed to one rule rather than to "the schema".
 *
 * An empty list means the schema's *shape* is legal. It does not mean tenant
 * isolation holds at runtime: nothing here reads a document, and the tenant-bound
 * accessor (`G-102`) that would enforce isolation does not exist yet.
 */
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
  ];
}

/**
 * The exact set of string values a closed validator accepts.
 *
 * Throws when the validator is not a union of string literals, which is the
 * point: it turns "is this field closed?" into a question with an answer instead
 * of a reading exercise. A field that drifts to `v.string()` fails here rather
 * than quietly accepting a state no policy handles.
 */
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
