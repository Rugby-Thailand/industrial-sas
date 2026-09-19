import type { GenericId } from "convex/values";

import { TENANT_TABLES, type TenantTableName } from "./schemaPolicy";
import {
  describeTenantIndex,
  type TenantIndexFacts,
} from "./tenantIndexPolicy";
import { TENANT_DISCRIMINATOR } from "./tenantTable";

export type { TenantTableName };

function immutableSet<Value>(values: Iterable<Value>): ReadonlySet<Value> {
  const set = new Set(values);

  for (const method of ["add", "delete", "clear"] as const) {
    Object.defineProperty(set, method, {
      value: (): never => {
        throw new Error(
          `The tenant table allowlist is immutable; "${method}" is not ` +
            "available. Add the table to TENANT_TABLES in " +
            "convex/lib/schemaPolicy.ts instead.",
        );
      },
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }

  return Object.freeze(set);
}

export const TENANT_TABLE_NAMES: ReadonlySet<TenantTableName> =
  immutableSet(TENANT_TABLES);

export const TENANT_DB_ERROR_CODES = [
  "INVALID_TENANT_TABLE",
  "NOT_FOUND",
  "INVALID_WRITE",
  "INVALID_LIMIT",
  "INVALID_INDEX_QUERY",
  "INVALID_INDEX_RESULT",
  "CAPACITY_DATA_LIMIT",
] as const;

export type TenantDbErrorCode = (typeof TENANT_DB_ERROR_CODES)[number];

export const TENANT_DB_ERROR_MESSAGE =
  "This request was denied. Quote the request ID when asking for help.";

export interface PublicTenantDbError {
  readonly code: TenantDbErrorCode;
  readonly requestId: string;
}

export class TenantDbError extends Error {
  override readonly name = "TenantDbError";

  readonly code: TenantDbErrorCode;
  readonly requestId: string;

  constructor(code: TenantDbErrorCode, requestId: string) {
    super(TENANT_DB_ERROR_MESSAGE);
    this.code = code;
    this.requestId = requestId;
  }

  /** The payload a client may receive. Frozen: a caller cannot enrich it. */
  toPublic(): PublicTenantDbError {
    return Object.freeze({ code: this.code, requestId: this.requestId });
  }
}

export function assertTenantTableName(
  value: string,
  requestId: string,
): asserts value is TenantTableName {
  if (!TENANT_TABLE_NAMES.has(value as TenantTableName)) {
    throw new TenantDbError("INVALID_TENANT_TABLE", requestId);
  }
}

export type TenantOrgId = GenericId<"organizations">;

export interface TenantOwnedDocument {
  readonly orgId: TenantOrgId;
}

export function assertOwnedDocument<
  Document extends TenantOwnedDocument = TenantOwnedDocument,
>(document: unknown, expectedOrgId: TenantOrgId, requestId: string): Document {
  // Constructed lazily: every read passes through here, and an `Error` built on
  // the success path would capture a stack trace for nothing.
  const notFound = (): TenantDbError =>
    new TenantDbError("NOT_FOUND", requestId);

  if (!isUsableKey(expectedOrgId)) throw notFound();
  if (document === null || typeof document !== "object") throw notFound();
  if (Array.isArray(document)) throw notFound();
  if (!Object.hasOwn(document, TENANT_DISCRIMINATOR)) throw notFound();

  const owner: unknown = (document as Record<string, unknown>)[
    TENANT_DISCRIMINATOR
  ];
  if (!isUsableKey(owner)) throw notFound();
  if (owner !== expectedOrgId) throw notFound();

  return document as Document;
}

function isUsableKey(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.trim() === value
  );
}

export const FORBIDDEN_WRITE_FIELDS = [
  TENANT_DISCRIMINATOR,
  "_id",
  "_creationTime",
] as const;

type ForbiddenWriteField = (typeof FORBIDDEN_WRITE_FIELDS)[number];

export type TenantWritePayload = Record<string, unknown> & {
  readonly [Key in ForbiddenWriteField]?: never;
};

export type TenantInsertPayload<Payload extends TenantWritePayload> = {
  readonly orgId: TenantOrgId;
} & Payload;

function assertWritableFields(
  payload: unknown,
  requestId: string,
): Record<string, unknown> {
  const invalid = (): TenantDbError =>
    new TenantDbError("INVALID_WRITE", requestId);

  if (payload === null || typeof payload !== "object") throw invalid();
  if (Array.isArray(payload)) throw invalid();

  for (const key of Object.keys(payload)) {
    if (key === TENANT_DISCRIMINATOR || key.startsWith("_")) throw invalid();
  }

  return payload as Record<string, unknown>;
}

export function tenantInsertPayload<Payload extends TenantWritePayload>(
  payload: Payload,
  orgId: TenantOrgId,
  requestId: string,
): TenantInsertPayload<Payload> {
  const fields = assertWritableFields(payload, requestId);

  if (!isUsableKey(orgId)) {
    throw new TenantDbError("INVALID_WRITE", requestId);
  }

  const document: Record<string, unknown> = { [TENANT_DISCRIMINATOR]: orgId };
  for (const [key, value] of Object.entries(fields)) {
    document[key] = value;
  }

  return Object.freeze(document) as TenantInsertPayload<Payload>;
}

export function tenantUpdatePayload<Payload extends TenantWritePayload>(
  payload: Payload,
  requestId: string,
): Payload {
  assertWritableFields(payload, requestId);
  return payload;
}

export type TenantStorageDocument = Record<string, unknown>;

export interface TenantIndexEqualityTerm {
  readonly field: string;
  readonly value: unknown;
}

export type TenantIndexEquality = readonly TenantIndexEqualityTerm[];

export const TENANT_INDEX_MAX_PAGE_SIZE = 100;
/** Complete transactional reads must fail, never truncate occupancy. */
export const TENANT_INDEX_MAX_BATCH_SIZE = 10_000;

export const TENANT_INDEX_MAX_CURSOR_LENGTH = 4096;

export interface TenantIndexPageRequest {
  readonly limit: number;
  /** An opaque cursor from a previous page. Absent means the first page. */
  readonly cursor?: string | undefined;
  readonly order?: "asc" | "desc";
  readonly endCursor?: string | undefined;
}

export interface TenantIndexPage<
  Document extends TenantOwnedDocument = TenantOwnedDocument,
> {
  readonly page: readonly Document[];
  readonly isDone: boolean;

  readonly continueCursor: string;
  readonly splitCursor?: string | null;
  readonly pageStatus?: "SplitRecommended" | "SplitRequired" | null;
}

export interface TenantStoragePort {
  readonly get: (table: TenantTableName, id: string) => Promise<unknown>;

  readonly insert: (
    table: TenantTableName,
    document: TenantStorageDocument,
  ) => Promise<string>;

  readonly patch: (
    table: TenantTableName,
    id: string,
    fields: TenantStorageDocument,
  ) => Promise<void>;

  readonly replace: (
    table: TenantTableName,
    id: string,
    document: TenantStorageDocument,
  ) => Promise<void>;

  readonly delete: (table: TenantTableName, id: string) => Promise<void>;

  readonly indexedBatch?: (
    table: TenantTableName,
    index: string,
    equality: TenantIndexEquality,
    limit: number,
  ) => Promise<unknown>;

  readonly indexedPage: (
    table: TenantTableName,
    index: string,
    equality: TenantIndexEquality,
    page: {
      readonly limit: number;
      readonly cursor: string | null;
      readonly order?: "asc" | "desc";
      readonly endCursor?: string | null;
      readonly nativePage?: boolean;
    },
  ) => Promise<unknown>;
}

export interface TenantDocumentAccessScope {
  readonly orgId: TenantOrgId;

  readonly requestId: string;
}

export interface TenantIndexReader<
  Document extends TenantOwnedDocument = TenantOwnedDocument,
> {
  readonly all: (limit: number) => Promise<readonly Document[]>;

  readonly first: () => Promise<Document | null>;

  readonly unique: () => Promise<Document | null>;

  readonly take: (limit: number) => Promise<readonly Document[]>;

  readonly page: (
    request: TenantIndexPageRequest,
  ) => Promise<TenantIndexPage<Document>>;
}

export interface TenantDocumentAccess {
  readonly get: <Document extends TenantOwnedDocument = TenantOwnedDocument>(
    table: TenantTableName,
    id: string,
  ) => Promise<Document | null>;

  readonly getX: <Document extends TenantOwnedDocument = TenantOwnedDocument>(
    table: TenantTableName,
    id: string,
  ) => Promise<Document>;

  readonly insert: <Payload extends TenantWritePayload>(
    table: TenantTableName,
    payload: Payload,
  ) => Promise<string>;

  readonly patch: <Payload extends TenantWritePayload>(
    table: TenantTableName,
    id: string,
    fields: Payload,
  ) => Promise<void>;

  readonly replace: <Payload extends TenantWritePayload>(
    table: TenantTableName,
    id: string,
    document: Payload,
  ) => Promise<void>;

  readonly delete: (table: TenantTableName, id: string) => Promise<void>;

  readonly byIndex: <
    Document extends TenantOwnedDocument = TenantOwnedDocument,
  >(
    table: TenantTableName,
    index: string,
    equalityAfterOrg?: TenantIndexEquality,
  ) => TenantIndexReader<Document>;
}

export function createTenantDocumentAccess(
  scope: TenantDocumentAccessScope,
  port: TenantStoragePort,
): TenantDocumentAccess {
  const { orgId, requestId } = scope;

  const requireTenantTable = (table: TenantTableName): void => {
    assertTenantTableName(table, requestId);
  };

  const readOwned = async <
    Document extends TenantOwnedDocument = TenantOwnedDocument,
  >(
    table: TenantTableName,
    id: string,
  ): Promise<Document> => {
    requireTenantTable(table);

    if (!isUsableKey(id)) throw new TenantDbError("NOT_FOUND", requestId);

    return assertOwnedDocument<Document>(
      await port.get(table, id),
      orgId,
      requestId,
    );
  };

  const get = async <
    Document extends TenantOwnedDocument = TenantOwnedDocument,
  >(
    table: TenantTableName,
    id: string,
  ): Promise<Document | null> => {
    try {
      return await readOwned<Document>(table, id);
    } catch (error) {
      if (error instanceof TenantDbError && error.code === "NOT_FOUND") {
        return null;
      }
      throw error;
    }
  };

  const insert = async <Payload extends TenantWritePayload>(
    table: TenantTableName,
    payload: Payload,
  ): Promise<string> => {
    requireTenantTable(table);
    const document = tenantInsertPayload(payload, orgId, requestId);

    return await port.insert(table, document as TenantStorageDocument);
  };

  const patch = async <Payload extends TenantWritePayload>(
    table: TenantTableName,
    id: string,
    fields: Payload,
  ): Promise<void> => {
    await readOwned(table, id);
    const update = tenantUpdatePayload(fields, requestId);

    await port.patch(table, id, update as TenantStorageDocument);
  };

  const replace = async <Payload extends TenantWritePayload>(
    table: TenantTableName,
    id: string,
    document: Payload,
  ): Promise<void> => {
    await readOwned(table, id);

    const replacement = tenantInsertPayload(document, orgId, requestId);

    await port.replace(table, id, replacement as TenantStorageDocument);
  };

  const remove = async (table: TenantTableName, id: string): Promise<void> => {
    await readOwned(table, id);
    await port.delete(table, id);
  };

  const invalidQuery = (): TenantDbError =>
    new TenantDbError("INVALID_INDEX_QUERY", requestId);
  const invalidResult = (): TenantDbError =>
    new TenantDbError("INVALID_INDEX_RESULT", requestId);

  const requireLimit = (limit: number): number => {
    if (typeof limit !== "number" || !Number.isSafeInteger(limit)) {
      throw new TenantDbError("INVALID_LIMIT", requestId);
    }
    if (limit < 1 || limit > TENANT_INDEX_MAX_PAGE_SIZE) {
      throw new TenantDbError("INVALID_LIMIT", requestId);
    }
    return limit;
  };

  const requireCursor = (cursor: string | undefined): string | null => {
    if (cursor === undefined) return null;
    if (typeof cursor !== "string") throw invalidQuery();
    if (cursor.length === 0) throw invalidQuery();
    if (cursor.length > TENANT_INDEX_MAX_CURSOR_LENGTH) throw invalidQuery();
    return cursor;
  };

  const equalityPrefix = (
    facts: TenantIndexFacts,
    supplied: TenantIndexEquality,
  ): TenantIndexEquality => {
    if (!Array.isArray(supplied)) throw invalidQuery();
    if (supplied.length > facts.fieldsAfterOrg.length) throw invalidQuery();

    const terms: TenantIndexEqualityTerm[] = [
      Object.freeze({ field: TENANT_DISCRIMINATOR, value: orgId }),
    ];
    const seen = new Set<string>([TENANT_DISCRIMINATOR]);

    for (let position = 0; position < supplied.length; position += 1) {
      const term: unknown = supplied[position];
      if (term === null || typeof term !== "object") throw invalidQuery();
      if (Array.isArray(term)) throw invalidQuery();

      const record = term as Record<string, unknown>;
      const field: unknown = record.field;
      if (typeof field !== "string") throw invalidQuery();
      if (seen.has(field)) throw invalidQuery();
      if (field !== facts.fieldsAfterOrg[position]) throw invalidQuery();
      if (!Object.hasOwn(record, "value")) throw invalidQuery();
      if (record.value === undefined) throw invalidQuery();

      seen.add(field);
      terms.push(Object.freeze({ field, value: record.value }));
    }

    return Object.freeze(terms);
  };

  const assertIndexedRow = <Document extends TenantOwnedDocument>(
    row: unknown,
  ): Document => {
    try {
      return assertOwnedDocument<Document>(row, orgId, requestId);
    } catch {
      throw invalidResult();
    }
  };

  const readPage = async <Document extends TenantOwnedDocument>(
    facts: TenantIndexFacts,
    equality: TenantIndexEquality,
    limit: number,
    cursor: string | null,
    order?: "asc" | "desc",
    endCursor?: string | null,
    nativePage?: boolean,
  ): Promise<TenantIndexPage<Document>> => {
    const answer: unknown = await port.indexedPage(
      facts.table,
      facts.name,
      equality,
      {
        limit,
        cursor,
        ...(order ? { order } : {}),
        ...(endCursor ? { endCursor } : {}),
        ...(nativePage ? { nativePage } : {}),
      },
    );

    if (answer === null || typeof answer !== "object") throw invalidResult();
    if (Array.isArray(answer)) throw invalidResult();

    const record = answer as Record<string, unknown>;
    const rows: unknown = record.page;
    if (!Array.isArray(rows)) throw invalidResult();

    const isDone: unknown = record.isDone;
    if (typeof isDone !== "boolean") throw invalidResult();

    const continueCursor: unknown = record.continueCursor;
    if (typeof continueCursor !== "string") throw invalidResult();
    if (continueCursor.length > TENANT_INDEX_MAX_CURSOR_LENGTH) {
      throw invalidResult();
    }
    if (!isDone && continueCursor.length === 0) throw invalidResult();

    if (
      record.splitCursor !== undefined &&
      record.splitCursor !== null &&
      (typeof record.splitCursor !== "string" ||
        record.splitCursor.length > TENANT_INDEX_MAX_CURSOR_LENGTH)
    )
      throw invalidResult();
    if (
      record.pageStatus !== undefined &&
      record.pageStatus !== null &&
      record.pageStatus !== "SplitRecommended" &&
      record.pageStatus !== "SplitRequired"
    )
      throw invalidResult();
    const documents: Document[] = rows.map((row: unknown) =>
      assertIndexedRow<Document>(row),
    );

    return Object.freeze({
      page: Object.freeze(documents),
      isDone,
      continueCursor,
      ...(record.splitCursor !== undefined
        ? { splitCursor: record.splitCursor as string | null }
        : {}),
      ...(record.pageStatus !== undefined
        ? {
            pageStatus: record.pageStatus as
              "SplitRecommended" | "SplitRequired" | null,
          }
        : {}),
    });
  };

  const byIndex = <Document extends TenantOwnedDocument = TenantOwnedDocument>(
    table: TenantTableName,
    index: string,
    equalityAfterOrg: TenantIndexEquality = [],
  ): TenantIndexReader<Document> => {
    requireTenantTable(table);

    if (!isUsableKey(orgId)) throw invalidQuery();

    const facts = describeTenantIndex(table, index);
    if (facts === undefined) throw invalidQuery();

    const equality = equalityPrefix(facts, equalityAfterOrg);

    const first = async (): Promise<Document | null> => {
      const { page } = await readPage<Document>(facts, equality, 1, null);
      return page[0] ?? null;
    };

    const unique = async (): Promise<Document | null> => {
      const { page } = await readPage<Document>(facts, equality, 2, null);
      if (page.length > 1) throw invalidResult();
      return page[0] ?? null;
    };

    const take = async (limit: number): Promise<readonly Document[]> => {
      const bounded = requireLimit(limit);
      const { page } = await readPage<Document>(facts, equality, bounded, null);
      return page;
    };

    const page = async (
      request: TenantIndexPageRequest,
    ): Promise<TenantIndexPage<Document>> => {
      if (request === null || typeof request !== "object") throw invalidQuery();

      const bounded = requireLimit(request.limit);
      const cursor = requireCursor(request.cursor);
      if (
        request.order !== undefined &&
        request.order !== "asc" &&
        request.order !== "desc"
      )
        throw invalidQuery();
      return await readPage<Document>(
        facts,
        equality,
        bounded,
        cursor,
        request.order,
        requireCursor(request.endCursor),
        true,
      );
    };

    const all = async (limit: number): Promise<readonly Document[]> => {
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > TENANT_INDEX_MAX_BATCH_SIZE
      ) {
        throw new TenantDbError("INVALID_LIMIT", requestId);
      }
      if (!port.indexedBatch) throw invalidQuery();
      const answer = await port.indexedBatch(
        facts.table,
        facts.name,
        equality,
        limit,
      );
      if (!Array.isArray(answer)) throw invalidResult();
      if (answer.length > limit)
        throw new TenantDbError("CAPACITY_DATA_LIMIT", requestId);
      return Object.freeze(
        answer.map((row: unknown) => assertIndexedRow<Document>(row)),
      );
    };
    return Object.freeze({ first, unique, take, page, all });
  };

  return Object.freeze({
    get,

    getX: readOwned,
    insert,
    patch,
    replace,
    delete: remove,
    byIndex,
  });
}
