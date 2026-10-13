import type { GenericMutationCtx } from "convex/server";
import { vi } from "vitest";

import type { DataModel } from "../../convex/schema";
import type { ConvexTenantWorld } from "./convex-tenant-world";

/** Index ranges, returned documents and point reads per table, plus clock reads. */
export interface ReadMeter {
  readonly ranges: Record<string, number>;
  readonly docs: Record<string, number>;
  readonly gets: number;
  clock: number;
}

const TERMINAL = new Set(["take", "paginate", "collect", "first", "unique"]);

function wrapQuery<Q extends object>(
  table: string,
  query: Q,
  meter: ReadMeter,
): Q {
  return new Proxy(query, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver);
      if (typeof member !== "function") return member;
      return (...params: unknown[]) => {
        const value = Reflect.apply(member, target, params);
        if (!TERMINAL.has(String(property)))
          return value && typeof value === "object" && !("then" in value)
            ? wrapQuery(table, value as object, meter)
            : value;
        meter.ranges[table] = (meter.ranges[table] ?? 0) + 1;
        return Promise.resolve(value).then((answer: unknown) => {
          const rows = Array.isArray(answer)
            ? answer.length
            : answer && typeof answer === "object" && "page" in answer
              ? (answer as { page: unknown[] }).page.length
              : answer
                ? 1
                : 0;
          meter.docs[table] = (meter.docs[table] ?? 0) + rows;
          return answer;
        });
      };
    },
  });
}

/**
 * Run a registered function's handler with a metered database: every index
 * range and returned document is counted per table, and `clock` counts
 * `Date.now()` calls made while the handler (wrapper included) runs.
 */
export async function meteredCall<T = unknown>(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  identity: { subject: string; org_id: string },
): Promise<{ outcome: T; meter: ReadMeter }> {
  const meter: ReadMeter = { ranges: {}, docs: {}, gets: 0, clock: 0 };
  const outcome = await world.t.withIdentity(identity).run(async (ctx) => {
    const db = new Proxy(ctx.db, {
      get(target, property, receiver) {
        const member = Reflect.get(target, property, receiver);
        if (property === "get")
          return (...params: unknown[]) => {
            (meter as { gets: number }).gets += 1;
            return Reflect.apply(member, target, params);
          };
        if (property === "query")
          return (table: string) =>
            wrapQuery(
              table,
              Reflect.apply(member, target, [table]) as object,
              meter,
            );
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    const spy = vi.spyOn(Date, "now");
    try {
      return await (
        fn as {
          _handler: (
            ctx: GenericMutationCtx<DataModel>,
            args: unknown,
          ) => Promise<unknown>;
        }
      )._handler({ ...ctx, db } as GenericMutationCtx<DataModel>, args);
    } finally {
      meter.clock = spy.mock.calls.length;
      spy.mockRestore();
    }
  });
  return { outcome: outcome as T, meter };
}
