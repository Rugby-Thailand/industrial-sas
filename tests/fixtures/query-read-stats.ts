import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../../convex/schema";
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
}

export const emptyStats = (): ReadStats => ({
  ranges: {},
  rangeDocs: {},
  gets: {},
});
const bump = (map: Record<string, number>, key: string, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
};
export function addStats(into: ReadStats, from: ReadStats) {
  for (const field of ["ranges", "rangeDocs", "gets"] as const)
    for (const [key, value] of Object.entries(from[field]))
      bump(into[field], key, value);
}

const TERMINAL = new Set(["take", "paginate", "collect", "first", "unique"]);

function wrapQuery(query: object, table: string, stats: ReadStats): object {
  return new Proxy(query, {
    get(target, key, receiver) {
      const member = Reflect.get(target, key, receiver);
      if (typeof member !== "function") return member;
      return (...input: unknown[]) => {
        const result = Reflect.apply(member, target, input);
        if (TERMINAL.has(String(key)) && result instanceof Promise) {
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
            return value;
          });
        }
        return result &&
          typeof result === "object" &&
          !(result instanceof Promise)
          ? wrapQuery(result, table, stats)
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
): Promise<{ value: T; stats: ReadStats }> {
  const stats = emptyStats();
  const outcome = (await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run(async (ctx) => {
      const db = new Proxy(ctx.db, {
        get(target, key, receiver) {
          const member = Reflect.get(target, key, receiver);
          if (key === "query")
            return (table: string) =>
              wrapQuery(Reflect.apply(member, target, [table]), table, stats);
          if (key === "get")
            return (...input: unknown[]) => {
              // Convex accepts get(id) and get(table, id).
              const table =
                input.length > 1 ? String(input[0]) : "(unknown table)";
              bump(stats.gets, table);
              return Reflect.apply(member, target, input);
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
  return { value: outcome.value, stats };
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
