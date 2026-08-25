import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";

import type { DataModel } from "../schema";
import {
  TENANT_INDEX_MAX_CURSOR_LENGTH,
  TENANT_INDEX_MAX_PAGE_SIZE,
  TenantDbError,
  assertTenantTableName,
  type TenantIndexEquality,
  type TenantStorageDocument,
  type TenantStoragePort,
  type TenantTableName,
} from "./tenantDb";
import {
  describeTenantIndex,
  type TenantIndexFacts,
} from "./tenantIndexPolicy";
import { TENANT_DISCRIMINATOR } from "./tenantTable";

const ORGANIZATION_TABLE = "organizations";

export interface TenantQueryContext {
  readonly db: GenericDatabaseReader<DataModel>;
}

export interface TenantMutationContext {
  readonly db: GenericDatabaseWriter<DataModel>;
}

export interface TenantQueryStoragePort extends TenantStoragePort {
  readonly insert: (
    table: TenantTableName,
    document: TenantStorageDocument,
  ) => Promise<never>;
  readonly patch: (
    table: TenantTableName,
    id: string,
    fields: TenantStorageDocument,
  ) => Promise<never>;
  readonly replace: (
    table: TenantTableName,
    id: string,
    document: TenantStorageDocument,
  ) => Promise<never>;
  readonly delete: (table: TenantTableName, id: string) => Promise<never>;
}

interface ConvexIndexRangeBuilder {
  eq: (field: string, value: unknown) => ConvexIndexRangeBuilder;
}

interface ConvexBoundedQuery {
  take: (count: number) => Promise<unknown>;
  paginate: (options: {
    readonly numItems: number;
    readonly cursor: string | null;
  }) => Promise<unknown>;
}

interface ConvexQueryInitializer {
  withIndex: (
    index: string,
    range: (builder: ConvexIndexRangeBuilder) => ConvexIndexRangeBuilder,
  ) => ConvexBoundedQuery;
}

interface ConvexReadDatabase {
  normalizeId: (table: string, id: string) => string | null;
  get: (table: string, id: string) => Promise<unknown>;
  query: (table: string) => ConvexQueryInitializer;
}

interface ConvexWriteDatabase extends ConvexReadDatabase {
  insert: (table: string, document: TenantStorageDocument) => Promise<unknown>;
  patch: (
    table: string,
    id: string,
    fields: TenantStorageDocument,
  ) => Promise<void>;
  replace: (
    table: string,
    id: string,
    document: TenantStorageDocument,
  ) => Promise<void>;
  delete: (table: string, id: string) => Promise<void>;
}

function untypedReadDatabase(
  db: GenericDatabaseReader<DataModel>,
): ConvexReadDatabase {
  return db as unknown as ConvexReadDatabase;
}

function untypedWriteDatabase(
  db: GenericDatabaseWriter<DataModel>,
): ConvexWriteDatabase {
  return db as unknown as ConvexWriteDatabase;
}

function organizationIdCheck(
  db: ConvexReadDatabase,
): (value: unknown) => boolean {
  return (value: unknown): boolean =>
    typeof value === "string" &&
    value.length > 0 &&
    db.normalizeId(ORGANIZATION_TABLE, value) !== null;
}

