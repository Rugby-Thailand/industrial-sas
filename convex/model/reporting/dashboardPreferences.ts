import {
  NAVIGATION_PERMISSION,
  type NavigationPermissionCode,
} from "../authorization/navigationPermissions";

export const MAX_DASHBOARD_QUICK_ACTIONS = 6;
export const OWNER_DASHBOARD_PRESET_VERSION = 1;

export const DASHBOARD_ACTION_DEFINITIONS = Object.freeze([
  {
    id: "CUSTOMER_ORDERS",
    requiredPermissions: [NAVIGATION_PERMISSION.customerOrders],
  },
  {
    id: "FULFILLMENT",
    requiredPermissions: [
      NAVIGATION_PERMISSION.fulfillment,
      NAVIGATION_PERMISSION.customerOrders,
    ],
  },
  {
    id: "PRODUCTION_STATUS",
    requiredPermissions: [
      NAVIGATION_PERMISSION.production,
      NAVIGATION_PERMISSION.items,
      NAVIGATION_PERMISSION.locations,
    ],
  },
  {
    id: "INVENTORY_HEALTH",
    requiredPermissions: [NAVIGATION_PERMISSION.balances],
  },
  {
    id: "OPERATIONAL_REPORTS",
    requiredPermissions: [NAVIGATION_PERMISSION.exportReports],
  },
  {
    id: "INTEGRATION_HEALTH",
    requiredPermissions: [NAVIGATION_PERMISSION.integrations],
  },
  {
    id: "RECEIVING",
    requiredPermissions: [NAVIGATION_PERMISSION.receiving],
  },
  {
    id: "QUALITY",
    requiredPermissions: [NAVIGATION_PERMISSION.quality],
  },
  {
    id: "PUTAWAY",
    requiredPermissions: [NAVIGATION_PERMISSION.putaway],
  },
  {
    id: "INVENTORY_HISTORY",
    requiredPermissions: [NAVIGATION_PERMISSION.history],
  },
  {
    id: "STOCK_COUNTS",
    requiredPermissions: [NAVIGATION_PERMISSION.counts],
  },
  {
    id: "ITEM_REGISTER",
    requiredPermissions: [NAVIGATION_PERMISSION.items],
  },
] as const);

export type DashboardActionId =
  (typeof DASHBOARD_ACTION_DEFINITIONS)[number]["id"];

export const OWNER_DASHBOARD_DEFAULT_ACTION_IDS = Object.freeze([
  "CUSTOMER_ORDERS",
  "FULFILLMENT",
  "PRODUCTION_STATUS",
  "INVENTORY_HEALTH",
  "OPERATIONAL_REPORTS",
  "INTEGRATION_HEALTH",
] as const satisfies readonly DashboardActionId[]);

const ACTIONS_BY_ID = new Map(
  DASHBOARD_ACTION_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export const isDashboardActionId = (
  value: string,
): value is DashboardActionId => ACTIONS_BY_ID.has(value as DashboardActionId);

const available = (
  actionId: DashboardActionId,
  grantedPermissions: ReadonlySet<string>,
): boolean => {
  const definition = ACTIONS_BY_ID.get(actionId);
  return (
    definition !== undefined &&
    definition.requiredPermissions.every((permission) =>
      grantedPermissions.has(permission),
    )
  );
};

export function availableDashboardActionIds(
  grantedPermissions: readonly NavigationPermissionCode[],
): DashboardActionId[] {
  const grants = new Set<string>(grantedPermissions);
  return DASHBOARD_ACTION_DEFINITIONS.filter(({ id }) =>
    available(id, grants),
  ).map(({ id }) => id);
}

export function resolveDashboardActionIds(
  savedActionIds: readonly string[] | undefined,
  grantedPermissions: readonly NavigationPermissionCode[],
): DashboardActionId[] {
  const grants = new Set<string>(grantedPermissions);
  const source = savedActionIds ?? OWNER_DASHBOARD_DEFAULT_ACTION_IDS;
  const seen = new Set<DashboardActionId>();
  const resolved: DashboardActionId[] = [];

  for (const value of source) {
    if (!isDashboardActionId(value) || seen.has(value)) continue;
    if (!available(value, grants)) continue;
    seen.add(value);
    resolved.push(value);
    if (resolved.length === MAX_DASHBOARD_QUICK_ACTIONS) break;
  }

  return resolved;
}

export type DashboardSelectionErrorCode =
  | "TOO_MANY_ACTIONS"
  | "UNKNOWN_ACTION"
  | "DUPLICATE_ACTION"
  | "ACTION_NOT_AVAILABLE";

export type DashboardSelectionValidation =
  | { readonly ok: true; readonly value: readonly DashboardActionId[] }
  | { readonly ok: false; readonly code: DashboardSelectionErrorCode };

export function validateDashboardActionSelection(
  actionIds: readonly string[],
  grantedPermissions: readonly NavigationPermissionCode[],
): DashboardSelectionValidation {
  if (actionIds.length > MAX_DASHBOARD_QUICK_ACTIONS) {
    return { ok: false, code: "TOO_MANY_ACTIONS" };
  }

  const grants = new Set<string>(grantedPermissions);
  const seen = new Set<DashboardActionId>();
  const validated: DashboardActionId[] = [];
  for (const value of actionIds) {
    if (!isDashboardActionId(value)) {
      return { ok: false, code: "UNKNOWN_ACTION" };
    }
    if (seen.has(value)) {
      return { ok: false, code: "DUPLICATE_ACTION" };
    }
    if (!available(value, grants)) {
      return { ok: false, code: "ACTION_NOT_AVAILABLE" };
    }
    seen.add(value);
    validated.push(value);
  }
  return { ok: true, value: validated };
}
