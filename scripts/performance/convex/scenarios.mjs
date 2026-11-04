// Screen-grouped scenarios. Each query scenario mirrors the arguments the
// client sends for that screen; `settle` repeats scanCursor continuations the
// way useCatalogueSync/useHrPagedQuery do, and reports the summed cost.
import { cliData } from "./lib.mjs";

const blankRange = { min: "", max: "" };
const catalogueFilters = {
  record: "",
  unit: "",
  quantity: blankRange,
  formats: [],
  progress: [],
  statuses: [],
  lot: "",
  measurement: "",
  length: blankRange,
  width: blankRange,
  height: blankRange,
  sort: "",
};

const countBy = (rows, key) => {
  const counts = new Map();
  for (const row of rows) counts.set(row[key], (counts.get(row[key]) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

export function discover(fixture) {
  const warehouseId = fixture.warehouseId;
  const pallets = cliData("finishedGoodsPallets", 8000).filter(
    (row) => row.warehouseId === warehouseId,
  );
  const products = cliData("finishedGoodsProducts", 2000).filter(
    (row) => row.warehouseId === warehouseId,
  );
  const batches = cliData("finishedGoodsBatches", 2000);
  const buildings = cliData("storageBuildings", 500).filter(
    (row) => row.warehouseId === warehouseId,
  );
  const zones = cliData("storageZones", 8000).filter(
    (row) => row.warehouseId === warehouseId,
  );
  const jobScans = cliData("finishedGoodsJobScans", 50);
  const employees = cliData("hrEmployees", 2000);
  const periods = cliData("hrPeriods", 500);
  const versions = cliData("hrPeriodVersions", 500);

  const busiestProductId =
    countBy(pallets, "productId")[0]?.[0] ?? products[0]._id;
  const storedPallet = pallets.find((row) => row.status === "STORED");
  const reservedPallet = pallets.find((row) => row.status === "RESERVED");
  const awaitingPallet =
    pallets.find((row) => row.status === "AWAITING_PLACEMENT") ??
    pallets.find(
      (row) => !["STORED", "RESERVED", "RETIRED"].includes(row.status),
    );
  const active = new Set(
    buildings.filter((row) => row.status === "ACTIVE").map((row) => row._id),
  );
  const zoneBuilding = countBy(
    zones.filter((row) => active.has(row.buildingId)),
    "buildingId",
  )[0]?.[0];
  const activeBuilding =
    buildings.find((row) => row._id === zoneBuilding) ??
    buildings.find((row) => row.status === "ACTIVE");
  const zone = zones.find(
    (row) => row.buildingId === activeBuilding._id && row.status === "ACTIVE",
  );
  const employee =
    employees.find((row) => row.status === "ACTIVE") ?? employees[0];
  const closedVersion =
    versions.find((row) => row.status === "CLOSED") ?? versions[0];
  return {
    warehouseId,
    productId: busiestProductId,
    batchId:
      batches.find((row) => row.productId === busiestProductId)?._id ??
      batches[0]?._id,
    storedPalletId: storedPallet?._id,
    reservedPalletId: reservedPallet?._id,
    awaitingPalletId: awaitingPallet?._id,
    storedPalletCode: storedPallet?.code,
    // A second awaiting pallet: measurement edits leave fan-out's reserve target alone.
    measurablePalletId: pallets.find(
      (row) =>
        row.status === "AWAITING_PLACEMENT" &&
        row._id !== awaitingPallet?._id &&
        Number.isInteger(row.quantity),
    )?._id,
    buildingId: activeBuilding._id,
    zoneId: zone?._id,
    locationId: zone?.locationId,
    zoneCode: zone?.code,
    jobScanId: jobScans[0]?._id,
    employeeId: employee?._id,
    periodId: fixture.hrProfile?.periodId ?? periods[0]?._id,
    versionId: fixture.hrProfile?.closedVersionId ?? closedVersion?._id,
    today: fixture.hrProfile?.today ?? new Date().toISOString().slice(0, 10),
    counts: {
      pallets: pallets.length,
      products: products.length,
      zones: zones.length,
      buildings: buildings.length,
      jobScans: cliData("finishedGoodsJobScans", 8000).length,
      employees: employees.length,
    },
  };
}

export function queryScenarios(ids) {
  const w = { warehouseId: ids.warehouseId };
  const month = ids.today.slice(0, 7);
  const monthStart = `${month}-01`;
  const q = (screen, fn, args, options = {}) => ({
    screen,
    fn,
    args,
    ...options,
  });
  return [
    // App shell: mounted on every authenticated page.
    q("shell", "workspace/current:readCurrent", {}),
    q("shell", "hr/access:display", {}),
    q("shell", "aiUsage/reports:access", {}),
    // Finished goods catalogue.
    q("fg-catalogue", "finishedGoods/catalogue:summary", w, { settle: true }),
    q(
      "fg-catalogue",
      "finishedGoods/catalogue:page",
      {
        ...w,
        pageSize: 50,
        tab: "products",
        search: "",
        filters: catalogueFilters,
        locale: "en",
      },
      { settle: true, label: "products tab" },
    ),
    q(
      "fg-catalogue",
      "finishedGoods/catalogue:page",
      {
        ...w,
        pageSize: 50,
        tab: "pallets",
        search: "",
        filters: catalogueFilters,
        locale: "en",
      },
      { settle: true, label: "pallets tab" },
    ),
    q(
      "fg-catalogue",
      "finishedGoods/catalogue:page",
      {
        ...w,
        pageSize: 50,
        tab: "pallets",
        search: "DEMO",
        filters: catalogueFilters,
        locale: "th",
      },
      { settle: true, label: "pallets search" },
    ),
    // Product detail.
    q("fg-product", "finishedGoods/workflow:getProduct", {
      ...w,
      productId: ids.productId,
    }),
    q("fg-product", "finishedGoods/catalogue:productSummary", {
      ...w,
      productId: ids.productId,
    }),
    q(
      "fg-product",
      "finishedGoods/batches:pageProductBatches",
      { ...w, productId: ids.productId, pageSize: 20 },
      { settle: true },
    ),
    q(
      "fg-product",
      "finishedGoods/batches:pageLegacyUnits",
      { ...w, productId: ids.productId, pageSize: 20 },
      { settle: true },
    ),
    q("fg-product", "finishedGoods/batches:getBatch", {
      ...w,
      batchId: ids.batchId,
    }),
    // Pallet detail / placement.
    q("fg-pallet", "finishedGoods/workflow:getPallet", {
      ...w,
      palletId: ids.storedPalletId,
      includeMoveHistory: true,
    }),
    q(
      "fg-pallet",
      "finishedGoods/history:palletMoveHistory",
      { ...w, palletId: ids.storedPalletId },
      { settle: true },
    ),
    q("fg-pallet", "finishedGoods/workflow:recommend", {
      ...w,
      palletId: ids.awaitingPalletId ?? ids.reservedPalletId,
    }),
    q("fg-pallet", "finishedGoods/workflow:recommendMove", {
      ...w,
      palletId: ids.storedPalletId,
    }),
    q(
      "fg-pallet",
      "finishedGoods/workflow:stackChoices",
      { ...w, palletId: ids.awaitingPalletId ?? ids.reservedPalletId },
      { settle: true },
    ),
    // Legacy full-warehouse endpoint: exported, but no live client subscription.
    q("fg-pallet", "finishedGoods/workflow:list", w, { legacy: true }),
    // Job-ticket scanning.
    q(
      "job-scan",
      "finishedGoods/jobScans:listJobScans",
      { ...w, filter: "ALL", pageSize: 50, progressive: true },
      { settle: true },
    ),
    q(
      "job-scan",
      "finishedGoods/jobScans:listJobScans",
      { ...w, filter: "UNMAPPED", pageSize: 50, progressive: true },
      { settle: true, label: "unmapped" },
    ),
    q(
      "job-scan",
      "finishedGoods/jobScans:listJobScans",
      {
        ...w,
        filter: "ALL",
        search: "FO6907",
        pageSize: 50,
        progressive: true,
      },
      { settle: true, label: "search" },
    ),
    q("job-scan", "finishedGoods/jobScanLocations:options", w),
    q("job-scan", "finishedGoods/jobScanLocations:buildingOptions", w, {
      settle: true,
    }),
    q(
      "job-scan",
      "finishedGoods/jobScanLocations:page",
      { ...w, pageSize: 50 },
      { settle: true },
    ),
    q(
      "job-scan",
      "finishedGoods/jobScanLocations:searchPage",
      { ...w, text: "R0", pageSize: 20 },
      { settle: true },
    ),
    q("job-scan", "finishedGoods/jobScanLocations:resolve", {
      ...w,
      code: ids.zoneCode,
    }),
    q("job-scan", "finishedGoods/scanning:resolveLocationCode", {
      ...w,
      code: ids.zoneCode,
    }),
    q("job-scan", "finishedGoods/scanning:resolvePackageCode", {
      ...w,
      code: ids.storedPalletCode ?? "X",
    }),
    // Storage layouts.
    q(
      "storage",
      "storageLayouts/catalogue:listStorageBuildingsPage",
      { ...w, pageSize: 20 },
      { settle: true },
    ),
    q(
      "storage",
      "storageLayouts/catalogue:getStorageBuilding",
      { ...w, buildingId: ids.buildingId },
      { legacy: true },
    ),
    q("storage", "storageLayouts/catalogue:getStorageBuildingLayout", {
      ...w,
      buildingId: ids.buildingId,
    }),
    q("storage", "storageLayouts/catalogue:getStorageBuildingInventory", {
      ...w,
      buildingId: ids.buildingId,
    }),
    q("storage", "storageLayouts/catalogue:buildingOccupancy", {
      ...w,
      buildingId: ids.buildingId,
    }),
    q("storage", "storageLayouts/catalogue:buildingStatusControl", {
      ...w,
      buildingId: ids.buildingId,
    }),
    q(
      "storage",
      "storageLayouts/catalogue:getStorageLocationMap",
      { ...w, locationId: ids.locationId },
      { legacy: true },
    ),
    q(
      "storage",
      "storageLayouts/locationCatalogue:page",
      { ...w, pageSize: 50 },
      { settle: true },
    ),
    q("storage", "storageLayouts/locationCatalogue:options", w),
    q("storage", "storageLayouts/locationCatalogue:detail", {
      ...w,
      zoneId: ids.zoneId,
    }),
    q("storage", "storageLayouts/writes:layoutReadiness", {
      ...w,
      buildingId: ids.buildingId,
    }),
    // HR self service (actor is an org admin; mirrors the screens they open).
    q("hr-self", "hr/self:today", {}),
    q("hr-self", "hr/self:profile", {}),
    q("hr-self", "hr/self:history", { from: monthStart, to: ids.today }),
    q("hr-self", "hr/self:requests", {}),
    q("hr-self", "hr/announcements:self", {}),
    q("hr-self", "hr/notifications:list", {}),
    q("hr-self", "hr/leave:self", {}),
    // HR administration.
    q(
      "hr-admin",
      "hr/setup:employeesPage",
      { pageSize: 20, status: "ALL" },
      { settle: true },
    ),
    q(
      "hr-admin",
      "hr/review:queuePage",
      { from: monthStart, to: ids.today, tab: "OPEN", pageSize: 20 },
      { settle: true },
    ),
    q("hr-admin", "hr/periods:listPage", { pageSize: 20 }, { settle: true }),
    q("hr-admin", "hr/periods:preview", { periodId: ids.periodId }),
    q(
      "hr-admin",
      "hr/periods:versionRowsPage",
      { versionId: ids.versionId, pageSize: 20 },
      { settle: true },
    ),
    q("hr-admin", "hr/roster:roster", { warehouseId: ids.warehouseId, month }),
    q("hr-admin", "hr/roster:shifts", { warehouseId: ids.warehouseId }),
    q("hr-admin", "hr/payslips:list", {}),
    q("hr-admin", "hr/payslips:imports", {}),
    q("hr-admin", "hr/leave:queuePage", { pageSize: 20 }, { settle: true }),
    q(
      "hr-admin",
      "hr/setup:accessMembersPage",
      { pageSize: 20 },
      { settle: true },
    ),
    q("hr-admin", "hr/org:listDepartments", {}),
    q("hr-admin", "hr/search:adminEmployees", { text: "EMP" }),
    q("hr-admin", "hr/setup:employee", { employeeId: ids.employeeId }),
    // AI usage reporting.
    q("ai-usage", "aiUsage/reports:summary", { period: "month" }),
    q("ai-usage", "aiUsage/reports:recent", { period: "month" }),
    q("ai-usage", "aiUsage/dimensions:actorOptions", {}, { settle: true }),
  ];
}

let requestSequence = 0;
export const requestId = (prefix) =>
  `perf-${prefix}-${process.pid}-${Date.now()}-${++requestSequence}`;

/** Write flows run through real public mutations and undo their own effects. */
export function mutationFlows(ids) {
  const w = { warehouseId: ids.warehouseId };
  const scanItem = (index) => ({
    factoryOrder: `FO69${String(900000 + index)}`,
    productBarcodeText: `PERF-BARCODE-${index}`,
    partName: "PERF PART",
    customer: "PERF CUSTOMER",
    quantity: 100,
    source: "MANUAL",
  });
  return [
    {
      name: "job-scan save 1 → correct → delete",
      async run(call) {
        const saved = await call("finishedGoods/jobScans:saveJobScans", {
          ...w,
          requestId: requestId("save1"),
          locationText: "PERF",
          items: [scanItem(Date.now() % 100000)],
        });
        const id = saved.value?.documentId;
        if (!id)
          return {
            note: `unexpected save result ${JSON.stringify(saved).slice(0, 200)}`,
          };
        await call("finishedGoods/jobScans:updateJobScan", {
          ...w,
          jobScanId: id,
          requestId: requestId("upd1"),
          expectedVersion: 1,
          fields: (({ source, ...rest }) => ({ ...rest, quantity: 101 }))(
            scanItem(1),
          ),
        });
        await call("finishedGoods/jobScans:deleteJobScans", {
          ...w,
          requestId: requestId("del1"),
          ids: [id],
        });
      },
    },
    {
      name: "job-scan save batch of 50 (max)",
      async run(call) {
        const base = Date.now() % 100000;
        await call("finishedGoods/jobScans:saveJobScans", {
          ...w,
          requestId: requestId("save50"),
          locationText: "PERF",
          items: Array.from({ length: 50 }, (_, index) =>
            scanItem(base + index),
          ),
        });
      },
    },
    {
      name: "pallet measurement save",
      async run(call, ctx) {
        const pallet = await ctx.query("finishedGoods/workflow:getPallet", {
          ...w,
          palletId: ids.measurablePalletId,
        });
        const value = pallet.value?.pallet ?? pallet.value;
        await call("finishedGoods/workflow:saveMeasurement", {
          ...w,
          palletId: ids.measurablePalletId,
          requestId: requestId("measure"),
          ...(value?.updatedAt === undefined
            ? {}
            : { expectedMeasurementUpdatedAt: value.updatedAt }),
          quantity: value?.quantity ?? 24,
          dimensionsChecked: true,
          lengthMm: value?.lengthMm ?? 1000,
          widthMm: value?.widthMm ?? 1000,
          // Changed value: an identical measurement is a no-op write.
          heightMm: (value?.heightMm ?? 1000) + 1,
          weightKg: value?.weightKg ?? 100,
        });
      },
    },
  ];
}
