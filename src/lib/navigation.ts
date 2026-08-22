/**
 * The navigation tree, as data.
 *
 * One declaration serves the desktop sidebar, the handheld task launcher, and
 * the tests that assert every link resolves. The UX plan (§1) requires both
 * shells to share "the same routes, permissions, terminology, formatters, status
 * model, and navigation data" — sharing the *data* is what makes that checkable
 * rather than aspirational.
 *
 * Paths are locale-free. `@/i18n/navigation`'s `Link` adds the active locale, so
 * a path written here is never wrong for one language and right for another.
 *
 * `available: false` is a first-class state rather than an omission. The handheld
 * launcher lists Receive, QC, Pallet, and Putaway as *not built yet*, because an
 * operator trained on the inbound slice who finds four of six tasks missing
 * needs to know the difference between "you may not" and "it does not exist".
 * `INV-0006-*` covers the first; only this list covers the second.
 */

export interface NavigationItem {
  readonly href: string;
  /** Key within the `Navigation` catalogue namespace. */
  readonly labelKey: string;
}

export interface NavigationSection {
  /** Key within the `Navigation` catalogue namespace. */
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
    items: Object.freeze([{ href: ROUTES.dashboard, labelKey: "dashboard" }]),
  }),
  Object.freeze({
    labelKey: "sectionMasterData",
    items: Object.freeze([
      { href: ROUTES.items, labelKey: "items" },
      { href: ROUTES.suppliers, labelKey: "suppliers" },
      { href: ROUTES.storageClasses, labelKey: "storageClasses" },
      { href: ROUTES.labelTemplates, labelKey: "labelTemplates" },
      { href: ROUTES.locations, labelKey: "locations" },
      { href: ROUTES.storageLayouts, labelKey: "storageLayouts" },
    ]),
  }),
  Object.freeze({
    labelKey: "sectionOrderToShip",
    items: Object.freeze([
      { href: ROUTES.customerOrders, labelKey: "customerOrders" },
      { href: ROUTES.engineeringQueue, labelKey: "engineeringQueue" },
      { href: ROUTES.factoryPackets, labelKey: "factoryPackets" },
      { href: ROUTES.fulfillment, labelKey: "fulfillment" },
      { href: ROUTES.transport, labelKey: "transport" },
      { href: ROUTES.transfers, labelKey: "transfers" },
    ]),
  }),
  Object.freeze({
    labelKey: "sectionInbound",
    items: Object.freeze([
      { href: ROUTES.purchaseOrders, labelKey: "purchaseOrders" },
      { href: ROUTES.inboundBoard, labelKey: "inboundBoard" },
      { href: ROUTES.purchaseImport, labelKey: "purchaseImport" },
      { href: ROUTES.receiving, labelKey: "receiving" },
      { href: ROUTES.quality, labelKey: "quality" },
      { href: ROUTES.putaway, labelKey: "putaway" },
    ]),
  }),
  Object.freeze({
    labelKey: "sectionInventory",
    items: Object.freeze([
      { href: ROUTES.balances, labelKey: "balances" },
      { href: ROUTES.history, labelKey: "history" },
      { href: ROUTES.openingStock, labelKey: "openingStock" },
      { href: ROUTES.countPlans, labelKey: "countPlans" },
      { href: ROUTES.reports, labelKey: "reports" },
    ]),
  }),
  Object.freeze({
    labelKey: "sectionOperator",
    items: Object.freeze([
      { href: ROUTES.hr, labelKey: "hr" },
      { href: ROUTES.integrations, labelKey: "integrations" },
      { href: ROUTES.handheld, labelKey: "handheldHome" },
      /*
       * The registry is administration rather than an operator task, and it
       * sits here because it is *about* the handhelds: an administrator opens
       * it holding a scanner that has stopped checking in.
       */
      { href: ROUTES.devices, labelKey: "devices" },
    ]),
  }),
]);

/**
 * The maintenance screen for one item.
 *
 * A function rather than a `ROUTES` entry because it takes an identifier, and a
 * template string in `ROUTES` would be a route no test could resolve. The item's
 * own barcodes, alternate units, and lots all live here, which is why the items
 * list links to it rather than expanding a row.
 */
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

/** One purchase order, with its lines and its receipts. */
export const purchaseOrderPath = (purchaseOrderId: string): string =>
  `${ROUTES.purchaseOrders}/${encodeURIComponent(purchaseOrderId)}`;

/** One receipt, with its lines, its pallet build, and its label evidence. */
export const receiptPath = (receiptId: string): string =>
  `${ROUTES.receiving}/${encodeURIComponent(receiptId)}`;

/** One entry on the handheld task launcher. */
export interface HandheldTask {
  /** Key within the `Handheld` catalogue namespace. */
  readonly labelKey: string;
  /** Absent when the task is not built. */
  readonly href?: string;
  readonly available: boolean;
}

export const HANDHELD_TASKS: readonly HandheldTask[] = Object.freeze([
  /*
   * First, deliberately. An operator picking the handheld up is in the middle
   * of something; "what am I holding" is the question the launcher should
   * answer before it offers a new task (`FF-P1-01`).
   */
  Object.freeze({
    labelKey: "taskWork",
    href: ROUTES.handheldWork,
    available: true,
  }),
  Object.freeze({
    labelKey: "taskLookup",
    href: ROUTES.handheldLookup,
    available: true,
  }),
  Object.freeze({
    labelKey: "taskReceive",
    href: ROUTES.handheldReceive,
    available: true,
  }),
  Object.freeze({
    labelKey: "taskQuality",
    href: ROUTES.handheldQuality,
    available: true,
  }),
  Object.freeze({
    labelKey: "taskPutaway",
    href: ROUTES.handheldPutaway,
    available: true,
  }),
  Object.freeze({
    labelKey: "taskCount",
    href: ROUTES.handheldCount,
    available: true,
  }),
  Object.freeze({
    labelKey: "taskPick",
    href: ROUTES.handheldPick,
    available: true,
  }),
  Object.freeze({
    labelKey: "taskLoad",
    href: ROUTES.handheldLoad,
    available: true,
  }),
  Object.freeze({
    labelKey: "taskDelivery",
    href: ROUTES.handheldDelivery,
    available: true,
  }),
  Object.freeze({
    labelKey: "taskTransfer",
    href: ROUTES.handheldTransfers,
    available: true,
  }),
  Object.freeze({
    labelKey: "taskAttendance",
    href: ROUTES.handheldAttendance,
    available: true,
  }),
  Object.freeze({
    labelKey: "taskProduction",
    href: ROUTES.handheldProduction,
    available: true,
  }),
  /*
   * Pallet building is not a standalone handheld task: a pallet is built from
   * the lines of a receipt, so the control lives inside the receiving flow. It
   * stays listed and marked unavailable rather than being removed, because an
   * operator trained on "build pallet" needs to find out where it went.
   */
  Object.freeze({ labelKey: "taskPallet", available: false }),
]);

/**
 * Whether a navigation entry describes the current page.
 *
 * Prefix matching with a boundary check, so `/inventory/history` marks
 * `/inventory/history` active and `/inventory/historical` — a route that does not
 * exist today and might tomorrow — does not. Exact matching alone would leave a
 * detail page with no highlighted parent; unguarded `startsWith` highlights the
 * wrong entry the first time two routes share a prefix.
 */
export function isActivePath(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}
