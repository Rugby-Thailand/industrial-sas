import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { grantedNavigationPermissions } from "../lib/navigationGrants";
import type { TenantFunctionContext } from "../lib/tenantFunctions";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import {
  DASHBOARD_ACTION_DEFINITIONS,
  OWNER_DASHBOARD_PRESET_VERSION,
  availableDashboardActionIds,
  resolveDashboardActionIds,
  validateDashboardActionSelection,
} from "../model/reporting/dashboardPreferences";

const PAGE_KEY = "OWNER_DASHBOARD" as const;

type PreferenceDocument = Doc<"dashboardPreferences">;
type PreferenceValue = Pick<PreferenceDocument, "quickActionIds" | "updatedAt">;

const actionIdValidator = v.union(
  ...DASHBOARD_ACTION_DEFINITIONS.map(({ id }) => v.literal(id)),
);
const selectionErrorValidator = v.union(
  v.literal("TOO_MANY_ACTIONS"),
  v.literal("UNKNOWN_ACTION"),
  v.literal("DUPLICATE_ACTION"),
  v.literal("ACTION_NOT_AVAILABLE"),
);
const preferenceValidator = v.object({
  pageKey: v.literal(PAGE_KEY),
  presetVersion: v.number(),
  customized: v.boolean(),
  selectedActionIds: v.array(actionIdValidator),
  availableActionIds: v.array(actionIdValidator),
  updatedAt: v.optional(v.number()),
});
const writeResultValidator = v.union(
  v.object({ accepted: v.literal(true), preference: preferenceValidator }),
  v.object({ accepted: v.literal(false), code: selectionErrorValidator }),
);

async function storedPreference(
  ctx: TenantFunctionContext,
): Promise<PreferenceDocument | null> {
  return await ctx.tenantDb
    .byIndex<PreferenceDocument>(
      "dashboardPreferences",
      "by_orgId_membershipId_pageKey",
      [
        { field: "membershipId", value: ctx.tenant.membership._id },
        { field: "pageKey", value: PAGE_KEY },
      ],
    )
    .unique();
}

async function preferencePayload(
  ctx: TenantFunctionContext,
  row: PreferenceValue | null,
) {
  const grants = await grantedNavigationPermissions(ctx);
  return {
    pageKey: PAGE_KEY,
    presetVersion: OWNER_DASHBOARD_PRESET_VERSION,
    customized: row !== null,
    selectedActionIds: resolveDashboardActionIds(row?.quickActionIds, grants),
    availableActionIds: availableDashboardActionIds(grants),
    ...(row === null ? {} : { updatedAt: row.updatedAt }),
  };
}

export const readPreferences = queryWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: preferenceValidator,
  permissionCode: "reporting.dashboard.read",
  target: { table: "dashboardPreferences" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx) =>
    await preferencePayload(ctx, await storedPreference(ctx)),
});

export const updatePreferences = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    actionIds: v.array(v.string()),
  },
  returns: writeResultValidator,
  permissionCode: "reporting.dashboard.read",
  target: { table: "dashboardPreferences" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, { actionIds }) => {
    const grants = await grantedNavigationPermissions(ctx);
    const validation = validateDashboardActionSelection(actionIds, grants);
    if (!validation.ok) {
      return { accepted: false as const, code: validation.code };
    }

    const existing = await storedPreference(ctx);
    const updatedAt = Date.now();
    if (existing === null) {
      await ctx.tenantDb.insert("dashboardPreferences", {
        membershipId: ctx.tenant.membership._id,
        pageKey: PAGE_KEY,
        presetVersion: OWNER_DASHBOARD_PRESET_VERSION,
        quickActionIds: [...validation.value],
        widgetIds: [],
        hiddenWidgetIds: [],
        updatedAt,
      });
    } else {
      await ctx.tenantDb.patch("dashboardPreferences", existing._id, {
        presetVersion: OWNER_DASHBOARD_PRESET_VERSION,
        quickActionIds: [...validation.value],
        updatedAt,
      });
    }

    const row: PreferenceValue = {
      quickActionIds: [...validation.value],
      updatedAt,
    };
    return {
      accepted: true as const,
      preference: await preferencePayload(ctx, row),
    };
  },
});

export const resetPreferences = mutationWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: preferenceValidator,
  permissionCode: "reporting.dashboard.read",
  target: { table: "dashboardPreferences" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx) => {
    const existing = await storedPreference(ctx);
    if (existing !== null) {
      await ctx.tenantDb.delete("dashboardPreferences", existing._id);
    }
    return await preferencePayload(ctx, null);
  },
});
