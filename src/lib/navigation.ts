import { NAVIGATION_PERMISSION } from "../../convex/model/authorization/navigationPermissions";

export interface NavigationItem {
  readonly href: string;

  readonly labelKey: string;

  readonly permissionCodes: readonly string[];
  readonly permissionMode?: "ALL" | "ANY";
}

export interface NavigationSection {
  readonly labelKey: string;
  readonly items: readonly NavigationItem[];
}

export const ROUTES = Object.freeze({
  dashboard: "/dashboard",
  items: "/master-data/items",
  suppliers: "/master-data/suppliers",
  storageClasses: "/master-data/storage-classes",
  labelTemplates: "/master-data/label-templates",
  locations: "/master-data/locations",
  storageLayouts: "/master-data/storage-layouts",
  purchaseOrders: "/purchasing/orders",
  inboundBoard: "/inbound",
  purchaseImport: "/purchasing/import",
  customerOrders: "/sales/orders",
  engineeringQueue: "/engineering/designs",
  factoryPackets: "/production/packets",
  productionOrders: "/production/orders",
  fulfillment: "/fulfillment",
  transport: "/transport",
  transfers: "/transfers",
  receiving: "/receiving",
  quality: "/quality",
  putaway: "/putaway",
  reports: "/reports",
  devices: "/devices",
  hr: "/hr",
  integrations: "/integrations",
  balances: "/inventory/balances",
  history: "/inventory/history",
  openingStock: "/inventory/opening-stock",
  countPlans: "/inventory/counts",
  setup: "/setup",
  signIn: "/sign-in",
  handheld: "/handheld",
  handheldLookup: "/handheld/inventory",
  handheldReceive: "/handheld/receive",
  handheldQuality: "/handheld/quality",
  handheldPutaway: "/handheld/putaway",
  handheldWork: "/handheld/work",
  handheldCount: "/handheld/count",
  handheldPick: "/handheld/pick",
  handheldLoad: "/handheld/load",
  handheldDelivery: "/handheld/delivery",
  handheldTransfers: "/handheld/transfers",
  handheldProduction: "/handheld/production",
  handheldAttendance: "/handheld/attendance",
});

