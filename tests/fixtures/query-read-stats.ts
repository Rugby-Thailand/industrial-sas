import type { GenericMutationCtx } from "convex/server";
import schema, { type DataModel } from "../../convex/schema";
import type { ConvexTenantWorld } from "@tests/fixtures/convex-tenant-world";

/** Registered Convex function wrapper (queryWithOrg / mutationWithOrg). */
type Runtime = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};

/** Per-table counters of what one function execution read through ctx.db. */
export interface ReadStats {
  /** Index/table range operations (take/paginate/collect/first/unique). */
  ranges: Record<string, number>;
  /** Documents returned by range operations. */
  rangeDocs: Record<string, number>;
  /** Point reads through db.get. */
  gets: Record<string, number>;
  /** Approximate UTF-8 JSON document bytes, not Convex wire encoding. */
  bytes: Record<string, number>;
}

/**
 * What one execution's result depends on, as Convex tracks it for reactivity:
 * every index range it read (bounds as recorded from withIndex; a range read
 * with take(n) is recorded whole, so the set over-approximates) and every
 * document it read by id. See `rerunsOn`.
 */
export interface ReadSet {
  ranges: { table: string; bounds: RangeBound[] }[];
  ids: Set<string>;
}
type RangeBound = {
  op: "eq" | "gt" | "gte" | "lt" | "lte";
  field: string;
  value: unknown;
};
/** One document a mutation wrote, before and after (null when absent). */
export interface WrittenDocument {
  table: string;
  id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export const emptyStats = (): ReadStats => ({
  ranges: {},
  rangeDocs: {},
  gets: {},
  bytes: {},
});
const bump = (map: Record<string, number>, key: string, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
};
export function addStats(into: ReadStats, from: ReadStats) {
  for (const field of ["ranges", "rangeDocs", "gets", "bytes"] as const)
    for (const [key, value] of Object.entries(from[field]))
      bump(into[field], key, value);
}

const TERMINAL = new Set(["take", "paginate", "collect", "first", "unique"]);

/** Replays a withIndex range callback against a recorder to capture its bounds. */
function recordBounds(build: unknown): RangeBound[] {
  const bounds: RangeBound[] = [];
  const recorder: Record<string, unknown> = {};
  for (const op of ["eq", "gt", "gte", "lt", "lte"] as const)
    recorder[op] = (field: string, value: unknown) => {
      bounds.push({ op, field, value });
      return recorder;
    };
  if (typeof build === "function") build(recorder);
  return bounds;
}

function wrapQuery(
  query: object,
  table: string,
  stats: ReadStats,
  readSet?: ReadSet,
  bounds: RangeBound[] = [],
): object {
  return new Proxy(query, {
    get(target, key, receiver) {
      const member = Reflect.get(target, key, receiver);
      if (typeof member !== "function") return member;
      return (...input: unknown[]) => {
        const result = Reflect.apply(member, target, input);
        const nextBounds =
          key === "withIndex" ? recordBounds(input[1]) : bounds;
        if (TERMINAL.has(String(key)) && result instanceof Promise) {
          readSet?.ranges.push({ table, bounds });
          bump(stats.ranges, table);
          return result.then((value: unknown) => {
            const docs = Array.isArray(value)
              ? value.length
              : value && typeof value === "object" && "page" in value
                ? (value as { page: unknown[] }).page.length
                : value
                  ? 1
                  : 0;
            bump(stats.rangeDocs, table, docs);
            const returned =
              value && typeof value === "object" && "page" in value
                ? (value as { page: unknown[] }).page
                : value;
            if (returned !== null && returned !== undefined)
              bump(
                stats.bytes,
                table,
                new TextEncoder().encode(JSON.stringify(returned)).length,
              );
            return value;
          });
        }
        return result &&
          typeof result === "object" &&
          !(result instanceof Promise)
          ? wrapQuery(result, table, stats, readSet, nextBounds)
          : result;
      };
    },
  });
}

/**
 * Run a real registered function (including its tenant/authorization wrapper)
 * in one convex-test transaction, counting every database read it performs.
 */
export async function measured<T>(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
): Promise<{ value: T; stats: ReadStats; readSet: ReadSet }> {
  const stats = emptyStats();
  const readSet: ReadSet = { ranges: [], ids: new Set() };
  const outcome = (await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run(async (ctx) => {
      const db = new Proxy(ctx.db, {
        get(target, key, receiver) {
          const member = Reflect.get(target, key, receiver);
          if (key === "query")
            return (table: string) =>
              wrapQuery(
                Reflect.apply(member, target, [table]),
                table,
                stats,
                readSet,
              );
          if (key === "get")
            return (...input: unknown[]) => {
              // Convex accepts get(id) and get(table, id).
              const table =
                input.length > 1 ? String(input[0]) : "(unknown table)";
              readSet.ids.add(String(input[input.length - 1]));
              bump(stats.gets, table);
              return Promise.resolve(Reflect.apply(member, target, input)).then(
                (value) => {
                  if (value !== null && value !== undefined)
                    bump(
                      stats.bytes,
                      table,
                      new TextEncoder().encode(JSON.stringify(value)).length,
                    );
                  return value;
                },
              );
            };
          return typeof member === "function" ? member.bind(target) : member;
        },
      });
      return (fn as Runtime)._handler(
        { ...ctx, db } as GenericMutationCtx<DataModel>,
        args,
      );
    })) as { ok: boolean; value: T };
  if (!outcome.ok) throw new Error(`Call refused: ${JSON.stringify(outcome)}`);
  return { value: outcome.value, stats, readSet };
}

/**
 * Run a registered mutation (with its tenant wrapper) and record every
 * document it inserted, patched, replaced or deleted, before and after.
 */
export async function recordWrites<T>(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
): Promise<{ value: T; writes: WrittenDocument[] }> {
  const touched = new Map<string, string>();
  const before = new Map<string, Record<string, unknown> | null>();
  const outcome = (await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run(async (ctx) => {
      const remember = async (table: string | undefined, id: string) => {
        if (!touched.has(id)) {
          touched.set(
            id,
            table ??
              Object.keys(schema.tables).find(
                (name) => ctx.db.normalizeId(name as never, id) !== null,
              ) ??
              "(unknown table)",
          );
          before.set(
            id,
            (await ctx.db.get(id as never)) as Record<string, unknown> | null,
          );
        }
      };
      const db = new Proxy(ctx.db, {
        get(target, key, receiver) {
          const member = Reflect.get(target, key, receiver);
          if (typeof member !== "function") return member;
          if (key === "insert")
            return async (table: string, value: unknown) => {
              const id = String(
                await Reflect.apply(member, target, [table, value]),
              );
              if (!touched.has(id)) {
                touched.set(id, table);
                before.set(id, null);
              }
              return id;
            };
          if (key === "patch" || key === "replace" || key === "delete")
            return async (...input: unknown[]) => {
              // Convex accepts (id, …) and (table, id, …).
              const withTable =
                key === "delete" ? input.length > 1 : input.length > 2;
              const id = String(withTable ? input[1] : input[0]);
              await remember(withTable ? String(input[0]) : undefined, id);
              return Reflect.apply(member, target, input);
            };
          return member.bind(target);
        },
      });
      const result = await (fn as Runtime)._handler(
        { ...ctx, db } as GenericMutationCtx<DataModel>,
        args,
      );
      const writes: WrittenDocument[] = [];
      for (const [id, table] of touched)
        writes.push({
          table,
          id,
          before: before.get(id) ?? null,
          after: (await ctx.db.get(id as never)) as Record<
            string,
            unknown
          > | null,
        });
      return { result, writes };
    })) as {
    result: { ok: boolean; value: T };
    writes: WrittenDocument[];
  };
  if (!outcome.result.ok)
    throw new Error(`Call refused: ${JSON.stringify(outcome.result)}`);
  return { value: outcome.result.value, writes: outcome.writes };
}

const inBounds = (document: Record<string, unknown>, bounds: RangeBound[]) =>
  bounds.every(({ op, field, value }) => {
    const actual = document[field] as never;
    const bound = value as never;
    switch (op) {
      case "eq":
        return actual === bound;
      case "gt":
        return actual > bound;
      case "gte":
        return actual >= bound;
      case "lt":
        return actual < bound;
      case "lte":
        return actual <= bound;
    }
  });

/**
 * Whether Convex would re-run a query whose read set is `readSet` after these
 * writes: a written document was read by id, or its old or new version lies
 * in a range the query read. Conservative: whole ranges are compared even
 * where the query only read their first rows. Writes that leave a document
 * unchanged still count (Convex invalidates on the write, not the value).
 */
export function rerunsOn(readSet: ReadSet, writes: readonly WrittenDocument[]) {
  return writes.filter(
    (write) =>
      readSet.ids.has(write.id) ||
      readSet.ranges.some(
        (range) =>
          range.table === write.table &&
          [write.before, write.after].some(
            (document) => document !== null && inBounds(document, range.bounds),
          ),
      ),
  );
}

type ScanResult = {
  status: string;
  scanCursor?: string;
  continueCursor: string;
  isDone: boolean;
};

/**
 * Drive one catalogue page exactly as useCatalogueSync does: re-issue the
 * query with each returned scanCursor until it is no longer "scanning".
 * Returns the final page plus the number of requests and summed reads.
 */
export async function settlePage<R extends ScanResult>(
  world: ConvexTenantWorld,
  fn: unknown,
  args: Record<string, unknown>,
  maxRequests = 2_000,
) {
  const stats = emptyStats();
  let scanCursor: string | undefined;
  for (let requests = 1; requests <= maxRequests; requests++) {
    const { value, stats: one } = await measured<R>(world, fn, {
      ...args,
      ...(scanCursor ? { scanCursor } : {}),
    });
    addStats(stats, one);
    if (value.status !== "scanning") return { result: value, requests, stats };
    scanCursor = value.scanCursor;
  }
  throw new Error("scan did not settle");
}
