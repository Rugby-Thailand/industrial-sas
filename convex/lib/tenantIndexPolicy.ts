/**
 * The declared `orgId`-first indexes, as data an indexed read can be checked
 * against (T05b1c, `ADR-0002` §3, `INV-0002-02`, `INV-0002-04`).
 *
 * Status: **metadata only.** This module reads the finished schema through
 * `describeSchema` and answers one question: *is `(table, index)` a declared
 * index on a tenant-scoped table whose first field is `orgId`, and what are its
 * fields?* It never touches a database, never builds a query, and never decides
 * what a caller may read — `convex/lib/tenantDb.ts` owns that, and asks here.
 *
 * Derived rather than restated. A hand-written list of index names would be a
 * second place to forget one, and the index that gets forgotten is the one a
 * read then performs without a tenant prefix — or, worse, the one a read
 * performs against a name that no longer exists, which Convex answers by
 * scanning nothing and the caller reads as "no rows". Deriving from
 * `convex/schema.ts` makes drift a failure here instead of an empty page there.
 *
 * The module **fails closed** in both directions:
 *
 * - a table that `schemaPolicy` does not classify as `tenant` contributes
 *   nothing, so a global table (`organizations`, `users`, `permissions`) and a
 *   table nobody classified are equally unreachable through an indexed tenant
 *   read;
 * - an index whose first field is not `orgId`, or that repeats a field, is
 *   *omitted from the metadata rather than recorded as unsafe*. There is no
 *   "known but rejected" state a caller could talk its way into, and
 *   `tenantIndexMetadataDrift` reports every omission so the omission cannot be
 *   silent.
 *
 * Consequence worth stating: the accessor can only ask for what the schema
 * declares. "Give me an index that starts with something else" is not a request
 * this boundary can express, in the same way `byOrg` makes such an index
 * undeclarable in the first place (`convex/lib/tenantTable.ts`). The helper
 * shapes the schema; the policy proves the shape; this module turns the proved
 * shape into the runtime allowlist an indexed read is validated against.
 *
 * Baseline:
 * [ADR-0002](../../docs/adr/0002-convex-tenant-boundary-and-index-discipline.md),
 * [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §6.1.
 */
import schema from "../schema";
import {
  TENANT_TABLES,
  describeSchema,
  type TableFacts,
  type TenantTableName,
} from "./schemaPolicy";
import { TENANT_DISCRIMINATOR } from "./tenantTable";

/* -------------------------------------------------------------------------- */
/* Facts                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One declared, accepted index on a tenant table.
 *
 * `fields` is the whole index including the discriminator, exactly as declared;
 * `fieldsAfterOrg` is the same list with the discriminator dropped, which is the
 * form an equality prefix is checked against. Both are carried because both are
 * used, and computing one from the other at every call site is how a slice ends
 * up disagreeing about whether `orgId` is included.
 */
export interface TenantIndexFacts {
  readonly table: TenantTableName;
  readonly name: string;
  /** Declared index fields, `orgId` first. */
  readonly fields: readonly string[];
  /** Declared index fields after `orgId`, in order. */
  readonly fieldsAfterOrg: readonly string[];
}

/** Accepted indexes, keyed by table name and then by index name. */
export type TenantIndexMetadata = ReadonlyMap<
  string,
  ReadonlyMap<string, TenantIndexFacts>
>;

/* -------------------------------------------------------------------------- */
/* Derivation                                                                  */
/* -------------------------------------------------------------------------- */

/** An index is acceptable when it is `orgId`-first and repeats no field. */
function acceptable(fields: readonly string[]): boolean {
  if (fields[0] !== TENANT_DISCRIMINATOR) return false;
  if (fields.some((field) => field.length === 0)) return false;
  return new Set(fields).size === fields.length;
}

/**
 * Build the accepted-index metadata from described tables.
 *
 * Takes `TableFacts` rather than a schema so the derivation can be exercised on
 * synthetic tables — an index that starts with the wrong field, a tenant table
 * with no index at all, a duplicated field — without breaking the real schema to
 * do it. `tests/isolation/schema-policy-guards.isolation.test.ts` uses the same
 * arrangement for the same reason.
 *
 * Every returned map is frozen and every field list is frozen: the metadata is
 * an allowlist, and an allowlist that any importing module can widen is not one.
 */
export function deriveTenantIndexMetadata(
  allFacts: readonly TableFacts[],
): TenantIndexMetadata {
  const byTable = new Map<string, ReadonlyMap<string, TenantIndexFacts>>();

  for (const facts of allFacts) {
    if (facts.classification !== "tenant") continue;

    const indexes = new Map<string, TenantIndexFacts>();
    for (const index of facts.indexes) {
      if (!acceptable(index.fields)) continue;
      indexes.set(
        index.name,
        Object.freeze({
          // Narrow boundary cast: `classification === "tenant"` is exactly the
          // statement that this name is in `TENANT_TABLES`, which `classifyTable`
          // decides and the type system cannot carry through a `string` name.
          table: facts.name as TenantTableName,
          name: index.name,
          fields: Object.freeze([...index.fields]),
          fieldsAfterOrg: Object.freeze(index.fields.slice(1)),
        }),
      );
    }

    byTable.set(facts.name, freezeMap(indexes));
  }

  return freezeMap(byTable);
}

