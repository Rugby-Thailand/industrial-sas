import schema from "../schema";
import {
  TENANT_TABLES,
  describeSchema,
  type TableFacts,
  type TenantTableName,
} from "./schemaPolicy";
import { TENANT_DISCRIMINATOR } from "./tenantTable";

export interface TenantIndexFacts {
  readonly table: TenantTableName;
  readonly name: string;

  readonly fields: readonly string[];

  readonly fieldsAfterOrg: readonly string[];
}

export type TenantIndexMetadata = ReadonlyMap<
  string,
  ReadonlyMap<string, TenantIndexFacts>
>;

function acceptable(fields: readonly string[]): boolean {
  if (fields[0] !== TENANT_DISCRIMINATOR) return false;
  if (fields.some((field) => field.length === 0)) return false;
  return new Set(fields).size === fields.length;
}

function isTenantTableName(name: string): name is TenantTableName {
  return (TENANT_TABLES as readonly string[]).includes(name);
}

export function deriveTenantIndexMetadata(
  allFacts: readonly TableFacts[],
): TenantIndexMetadata {
  const byTable = new Map<string, ReadonlyMap<string, TenantIndexFacts>>();

  for (const facts of allFacts) {
    if (facts.classification !== "tenant") continue;
    if (!isTenantTableName(facts.name)) continue;
    const table: TenantTableName = facts.name;

    const indexes = new Map<string, TenantIndexFacts>();
    for (const index of facts.indexes) {
      if (!acceptable(index.fields)) continue;
      indexes.set(
        index.name,
        Object.freeze({
          table,
          name: index.name,
          fields: Object.freeze([...index.fields]),
          fieldsAfterOrg: Object.freeze(index.fields.slice(1)),
        }),
      );
    }

    byTable.set(table, freezeMap(indexes));
  }

  return freezeMap(byTable);
}

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

export const TENANT_INDEX_METADATA: TenantIndexMetadata =
  deriveTenantIndexMetadata(describeSchema(schema));

export function describeTenantIndex(
  table: string,
  index: string,
  metadata: TenantIndexMetadata = TENANT_INDEX_METADATA,
): TenantIndexFacts | undefined {
  return metadata.get(table)?.get(index);
}

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

    if (!isTenantTableName(facts.name)) {
      problems.push(
        `${facts.name}: table is classified "tenant" but is not named by ` +
          "TENANT_TABLES, so it is unclassified as far as indexed tenant reads " +
          "are concerned and none of its indexes is usable; add it to " +
          "TENANT_TABLES or correct its classification",
      );
      continue;
    }

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
