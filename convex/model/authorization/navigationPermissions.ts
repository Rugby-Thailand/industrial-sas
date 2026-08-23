/**
 * The bounded permission vocabulary used to decide which application routes are
 * useful to the current membership.
 *
 * This is presentation guidance, not authorization. Every destination still
 * enforces its own permission through the tenant function wrappers. Keeping the
 * vocabulary in a pure shared module lets the server return only these known
 * grants and lets the browser map them to routes without duplicating strings.
 */
export const NAVIGATION_PERMISSION = Object.freeze({
  dashboard: "reporting.dashboard.read",
  items: "masterData.item.read",
  suppliers: "masterData.supplier.read",
  storageClasses: "masterData.storageClass.read",
  labelTemplates: "label.template.read",
  locations: "masterData.location.read",
  storageLayouts: "masterData.storageLayout.read",
  customerOrders: "sales.order.read",
  engineering: "engineering.request.read",
  factoryPackets: "production.packet.read",
  production: "production.order.read",
  fulfillment: "fulfillment.order.read",
  shipments: "fulfillment.shipment.read",
  transport: "fulfillment.transport.read",
  transfers: "transfer.request.read",
  purchaseOrders: "purchasing.po.read",
  purchaseImport: "purchasing.po.import",
  receiving: "receiving.receipt.read",
  quality: "quality.inspection.read",
  putaway: "putaway.task.read",
  balances: "inventory.balance.read",
  history: "inventory.history.read",
  openingStock: "inventory.opening.read",
  counts: "inventory.count.read",
  exportReports: "reporting.export.read",
  devices: "admin.device.read",
  attendanceSelf: "hr.self.read",
  attendanceTeam: "hr.team.read",
  integrations: "integration.health.read",
  operatorWork: "work.task.read",
  countExecute: "inventory.count.execute",
  pickExecute: "fulfillment.pick.execute",
  transportLoad: "fulfillment.transport.load",
  transportDeliver: "fulfillment.transport.deliver",
  transferDispatch: "transfer.dispatch",
  transferReceive: "transfer.receive",
  productionOperate: "production.operation.report",
} as const);

export type NavigationPermissionCode =
  (typeof NAVIGATION_PERMISSION)[keyof typeof NAVIGATION_PERMISSION];

export const NAVIGATION_PERMISSION_CODES: readonly NavigationPermissionCode[] =
  Object.freeze([...new Set(Object.values(NAVIGATION_PERMISSION))]);
