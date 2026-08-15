/**
 * The wire envelope every tenant-bound list query answers with.
 *
 * Extracted from `convex/purchasing/orders.ts` and `convex/putaway/tasks.ts`,
 * which proved the shape over half a dozen queries, so the order-to-ship slice's
 * own queries cannot drift from it. Same reasoning as `writeEnvelope.ts`: one
 * envelope means one client-side pagination loop rather than one per feature.
 *
 * Two rules the shape enforces:
 *
 * **Every page is bounded.** `makeJobPageRequest` *refuses* — it does not
 * quietly clamp — a size above `MAX_JOB_PAGE_SIZE`, and refuses a malformed
 * cursor, so no query here can be talked into a full-table scan by a large
 * `maxPageSize`, and a caller who asked for 5 000 rows is told no rather than
 * handed 100 and left to believe it was all of them (`INV-0002-05`).
 *
 * **A refusal carries a code and nothing else.** A list query's only refusals
 * are "your page request was unusable" and "no such parent", and neither has a
 * field worth naming — a parent the caller cannot read must look exactly like a
 * parent that does not exist (`INV-0002-03`).
 */
import { v } from "convex/values";

import { makeJobPageRequest } from "../model/inventory/jobPage";

/** `{ ok: true, items, nextCursor, complete }` or `{ ok: false, error }`. */
export const pageOf = <Row extends Parameters<typeof v.array>[0]>(row: Row) =>
  v.union(
    v.object({
      ok: v.literal(true),
      items: v.array(row),
      nextCursor: v.union(v.string(), v.null()),
      complete: v.boolean(),
    }),
    v.object({
      ok: v.literal(false),
      error: v.object({ code: v.string() }),
    }),
  );

/** The two arguments every list query takes on top of its own filters. */
export const listArgs = {
  maxPageSize: v.optional(v.number()),
  cursor: v.optional(v.string()),
};

/** A refused page, flattened for the wire. */
export const pageRefusal = (code: string) => ({
  ok: false as const,
  error: { code },
});

/**
 * Turn the wire arguments into a bounded page request.
 *
 * Both arguments are optional on the wire and *absent* rather than `undefined`
 * on the way in, because `exactOptionalPropertyTypes` distinguishes the two and
 * `makeJobPageRequest` treats an explicit `undefined` cursor as a cursor.
 */
export const pageRequestOf = (args: {
  readonly maxPageSize?: number | undefined;
  readonly cursor?: string | undefined;
}) =>
  makeJobPageRequest({
    ...(args.maxPageSize === undefined
      ? {}
      : { maxPageSize: args.maxPageSize }),
    ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
  });

/** The `.page()` options for an accepted page request. */
export const pageOptions = (request: {
  readonly maxPageSize: number;
  readonly cursor: string | null;
}) => ({
  limit: request.maxPageSize,
  ...(request.cursor === null ? {} : { cursor: request.cursor }),
});