/**
 * Freeze a `Map` against mutation.
 *
 * `Object.freeze` is not enough on its own: `set`, `delete`, and `clear` write
 * internal slots rather than properties, so a frozen `Map` is still a writable
 * `Map`. Shadowing the three mutators is what makes this metadata immutable at
 * runtime. Same technique, same reason, as `immutableSet` in
 * `convex/lib/tenantDb.ts`.
 *
 * A plain `Error`, not a `TenantDbError`: mutating derived metadata is a
 * programming mistake with no request behind it and nothing for a client to see.
 */
function freezeMap<Key, Value>(map: Map<Key, Value>): ReadonlyMap<Key, Value> {
  for (const method of ["set", "delete", "clear"] as const) {
    Object.defineProperty(map, method, {
      value: (): never => {
        throw new Error(
          `Tenant index metadata is immutable; "${method}" is not available. ` +
            "Declare the index in convex/schema.ts with byOrg() instead.",
        );
      },
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }

  return Object.freeze(map);
}

/**
 * The accepted indexes of the real schema.
 *
 * Computed once at module load from `convex/schema.ts`. Nothing else in the
 * repository is allowed to assemble this: an indexed read validated against a
 * locally built map is validated against that map's author's memory of the
 * schema.
 */
export const TENANT_INDEX_METADATA: TenantIndexMetadata =
  deriveTenantIndexMetadata(describeSchema(schema));

/* -------------------------------------------------------------------------- */
/* Lookup                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The facts for `(table, index)`, or `undefined` when the pair is not a declared
 * `orgId`-first index on a tenant-scoped table.
 *
 * Both arguments are `string`, because both can arrive from a value the compiler
 * never saw — an argument validator, a JSON body, a cast — and a lookup that
 * only accepts already-narrowed names would be checking a claim rather than a
 * value.
 *
 * `undefined` for every reason: unknown table, global table, unknown index,
 * rejected index. One answer, so the caller has one branch and cannot
 * accidentally make the four distinguishable.
 */
export function describeTenantIndex(
  table: string,
  index: string,
  metadata: TenantIndexMetadata = TENANT_INDEX_METADATA,
): TenantIndexFacts | undefined {
  return metadata.get(table)?.get(index);
}

/* -------------------------------------------------------------------------- */
/* Drift                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Everything wrong with the indexes this metadata was derived from.
 *
 * Three kinds of drift, each of which would otherwise show up as a read that
 * quietly returns nothing rather than as a failure:
 *
 * 1. a table `TENANT_TABLES` names that the schema does not define, or defines
 *    without a classification this module accepts;
 * 2. a declared index that was *rejected* — not `orgId`-first, or repeating a
 *    field — which the metadata omits and which nothing would otherwise report;
 * 3. a tenant table left with no acceptable index, which is a table that can
 *    only be read by scanning it (`INV-0002-04`).
 *
 * Reported as strings rather than thrown, matching `schemaPolicyViolations`, so a
 * test can name every problem in one run instead of the first one.
 */
export function tenantIndexMetadataDrift(
  allFacts: readonly TableFacts[],
  metadata: TenantIndexMetadata = deriveTenantIndexMetadata(allFacts),
): readonly string[] {
  const problems: string[] = [];
  const described = new Map(allFacts.map((facts) => [facts.name, facts]));

  for (const name of TENANT_TABLES) {
    if (!described.has(name)) {
      problems.push(
        `${name}: tenant table named by TENANT_TABLES is absent from the schema, ` +
          "so no indexed read of it can be validated",
      );
      continue;
    }
    if (!metadata.has(name)) {
      problems.push(
        `${name}: tenant table contributes no index metadata; it is not ` +
          'classified "tenant" by schemaPolicy',
      );
    }
  }

  for (const facts of allFacts) {
    if (facts.classification !== "tenant") continue;

    const accepted = metadata.get(facts.name);
    for (const index of facts.indexes) {
      if (accepted?.has(index.name) === true) continue;
      problems.push(
        `${facts.name}.${index.name}: index [${index.fields.join(", ")}] is not a ` +
          `usable tenant index; it must begin with "${TENANT_DISCRIMINATOR}" and ` +
          "name each field once",
      );
    }

    if (accepted === undefined || accepted.size === 0) {
      problems.push(
        `${facts.name}: tenant table has no usable ${TENANT_DISCRIMINATOR}-first ` +
          "index, so it could only be read by scanning it",
      );
    }
  }

  return problems;
}
