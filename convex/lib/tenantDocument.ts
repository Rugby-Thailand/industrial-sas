import type { Doc, Id } from "../_generated/dataModel";
import type {
  TenantDocumentAccess,
  TenantTableName,
  TenantOwnedDocument,
} from "./tenantDb";

/** Table-derived document access for validated command/query inputs.
 * The tenant adapter still performs ownership and ID/table checks. Callers
 * choose a table, never an unrelated document shape. NoInfer makes the table
 * the only source of the ID type, so a wrong-table ID cannot widen it.
 */
export function tenantDocument<Table extends TenantTableName>(
  db: Pick<TenantDocumentAccess, "get">,
  table: Table,
  id: Id<NoInfer<Table>>,
): Promise<Doc<Table> | null> {
  return db.get<Doc<Table> & TenantOwnedDocument>(table, id);
}
