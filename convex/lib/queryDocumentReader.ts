import type { Doc } from "../_generated/dataModel";
import type {
  TenantDocumentAccess,
  TenantOwnedDocument,
  TenantTableName,
} from "./tenantDb";

/** Create inside a query, never at module scope or across mutation writes.
 * Pending reads and nulls are shared only within this authorized snapshot.
 */
export function createQueryDocumentReader<Table extends TenantTableName>(
  db: Pick<TenantDocumentAccess, "get">,
  table: Table,
) {
  const documents = new Map<string, Promise<Doc<Table> | null>>();
  return (id: string) => {
    let pending = documents.get(id);
    if (!pending) {
      pending = db.get<Doc<Table> & TenantOwnedDocument>(table, id);
      documents.set(id, pending);
    }
    return pending;
  };
}
