import type {
  DashboardTile,
  OccupancyCell,
  OperationalExceptionsPayload,
  ReportJobRow,
  StockMovementsPayload,
  StockReportsPayload,
} from "@/lib/convex/reportingApi";

import { previewLocationsFor } from "./masterData";

export const previewDashboardTiles = (): readonly DashboardTile[] =>
  Object.freeze([
    Object.freeze({
      metric: "RECEIPTS_OPENED" as const,
      count: 18,
      updatedAt: 1_754_900_000_000,
      suspect: false,
    }),
    Object.freeze({
      metric: "RECEIPT_LINES_POSTED" as const,
      count: 64,
      updatedAt: 1_754_900_100_000,
      suspect: false,
    }),
    Object.freeze({
      metric: "QC_PENDING" as const,
      count: 3,
      updatedAt: 1_754_900_200_000,
      suspect: false,
    }),
    Object.freeze({
      metric: "QC_PARKED" as const,
      count: 1,
      updatedAt: 1_754_900_300_000,
      suspect: true,
    }),
    Object.freeze({
      metric: "PUTAWAY_READY" as const,
      count: 7,
      updatedAt: 1_754_900_400_000,
      suspect: false,
    }),
    Object.freeze({
      metric: "PUTAWAY_CLAIMED" as const,
      count: 2,
      updatedAt: 1_754_900_500_000,
      suspect: false,
    }),
  ]);

const OCCUPANCY_BY_CODE: Readonly<Record<string, number>> = Object.freeze({
  "A01-02-1": 9,
  "B04-11-3": 5,
  "C02-01-2": 2,
  "D01-01-1": 0,
  "DOCK-IN-1": 4,
  "F01-03-2": 11,
  "STAGE-OUT": 1,
});

const bandFor = (buckets: number): string => {
  if (buckets <= 0) return "EMPTY";
  if (buckets >= 8) return "FULL";
  if (buckets >= 4) return "BUSY";
  return "LIGHT";
};

export const previewOccupancyFor = (
  warehouseId: string,
): readonly OccupancyCell[] =>
  previewLocationsFor(warehouseId).map((location) => {
    const distinctBuckets = OCCUPANCY_BY_CODE[location.code] ?? 0;
    return Object.freeze({
      locationId: location.locationId,
      code: location.code,
      locationType: location.locationType,
      distinctBuckets,
      band: bandFor(distinctBuckets),
    });
  });

export const PREVIEW_REPORT_JOBS: readonly ReportJobRow[] = Object.freeze([
  Object.freeze({
    reportJobId: "prv_rpt_7001",
    kind: "INVENTORY_BALANCES" as const,
    status: "COMPLETE" as const,
    rowCount: 128,
    artifactBytes: 14_820,
    requestedAt: 1_754_800_000_000,
    completedAt: 1_754_800_060_000,
  }),
  Object.freeze({
    reportJobId: "prv_rpt_7002",
    kind: "RECEIPT_LINES" as const,
    status: "RUNNING" as const,
    rowCount: 40,
    artifactBytes: 4_210,
    requestedAt: 1_754_800_200_000,
  }),
  Object.freeze({
    reportJobId: "prv_rpt_7003",
    kind: "PUTAWAY_TASKS" as const,
    status: "FAILED" as const,
    rowCount: 9_512,
    artifactBytes: 524_288,
    requestedAt: 1_754_800_400_000,
    completedAt: 1_754_800_900_000,
    failureCode: "ARTIFACT_LIMIT_REACHED",
  }),
]);

export const previewReportJobById = (
  reportJobId: string,
): ReportJobRow | undefined =>
  PREVIEW_REPORT_JOBS.find((job) => job.reportJobId === reportJobId);

export const PREVIEW_ARTIFACT = `﻿bucketKey,itemId,locationId,stockStatus,uom,quantity\r
prv_bucket_1,prv_item_steel_coil,prv_loc_A01-02-1,AVAILABLE,KG,180.000\r
prv_bucket_2,prv_item_bolt_m8,prv_loc_B04-11-3,AVAILABLE,EA,480.000\r
`;

