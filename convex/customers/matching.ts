import type { Infer } from "convex/values";
import type { TenantFunctionContext } from "../lib/tenantFunctions";
import type { customerLinkArg } from "./validators";
import { canReadCustomers } from "./warehouseScope";
import type { Doc, Id } from "../_generated/dataModel";
import type { writeContextOf } from "../lib/writeEnvelope";
import { appendSearchableAlias } from "./activitySummary";
import { bumpCustomerCatalogueGeneration } from "./catalogueGeneration";
import type { TenantDocumentAccess } from "../lib/tenantDb";
import {
  classifyExactCustomerMatches,
  compactCustomerStem,
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

/** Claim an exact name and update its search projection and audit in the same mutation. */
export async function approveCustomerAlias(
  context: ReturnType<typeof writeContextOf>,
  customer: Doc<"customers">,
  validated: { alias: string; normalizedAlias: string },
  exampleJobScanId?: Id<"finishedGoodsJobScans">,
) {
  const { tenantDb } = context;
  const match = await resolveExactCustomerMatch(
    tenantDb,
    validated.normalizedAlias,
  );
  if (
    match.kind !== "UNMATCHED" &&
    (match.kind === "AMBIGUOUS" || match.customerId !== customer._id)
  ) {
    return { ok: false as const, code: "ALIAS_CONFLICT" as const };
  }
  const existing = await tenantDb
    .byIndex<Doc<"customerAliases">>(
      "customerAliases",
      "by_orgId_customerId_normalizedAlias",
      [
        { field: "customerId", value: customer._id },
        { field: "normalizedAlias", value: validated.normalizedAlias },
      ],
    )
    .unique();
  if (existing)
    return { ok: true as const, created: false, aliasId: existing._id };
  const aliasSearchText = appendSearchableAlias(
    customer,
    validated.normalizedAlias,
  );
  if (aliasSearchText === null)
    return { ok: false as const, code: "ALIAS_CAPACITY" as const };
  const aliasId = await tenantDb.insert("customerAliases", {
    customerId: customer._id,
    ...validated,
    ...(exampleJobScanId ? { exampleJobScanId } : {}),
    approvedAt: context.now,
    approvedByUserId: context.actorUserId,
  });
  await tenantDb.patch("customers", customer._id, { aliasSearchText });
  await tenantDb.insert("auditEvents", {
    occurredAt: context.now,
    actorKind: "USER",
    actorUserId: context.actorUserId,
    action: "customer.alias.add",
    permissionCode: context.permissionCode,
    entityTable: "customerAliases",
    entityId: aliasId,
    outcome: "ALLOWED",
    requestId: context.requestId,
    changes: [{ field: "customerId", to: customer._id }, { field: "alias" }],
  });
  await bumpCustomerCatalogueGeneration(tenantDb);
  return { ok: true as const, created: true, aliasId };
}

export async function resolveExplicitCustomerLink(
  ctx: TenantFunctionContext,
  command: Infer<typeof customerLinkArg> | undefined,
  before: Pick<
    Doc<"finishedGoodsJobScans">,
    "customerId" | "customerLinkSource"
  > | null,
) {
  if (!command || command.action === "KEEP") {
    return {
      ok: true as const,
      customerId: before?.customerId,
      customerLinkSource: before?.customerLinkSource,
    };
  }
  if (!(await canReadCustomers(ctx)))
    return { ok: false as const, code: "ACCESS_DENIED" };
  if (command.action === "CLEAR")
    return {
      ok: true as const,
      customerId: undefined,
      customerLinkSource: "UNLINKED" as const,
    };
  const customer = await ctx.tenantDb.get<Doc<"customers">>(
    "customers",
    command.customerId,
  );
  if (!customer) return { ok: false as const, code: "NOT_FOUND" };
  if (customer.status === "ARCHIVED" && before?.customerId !== customer._id)
    return { ok: false as const, code: "CUSTOMER_ARCHIVED" };
  return {
    ok: true as const,
    customerId: customer._id,
    customerLinkSource: "MANUAL" as const,
  };
}

type MatchKind = "AMBIGUOUS" | "ARCHIVED" | "SIMILAR" | "NONE";
const ACTIVE_SAMPLE_SIZE = 100;
const DISPLAY_LIMIT = 5;

/** One bounded active sample and one doc cache per query, shared across names. */
export function createReviewCandidateReader(db: TenantDocumentAccess) {
  const customers = new Map<
    Id<"customers">,
    Promise<Doc<"customers"> | null>
  >();
  function readCustomer(id: Id<"customers">) {
    let doc = customers.get(id);
    if (!doc) {
      doc = db.get<Doc<"customers">>("customers", id);
      customers.set(id, doc);
    }
    return doc;
  }

  async function loadSample() {
    const active = await db
      .byIndex<Doc<"customers">>(
        "customers",
        "by_orgId_status_normalizedName",
        [{ field: "status", value: "ACTIVE" }],
      )
      .take(ACTIVE_SAMPLE_SIZE);
    return active.map((customer) => {
      customers.set(customer._id, Promise.resolve(customer));
      const stems = [customer.name, customer.legalNameTh, customer.legalNameEn]
        .map((value) => compactCustomerStem(value ?? ""))
        .filter((stem) => stem.length >= 2);
      return { customer, stems };
    });
  }
  let sample: ReturnType<typeof loadSample> | undefined;

  return async function candidatesForName(
    name: string,
  ): Promise<{ matchKind: MatchKind; candidates: Doc<"customers">[] }> {
    const exact = await resolveExactCustomerMatch(db, name);
    if (exact.kind === "AMBIGUOUS") {
      const docs = await Promise.all(exact.customerIds.map(readCustomer));
      return {
        matchKind: "AMBIGUOUS",
        candidates: docs
          .filter((doc): doc is Doc<"customers"> => doc?.status === "ACTIVE")
          .slice(0, DISPLAY_LIMIT),
      };
    }
    if (exact.kind !== "UNMATCHED") {
      const doc = await readCustomer(exact.customerId);
      return {
        matchKind: exact.kind === "ARCHIVED" ? "ARCHIVED" : "SIMILAR",
        candidates: doc ? [doc] : [],
      };
    }
    const stem = compactCustomerStem(name);
    if (stem.length < 2) return { matchKind: "NONE", candidates: [] };
    const entries = await (sample ??= loadSample());
    const direct = entries.filter((entry) => entry.stems.includes(stem));
    const similar = direct
      .slice(0, DISPLAY_LIMIT)
      .map((entry) => entry.customer);
    if (similar.length < 3) {
      for (const { customer, stems } of entries) {
        if (
          !stems.includes(stem) &&
          stems.some((other) => other.includes(stem) || stem.includes(other))
        ) {
          similar.push(customer);
          if (similar.length === 3) break;
        }
      }
    }
    return {
      matchKind:
        similar.length > 1 ? "AMBIGUOUS" : similar.length ? "SIMILAR" : "NONE",
      candidates: similar,
    };
  };
}
