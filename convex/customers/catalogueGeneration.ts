import type { Doc } from "../_generated/dataModel";
import type { TenantDocumentAccess } from "../lib/tenantDb";

function catalogueSignal(db: TenantDocumentAccess) {
  return db
    .byIndex<Doc<"customerCatalogueSignals">>(
      "customerCatalogueSignals",
      "by_orgId",
    )
    .unique();
}

export async function customerCatalogueGeneration(db: TenantDocumentAccess) {
  return (await catalogueSignal(db))?.generation ?? 0;
}

export async function bumpCustomerCatalogueGeneration(
  db: TenantDocumentAccess,
) {
  const signal = await catalogueSignal(db);
  if (signal)
    await db.patch("customerCatalogueSignals", signal._id, {
      generation: signal.generation + 1,
    });
  else await db.insert("customerCatalogueSignals", { generation: 1 });
}
