import { v, type GenericValidator } from "convex/values";

import { makeJobPageRequest } from "../model/inventory/jobPage";

const pageErrorValidator = v.object({ code: v.string() });

export const pageOf = <
  Row extends GenericValidator,
  Error extends GenericValidator = typeof pageErrorValidator,
>(
  row: Row,
  error: Error = pageErrorValidator as unknown as Error,
) =>
  v.union(
    v.object({
      ok: v.literal(true),
      items: v.array(row),
      nextCursor: v.union(v.string(), v.null()),
      complete: v.boolean(),
    }),
    v.object({ ok: v.literal(false), error }),
  );

export const listArgs = {
  maxPageSize: v.optional(v.number()),
  cursor: v.optional(v.string()),
};

export const pageRefusal = (code: string) => ({
  ok: false as const,
  error: { code },
});

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

export const pageOptions = (request: {
  readonly maxPageSize: number;
  readonly cursor: string | null;
}) => ({
  limit: request.maxPageSize,
  ...(request.cursor === null ? {} : { cursor: request.cursor }),
});

export const pageResult = <Item>(
  items: Item[],
  page: { readonly isDone: boolean; readonly continueCursor: string },
) => ({
  ok: true as const,
  items,
  nextCursor: page.isDone ? null : page.continueCursor,
  complete: page.isDone,
});
