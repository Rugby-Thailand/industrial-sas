import type { GenericDatabaseReader } from "convex/server";
import type { DataModel } from "../../convex/schema";

/** Count actual tenant-adapter document gets, including repeated/null reads. */
export function trackDocumentReads<Db extends GenericDatabaseReader<DataModel>>(
  database: Db,
) {
  const reads: { table: string; id: string }[] = [];
  const db = new Proxy(database, {
    get(target, key, receiver) {
      const member = Reflect.get(target, key, receiver);
      if (key === "get" && typeof member === "function")
        return (...args: unknown[]) => {
          reads.push({ table: String(args[0]), id: String(args[1]) });
          return Reflect.apply(member, target, args);
        };
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  return { db, reads };
}