export const DESKTOP_NAVIGATION: readonly NavigationSection[] = Object.freeze([
  Object.freeze({
    labelKey: "sectionOverview",
    items: Object.freeze([
      {
        href: ROUTES.dashboard,
        labelKey: "dashboard",
        permissionCodes: [NAVIGATION_PERMISSION.dashboard],
      },
    ]),
  }),
  Object.freeze({
    labelKey: "sectionMasterData",
    items: Object.freeze([
      {
        href: ROUTES.items,
        labelKey: "items",
        permissionCodes: [NAVIGATION_PERMISSION.items],
      },
      {
        href: ROUTES.suppliers,
        labelKey: "suppliers",
        permissionCodes: [NAVIGATION_PERMISSION.suppliers],
      },
      {
        href: ROUTES.storageClasses,
        labelKey: "storageClasses",
        permissionCodes: [NAVIGATION_PERMISSION.storageClasses],
      },
      {
        href: ROUTES.labelTemplates,
        labelKey: "labelTemplates",
        permissionCodes: [NAVIGATION_PERMISSION.labelTemplates],
      },
      {
        href: ROUTES.locations,
        labelKey: "locations",
        permissionCodes: [NAVIGATION_PERMISSION.locations],
      },
      {
        href: ROUTES.storageLayouts,
        labelKey: "storageLayouts",
        permissionCodes: [NAVIGATION_PERMISSION.storageLayouts],
      },
    ]),
  }),
  Object.freeze({
    labelKey: "sectionOrderToShip",
    items: Object.freeze([
      {
        href: ROUTES.customerOrders,
        labelKey: "customerOrders",
        permissionCodes: [NAVIGATION_PERMISSION.customerOrders],
      },
      {
        href: ROUTES.engineeringQueue,
        labelKey: "engineeringQueue",
        permissionCodes: [NAVIGATION_PERMISSION.engineering],
      },
      {
        href: ROUTES.factoryPackets,
        labelKey: "factoryPackets",
        permissionCodes: [NAVIGATION_PERMISSION.factoryPackets],
      },
      {
        href: ROUTES.productionOrders,
        labelKey: "productionOrders",
        permissionCodes: [
          NAVIGATION_PERMISSION.production,
          NAVIGATION_PERMISSION.items,
          NAVIGATION_PERMISSION.locations,
        ],
      },
      {
        href: ROUTES.fulfillment,
        labelKey: "fulfillment",
        permissionCodes: [
          NAVIGATION_PERMISSION.fulfillment,
          NAVIGATION_PERMISSION.customerOrders,
        ],
      },
      {
        href: ROUTES.transport,
        labelKey: "transport",
        permissionCodes: [
          NAVIGATION_PERMISSION.transport,
          NAVIGATION_PERMISSION.shipments,
        ],
      },
      {
        href: ROUTES.transfers,
        labelKey: "transfers",
        permissionCodes: [
          NAVIGATION_PERMISSION.transfers,
          NAVIGATION_PERMISSION.items,
        ],
      },
    ]),
  }),
  Object.freeze({
    labelKey: "sectionInbound",
    items: Object.freeze([
      {
        href: ROUTES.purchaseOrders,
        labelKey: "purchaseOrders",
        permissionCodes: [NAVIGATION_PERMISSION.purchaseOrders],
      },
      {
        href: ROUTES.inboundBoard,
        labelKey: "inboundBoard",
        permissionCodes: [
          NAVIGATION_PERMISSION.purchaseOrders,
          NAVIGATION_PERMISSION.receiving,
          NAVIGATION_PERMISSION.quality,
          NAVIGATION_PERMISSION.putaway,
        ],
        permissionMode: "ANY" as const,
      },
      {
        href: ROUTES.purchaseImport,
        labelKey: "purchaseImport",
        permissionCodes: [NAVIGATION_PERMISSION.purchaseImport],
      },
      {
        href: ROUTES.receiving,
        labelKey: "receiving",
        permissionCodes: [NAVIGATION_PERMISSION.receiving],
      },
      {
        href: ROUTES.quality,
        labelKey: "quality",
        permissionCodes: [NAVIGATION_PERMISSION.quality],
      },
      {
        href: ROUTES.putaway,
        labelKey: "putaway",
        permissionCodes: [NAVIGATION_PERMISSION.putaway],
      },
    ]),
  }),
  Object.freeze({
    labelKey: "sectionInventory",
    items: Object.freeze([
      {
        href: ROUTES.balances,
        labelKey: "balances",
        permissionCodes: [NAVIGATION_PERMISSION.balances],
      },
      {
        href: ROUTES.history,
        labelKey: "history",
        permissionCodes: [NAVIGATION_PERMISSION.history],
      },
      {
        href: ROUTES.openingStock,
        labelKey: "openingStock",
        permissionCodes: [NAVIGATION_PERMISSION.openingStock],
      },
      {
        href: ROUTES.countPlans,
        labelKey: "countPlans",
        permissionCodes: [NAVIGATION_PERMISSION.counts],
      },
      {
        href: ROUTES.reports,
        labelKey: "reports",
        permissionCodes: [
          NAVIGATION_PERMISSION.dashboard,
          NAVIGATION_PERMISSION.balances,
          NAVIGATION_PERMISSION.history,
          NAVIGATION_PERMISSION.exportReports,
        ],
        permissionMode: "ANY" as const,
      },
    ]),
  }),
  Object.freeze({
    labelKey: "sectionOperator",
    items: Object.freeze([
      {
        href: ROUTES.hr,
        labelKey: "hr",
        permissionCodes: [
          NAVIGATION_PERMISSION.attendanceSelf,
          NAVIGATION_PERMISSION.attendanceTeam,
        ],
        permissionMode: "ANY" as const,
      },
      {
        href: ROUTES.integrations,
        labelKey: "integrations",
        permissionCodes: [NAVIGATION_PERMISSION.integrations],
      },
      {
        href: ROUTES.handheld,
        labelKey: "handheldHome",
        permissionCodes: [
          NAVIGATION_PERMISSION.operatorWork,
          NAVIGATION_PERMISSION.balances,
          NAVIGATION_PERMISSION.receiving,
          NAVIGATION_PERMISSION.quality,
          NAVIGATION_PERMISSION.putaway,
          NAVIGATION_PERMISSION.countExecute,
          NAVIGATION_PERMISSION.pickExecute,
          NAVIGATION_PERMISSION.transportLoad,
          NAVIGATION_PERMISSION.transportDeliver,
          NAVIGATION_PERMISSION.transferDispatch,
          NAVIGATION_PERMISSION.transferReceive,
          NAVIGATION_PERMISSION.productionOperate,
          NAVIGATION_PERMISSION.attendanceSelf,
        ],
        permissionMode: "ANY" as const,
      },

      {
        href: ROUTES.devices,
        labelKey: "devices",
        permissionCodes: [NAVIGATION_PERMISSION.devices],
      },
    ]),
  }),
]);

export const itemDetailPath = (itemId: string): string =>
  `${ROUTES.items}/${encodeURIComponent(itemId)}`;

export const storageBuildingPath = (buildingId: string): string =>
  `${ROUTES.storageLayouts}/${encodeURIComponent(buildingId)}`;