function createReads(
  db: ConvexReadDatabase,
  requestId: string,
): Pick<TenantStoragePort, "get" | "indexedPage"> {
  const invalidQuery = (): TenantDbError =>
    new TenantDbError("INVALID_INDEX_QUERY", requestId);
  const invalidResult = (): TenantDbError =>
    new TenantDbError("INVALID_INDEX_RESULT", requestId);

  const checkedTable = (table: TenantTableName): string => {
    assertTenantTableName(table, requestId);
    return table;
  };

  const normalizedId = (table: string, id: string): string | null => {
    if (typeof id !== "string" || id.length === 0) return null;
    return db.normalizeId(table, id);
  };

  const isOrganizationId = organizationIdCheck(db);

  const checkedTerms = (
    facts: TenantIndexFacts,
    supplied: TenantIndexEquality,
  ): readonly { readonly field: string; readonly value: unknown }[] => {
    if (!Array.isArray(supplied)) throw invalidQuery();
    if (supplied.length === 0) throw invalidQuery();
    if (supplied.length > facts.fields.length) throw invalidQuery();

    const terms: { readonly field: string; readonly value: unknown }[] = [];

    for (let position = 0; position < supplied.length; position += 1) {
      const term: unknown = supplied[position];
      if (term === null || typeof term !== "object") throw invalidQuery();
      if (Array.isArray(term)) throw invalidQuery();

      const record = term as Record<string, unknown>;
      const field: unknown = record.field;
      if (typeof field !== "string") throw invalidQuery();
      if (field !== facts.fields[position]) throw invalidQuery();
      if (!Object.hasOwn(record, "value")) throw invalidQuery();

      const value: unknown = record.value;
      if (value === undefined) throw invalidQuery();
      if (field === TENANT_DISCRIMINATOR && !isOrganizationId(value)) {
        throw invalidQuery();
      }

      terms.push({ field, value });
    }

    return terms;
  };

  const checkedLimit = (limit: number): number => {
    if (typeof limit !== "number" || !Number.isSafeInteger(limit)) {
      throw new TenantDbError("INVALID_LIMIT", requestId);
    }
    if (limit < 1 || limit > TENANT_INDEX_MAX_PAGE_SIZE) {
      throw new TenantDbError("INVALID_LIMIT", requestId);
    }
    return limit;
  };

  const checkedCursor = (cursor: string | null): string | null => {
    if (cursor === null) return null;
    if (typeof cursor !== "string") throw invalidQuery();
    if (cursor.length === 0) throw invalidQuery();
    if (cursor.length > TENANT_INDEX_MAX_CURSOR_LENGTH) throw invalidQuery();
    return cursor;
  };

  const answeredPage = (
    rows: readonly unknown[],
    isDone: boolean,
    continueCursor: string,
  ): unknown =>
    Object.freeze({
      page: Object.freeze([...rows]),
      isDone,
      continueCursor,
    });

  const get = async (table: TenantTableName, id: string): Promise<unknown> => {
    const name = checkedTable(table);
    const documentId = normalizedId(name, id);

    // A malformed or foreign-table ID answers exactly as an absent document does.
    // The accessor turns both into `NOT_FOUND`, so a caller holding an ID it was
    // never shown cannot tell which of the two it holds (`INV-0002-03`).
    if (documentId === null) return null;

    return await db.get(name, documentId);
  };

  const indexedPage = async (
    table: TenantTableName,
    index: string,
    equality: TenantIndexEquality,
    page: { readonly limit: number; readonly cursor: string | null },
  ): Promise<unknown> => {
    const name = checkedTable(table);

    const facts = describeTenantIndex(name, index);
    if (facts === undefined) throw invalidQuery();

    const terms = checkedTerms(facts, equality);

    if (page === null || typeof page !== "object") throw invalidQuery();
    const limit = checkedLimit(page.limit);
    const cursor = checkedCursor(page.cursor);

    const bounded = (): ConvexBoundedQuery =>
      db.query(name).withIndex(facts.name, (builder) => {
        let range = builder;
        for (const term of terms) {
          range = range.eq(term.field, term.value);
        }
        return range;
      });

    if (cursor === null) {
      const probe: unknown = await bounded().take(limit + 1);
      if (!Array.isArray(probe)) throw invalidResult();

      if (probe.length <= limit) {
        return answeredPage(probe as readonly unknown[], true, "");
      }
    }

    const answer: unknown = await bounded().paginate({
      numItems: limit,
      cursor,
    });

    if (answer === null || typeof answer !== "object") throw invalidResult();
    if (Array.isArray(answer)) throw invalidResult();

    const record = answer as Record<string, unknown>;
    const rows: unknown = record.page;
    if (!Array.isArray(rows)) throw invalidResult();

    if (rows.length > limit) throw invalidResult();

    const isDone: unknown = record.isDone;
    if (typeof isDone !== "boolean") throw invalidResult();

    const continueCursor: unknown = record.continueCursor;
    if (typeof continueCursor !== "string") throw invalidResult();
    if (continueCursor.length > TENANT_INDEX_MAX_CURSOR_LENGTH) {
      throw invalidResult();
    }
    if (!isDone && continueCursor.length === 0) throw invalidResult();

    return answeredPage(rows as readonly unknown[], isDone, continueCursor);
  };

  return { get, indexedPage };
}

