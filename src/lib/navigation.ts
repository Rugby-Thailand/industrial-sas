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
  purchaseOrders: "/purchasing/orders",
  inboundBoard: "/inbound",
  purchaseImport: "/purchasing/import",
  customerOrders: "/sales/orders",
  engineeringQueue: "/engineering/designs",
  factoryPackets: "/production/packets",
  receiving: "/receiving",
  quality: "/quality",
  putaway: "/putaway",
  reports: "/reports",
  balances: "/inventory/balances",
  history: "/inventory/history",
  setup: "/setup",
  signIn: "/sign-in",
  handheld: "/handheld",
  handheldLookup: "/handheld/inventory",
  handheldReceive: "/handheld/receive",
  handheldQuality: "/handheld/quality",
  handheldPutaway: "/handheld/putaway",
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
    ]),
  }),
  Object.freeze({
    labelKey: "sectionOrderToShip",
    items: Object.freeze([
      { href: ROUTES.customerOrders, labelKey: "customerOrders" },
      { href: ROUTES.engineeringQueue, labelKey: "engineeringQueue" },
      { href: ROUTES.factoryPackets, labelKey: "factoryPackets" },
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
      { href: ROUTES.reports, labelKey: "reports" },
    ]),
  }),
  Object.freeze({
    labelKey: "sectionOperator",
    items: Object.freeze([{ href: ROUTES.handheld, labelKey: "handheldHome" }]),
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