export const storageFloorPath = (
  buildingId: string,
  floorNumber: number,
): string => `${storageBuildingPath(buildingId)}/floors/${floorNumber}`;

export const storageReviewPath = (buildingId: string): string =>
  `${storageBuildingPath(buildingId)}/review`;

export const purchaseOrderPath = (purchaseOrderId: string): string =>
  `${ROUTES.purchaseOrders}/${encodeURIComponent(purchaseOrderId)}`;

export const receiptPath = (receiptId: string): string =>
  `${ROUTES.receiving}/${encodeURIComponent(receiptId)}`;

export interface HandheldTask {
  readonly labelKey: string;

  readonly href?: string;
  readonly available: boolean;
  readonly permissionCodes?: readonly string[];
}

export const HANDHELD_TASKS: readonly HandheldTask[] = Object.freeze([
  Object.freeze({
    labelKey: "taskWork",
    href: ROUTES.handheldWork,
    available: true,
    permissionCodes: [NAVIGATION_PERMISSION.operatorWork],
  }),
  Object.freeze({
    labelKey: "taskLookup",
    href: ROUTES.handheldLookup,
    available: true,
    permissionCodes: [NAVIGATION_PERMISSION.balances],
  }),
  Object.freeze({
    labelKey: "taskReceive",
    href: ROUTES.handheldReceive,
    available: true,
    permissionCodes: [NAVIGATION_PERMISSION.receiving],
  }),
  Object.freeze({
    labelKey: "taskQuality",
    href: ROUTES.handheldQuality,
    available: true,
    permissionCodes: [NAVIGATION_PERMISSION.quality],
  }),
  Object.freeze({
    labelKey: "taskPutaway",
    href: ROUTES.handheldPutaway,
    available: true,
    permissionCodes: [NAVIGATION_PERMISSION.putaway],
  }),
  Object.freeze({
    labelKey: "taskCount",
    href: ROUTES.handheldCount,
    available: true,
    permissionCodes: [NAVIGATION_PERMISSION.countExecute],
  }),
  Object.freeze({
    labelKey: "taskPick",
    href: ROUTES.handheldPick,
    available: true,
    permissionCodes: [NAVIGATION_PERMISSION.pickExecute],
  }),
  Object.freeze({
    labelKey: "taskLoad",
    href: ROUTES.handheldLoad,
    available: true,
    permissionCodes: [NAVIGATION_PERMISSION.transportLoad],
  }),
  Object.freeze({
    labelKey: "taskDelivery",
    href: ROUTES.handheldDelivery,
    available: true,
    permissionCodes: [NAVIGATION_PERMISSION.transportDeliver],
  }),
  Object.freeze({
    labelKey: "taskTransfer",
    href: ROUTES.handheldTransfers,
    available: true,
    permissionCodes: [
      NAVIGATION_PERMISSION.transferDispatch,
      NAVIGATION_PERMISSION.transferReceive,
    ],
  }),
  Object.freeze({
    labelKey: "taskAttendance",
    href: ROUTES.handheldAttendance,
    available: true,
    permissionCodes: [NAVIGATION_PERMISSION.attendanceSelf],
  }),
  Object.freeze({
    labelKey: "taskProduction",
    href: ROUTES.handheldProduction,
    available: true,
    permissionCodes: [NAVIGATION_PERMISSION.productionOperate],
  }),

  Object.freeze({ labelKey: "taskPallet", available: false }),
]);

export function isActivePath(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}

export function hasNavigationPermission(
  required: readonly string[] | undefined,
  granted: readonly string[],
  mode: "ALL" | "ANY" = "ALL",
): boolean {
  return matchesPermissionSet(required, new Set(granted), mode);
}

function matchesPermissionSet(
  required: readonly string[] | undefined,
  granted: ReadonlySet<string>,
  mode: "ALL" | "ANY",
): boolean {
  if (required === undefined || required.length === 0) return true;
  return mode === "ANY"
    ? required.some((permission) => granted.has(permission))
    : required.every((permission) => granted.has(permission));
}

export function visibleDesktopNavigation(
  granted: readonly string[],
): readonly NavigationSection[] {
  const permissionSet = new Set(granted);
  return DESKTOP_NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter((item) =>
      matchesPermissionSet(
        item.permissionCodes,
        permissionSet,
        item.permissionMode ?? "ALL",
      ),
    ),
  })).filter((section) => section.items.length > 0);
}

export function visibleHandheldTasks(
  granted: readonly string[],
): readonly HandheldTask[] {
  const permissionSet = new Set(granted);
  return HANDHELD_TASKS.filter(
    (task) =>
      !task.available ||
      matchesPermissionSet(task.permissionCodes, permissionSet, "ALL"),
  );
}