function checkedDocument(
  document: TenantStorageDocument,
  tenancy: "required" | "forbidden",
  isOrganizationId: (value: unknown) => boolean,
  requestId: string,
): TenantStorageDocument {
  const invalid = (): TenantDbError =>
    new TenantDbError("INVALID_WRITE", requestId);

  if (document === null || typeof document !== "object") throw invalid();
  if (Array.isArray(document)) throw invalid();

  for (const key of Object.keys(document)) {
    if (key.startsWith("_")) throw invalid();
  }

  const hasTenant = Object.hasOwn(document, TENANT_DISCRIMINATOR);
  if (tenancy === "forbidden") {
    if (hasTenant) throw invalid();
    return document;
  }

  if (!hasTenant) throw invalid();
  if (!isOrganizationId(document[TENANT_DISCRIMINATOR])) throw invalid();
  return document;
}

export function createQueryTenantStorage(
  ctx: TenantQueryContext,
  requestId: string,
): TenantQueryStoragePort {
  const db = untypedReadDatabase(ctx.db);

  const refuse = async (): Promise<never> => {
    throw new TenantDbError("INVALID_WRITE", requestId);
  };

  return Object.freeze({
    ...createReads(db, requestId),
    insert: refuse,
    patch: refuse,
    replace: refuse,
    delete: refuse,
  });
}

export function createMutationTenantStorage(
  ctx: TenantMutationContext,
  requestId: string,
): TenantStoragePort {
  const db = untypedWriteDatabase(ctx.db);
  const reads = createReads(db, requestId);

  const notFound = (): TenantDbError =>
    new TenantDbError("NOT_FOUND", requestId);
  const invalidWrite = (): TenantDbError =>
    new TenantDbError("INVALID_WRITE", requestId);

  const isOrganizationId = organizationIdCheck(db);

  const targetId = (table: TenantTableName, id: string): string => {
    assertTenantTableName(table, requestId);
    const documentId =
      typeof id === "string" && id.length > 0
        ? db.normalizeId(table, id)
        : null;
    if (documentId === null) throw notFound();
    return documentId;
  };

  const writeById = async (
    table: TenantTableName,
    documentId: string,
    write: () => Promise<void>,
  ): Promise<void> => {
    try {
      await write();
    } catch (error) {
      if ((await db.get(table, documentId)) === null) throw notFound();
      throw error;
    }
  };

  const insert = async (
    table: TenantTableName,
    document: TenantStorageDocument,
  ): Promise<string> => {
    assertTenantTableName(table, requestId);
    const value = checkedDocument(
      document,
      "required",
      isOrganizationId,
      requestId,
    );

    const inserted: unknown = await db.insert(table, value);

    if (
      typeof inserted !== "string" ||
      db.normalizeId(table, inserted) === null
    ) {
      throw invalidWrite();
    }
    return inserted;
  };

  const patch = async (
    table: TenantTableName,
    id: string,
    fields: TenantStorageDocument,
  ): Promise<void> => {
    const value = checkedDocument(
      fields,
      "forbidden",
      isOrganizationId,
      requestId,
    );
    const documentId = targetId(table, id);
    await writeById(table, documentId, async () => {
      await db.patch(table, documentId, value);
    });
  };

  const replace = async (
    table: TenantTableName,
    id: string,
    document: TenantStorageDocument,
  ): Promise<void> => {
    const value = checkedDocument(
      document,
      "required",
      isOrganizationId,
      requestId,
    );
    const documentId = targetId(table, id);
    await writeById(table, documentId, async () => {
      await db.replace(table, documentId, value);
    });
  };

  const remove = async (table: TenantTableName, id: string): Promise<void> => {
    const documentId = targetId(table, id);
    await writeById(table, documentId, async () => {
      await db.delete(table, documentId);
    });
  };

  return Object.freeze({
    ...reads,
    insert,
    patch,
    replace,
    delete: remove,
  });
}
