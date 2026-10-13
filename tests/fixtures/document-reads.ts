import type { GenericDatabaseReader } from "convex/server";
import type { DataModel } from "../../convex/schema";

/** Count actual tenant-adapter document gets, including repeated/null reads. */
export function trackDocumentReads<Db extends GenericDatabaseReader<DataModel>>(
  database: Db,
) {
  const queries: string[] = [];
  const queryRows: { table: string; count: number }[] = [];
  const wrapQuery = (query: object, table: string): object =>
    new Proxy(query, {
      get(target, key, receiver) {
        const member = Reflect.get(target, key, receiver);
        if (typeof member !== "function") return member;
        return (...args: unknown[]) => {
          const result: unknown = Reflect.apply(member, target, args);
          if (result instanceof Promise)
            return result.then((rows) => {
              if (Array.isArray(rows))
                queryRows.push({ table, count: rows.length });
              else if (
                rows &&
                typeof rows === "object" &&
                "page" in rows &&
                Array.isArray(rows.page)
              )
                queryRows.push({ table, count: rows.page.length });
              return rows;
            });
          return result && typeof result === "object"
            ? wrapQuery(result, table)
            : result;
        };
      },
    });
  const reads: { table: string; id: string }[] = [];
  const db = new Proxy(database, {
    get(target, key, receiver) {
      const member = Reflect.get(target, key, receiver);
      if (key === "query" && typeof member === "function")
        return (table: string) => {
          queries.push(table);
          return wrapQuery(Reflect.apply(member, target, [table]), table);
        };
      if (key === "get" && typeof member === "function")
        return (...args: unknown[]) => {
          reads.push({ table: String(args[0]), id: String(args[1]) });
          return Reflect.apply(member, target, args);
        };
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  return { db, reads, queries, queryRows };
}