export const PREVIEW_STOCK_REPORTS: StockReportsPayload = Object.freeze({
  ok: true,
  asOf: Date.UTC(2026, 7, 17, 8, 30),
  complete: true,
  balances: Object.freeze([
    {
      bucketKey: "prv_bucket_carton_available",
      itemId: "prv_item_carton_a",
      sku: "FG-CARTON-A",
      itemName: "Gold export carton",
      locationId: "prv_loc_A01-02-1",
      locationCode: "A01-02-1",
      lotId: "prv_lot_carton_260817",
      lotCode: "FG-260817-A",
      expirationDate: "2027-08-17",
      stockStatus: "AVAILABLE",
      baseUom: "EA",
      baseMinorUnits: 2_400_000,
      lastTransactionId: "prv_txn_qc_release_26018",
      updatedAt: Date.UTC(2026, 7, 17, 8, 15),
    },
    {
      bucketKey: "prv_bucket_carton_hold",
      itemId: "prv_item_carton_a",
      sku: "FG-CARTON-A",
      itemName: "Gold export carton",
      locationId: "prv_loc_STAGE-OUT",
      locationCode: "STAGE-OUT",
      lotId: "prv_lot_carton_260818",
      lotCode: "FG-260818-A",
      expirationDate: "2027-08-18",
      stockStatus: "QC_HOLD",
      baseUom: "EA",
      baseMinorUnits: 300_000,
      lastTransactionId: "prv_txn_receipt_26019",
      updatedAt: Date.UTC(2026, 7, 17, 8, 20),
    },
  ]),
  sku: Object.freeze([
    {
      itemId: "prv_item_carton_a",
      sku: "FG-CARTON-A",
      itemName: "Gold export carton",
      baseUom: "EA",
      availableBaseMinorUnits: 2_400_000,
      committedBaseMinorUnits: 1_200_000,
      atpBaseMinorUnits: 1_200_000,
      qcHoldBaseMinorUnits: 300_000,
      rejectedBaseMinorUnits: 0,
      otherBaseMinorUnits: 0,
    },
  ]),
  lots: Object.freeze([
    {
      itemId: "prv_item_carton_a",
      sku: "FG-CARTON-A",
      lotId: "prv_lot_carton_260817",
      lotCode: "FG-260817-A",
      expirationDate: "2027-08-17",
      baseUom: "EA",
      availableBaseMinorUnits: 2_400_000,
      restrictedBaseMinorUnits: 0,
    },
    {
      itemId: "prv_item_carton_a",
      sku: "FG-CARTON-A",
      lotId: "prv_lot_carton_260818",
      lotCode: "FG-260818-A",
      expirationDate: "2027-08-18",
      baseUom: "EA",
      availableBaseMinorUnits: 0,
      restrictedBaseMinorUnits: 300_000,
    },
  ]),
});

export const PREVIEW_STOCK_MOVEMENTS: StockMovementsPayload = Object.freeze({
  ok: true,
  asOf: Date.UTC(2026, 7, 17, 8, 30),
  complete: true,
  movements: Object.freeze([
    {
      ledgerLineId: "prv_line_qc_release_1",
      transactionId: "prv_txn_qc_release_26018",
      type: "STATUS_CHANGE",
      operation: "production.output.quality",
      occurredAt: Date.UTC(2026, 7, 17, 8, 15),
      businessDate: "2026-08-17",
      itemId: "prv_item_carton_a",
      sku: "FG-CARTON-A",
      lotCode: "FG-260817-A",
      location: "A01-02-1",
      stockStatus: "AVAILABLE",
      baseUom: "EA",
      signedBaseMinorUnits: 2_400_000,
      actorUserId: "prv_qc_checker",
    },
  ]),
});

export const PREVIEW_OPERATIONAL_EXCEPTIONS: OperationalExceptionsPayload =
  Object.freeze({
    ok: true,
    asOf: Date.UTC(2026, 7, 17, 8, 30),
    complete: true,
    exceptions: Object.freeze([
      {
        sourceType: "DESIGN_CHANGE",
        sourceId: "prv_impact_rev_5_mo_26018",
        severity: "CRITICAL" as const,
        titleCode: "DESIGN_CHANGE",
        detail: "MO-26018: internalWidthMm, materials",
        occurredAt: Date.UTC(2026, 7, 17, 7, 45),
        deepLink: "/production/orders",
      },
      {
        sourceType: "QUALITY",
        sourceId: "prv_output_receipt_26019",
        severity: "MEDIUM" as const,
        titleCode: "QC_HOLD",
        detail: "MO-26019",
        occurredAt: Date.UTC(2026, 7, 17, 8, 20),
        deepLink: "/production/orders",
      },
    ]),
  });
