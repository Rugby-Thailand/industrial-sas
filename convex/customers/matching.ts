import type { Doc, Id } from "../_generated/dataModel";
import type { TenantDocumentAccess } from "../lib/tenantDb";
import {
  classifyExactCustomerMatches,
  normalizeCustomerName,
} from "../model/customers/customers";

/** Operational pause for automatic assignments. Existing link maintenance stays live. */
export const autoLinkPaused = () =>
  process.env.CUSTOMER_AUTO_LINK_PAUSED === "true";

export type ResolvedExactCustomerMatch =
  | { readonly kind: "UNMATCHED" }
  | { readonly kind: "MATCHED"; readonly customerId: Id<"customers"> }
  | { readonly kind: "ARCHIVED"; readonly customerId: Id<"customers"> }
  | {
      readonly kind: "AMBIGUOUS";
      readonly customerIds: readonly Id<"customers">[];
    };

/**
 * Resolve captured customer text against exact canonical names and approved
 * aliases within the caller's tenant. Links automatically only when all exact
 * claims resolve to a single ACTIVE customer.
 */
export async function resolveExactCustomerMatch(
  tenantDb: TenantDocumentAccess,
  rawName: string | undefined,
): Promise<ResolvedExactCustomerMatch> {
  const normalized = normalizeCustomerName(rawName ?? "");
  if (!normalized) return { kind: "UNMATCHED" };

  // At most 3 rows from each index is enough to detect 0, 1, or ambiguous (>1).
  const [canonical, aliases] = await Promise.all([
    tenantDb
      .byIndex<Doc<"customers">>("customers", "by_orgId_normalizedName", [
        { field: "normalizedName", value: normalized },
      ])
      .take(3),
    tenantDb
      .byIndex<Doc<"customerAliases">>(
        "customerAliases",
        "by_orgId_normalizedAlias",
        [{ field: "normalizedAlias", value: normalized }],
      )
      .take(3),
  ]);

  const seen = new Map<Id<"customers">, "ACTIVE" | "ARCHIVED">();
  for (const row of canonical) seen.set(row._id, row.status);

  const missingAliasCustomerIds = [
    ...new Set(
      aliases.map((alias) => alias.customerId).filter((id) => !seen.has(id)),
    ),
  ];
  if (missingAliasCustomerIds.length > 0) {
    const docs = await Promise.all(
      missingAliasCustomerIds.map((id) =>
        tenantDb.get<Doc<"customers">>("customers", id),
      ),
    );
    for (const doc of docs) {
      if (doc) seen.set(doc._id, doc.status);
    }
  }

  const classified = classifyExactCustomerMatches(
    [...seen.entries()].map(([customerId, status]) => ({ customerId, status })),
  );
  switch (classified.kind) {
    case "UNMATCHED":
      return { kind: "UNMATCHED" };
    case "MATCHED":
      return {
        kind: "MATCHED",
        customerId: classified.customerId as Id<"customers">,
      };
    case "ARCHIVED":
      return {
        kind: "ARCHIVED",
        customerId: classified.customerId as Id<"customers">,
      };
    case "AMBIGUOUS":
      return {
        kind: "AMBIGUOUS",
        customerIds: classified.customerIds as readonly Id<"customers">[],
      };
  }
}
