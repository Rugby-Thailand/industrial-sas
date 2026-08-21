"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";

import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import {
  listItemsRef,
  listLocationsRef,
  type ItemRow,
  type LocationRow,
} from "@/lib/convex/masterDataApi";
import {
  addTransferLineRef,
  approveTransferRequestRef,
  createTransferRequestRef,
  dispatchTransferLineRef,
  listDestinationTransfersRef,
  listOpenTransferDiscrepanciesRef,
  listSourceTransfersRef,
  listTransferLinesRef,
  listTransferWarehousesRef,
  receiveTransferLineRef,
  resolveTransferDiscrepancyRef,
  type TransferDiscrepancy,
  type TransferLine,
  type TransferSummary,
  type TransferWarehouse,
} from "@/lib/convex/transferApi";
import {
  previewItems,
  previewLocationsFor,
} from "@/lib/preview/masterDataPreview";

const PREVIEW_TRANSFERS: readonly TransferSummary[] = [
  {
    transferRequestId: "prv_transfer_1",
    transferNumber: "TRF-2608-001",
    sourceWarehouseId: "prv_wh_bangpoo",
    destinationWarehouseId: "prv_wh_lamphun",
    sourceKind: "REPLENISHMENT",
    purpose: "เติมสต็อกจุดหยิบสินค้าสำเร็จรูป",
    status: "APPROVED",
    lineCount: 1,
  },
  {
    transferRequestId: "prv_transfer_2",
    transferNumber: "TRF-2608-002",
    sourceWarehouseId: "prv_wh_lamphun",
    destinationWarehouseId: "prv_wh_bangpoo",
    sourceKind: "SALES_ORDER",
    purpose: "รับสินค้าตามใบโอนสำหรับคำสั่งขายเร่งด่วน",
    status: "DISPATCHED",
    lineCount: 1,
  },
];

const PREVIEW_LINES: readonly TransferLine[] = [
  {
    transferLineId: "prv_transfer_line_1",
    transferRequestId: "prv_transfer_1",
    lineNumber: 1,
    itemId: "prv_item_carton_a",
    baseUom: "EA",
    quantities: {
      REQUESTED: 10_000,
      DISPATCHED: 10_000,
      RECEIVED: 8_000,
      RETURNED: 0,
      DISCREPANCY: 0,
      CANCELLED: 0,
    },
    sourceBucketKey: "scan-transfer-source-tag",
  },
];

const PREVIEW_DISCREPANCIES: readonly TransferDiscrepancy[] = [
  {
    transferDiscrepancyId: "prv_transfer_discrepancy_1",
    transferRequestId: "prv_transfer_2",
    transferLineId: "prv_transfer_line_1",
    kind: "MISSING",
    baseUom: "EA",
    baseMinorUnits: 2_000,
    note: "จำนวนรับไม่ตรงกับ manifest",
  },
];

export function TransferBoard() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId, preview) =>
        preview ? (
          <TransferWorkspace
            warehouseId={warehouseId}
            preview
            sourceTransfers={PREVIEW_TRANSFERS}
            destinationTransfers={PREVIEW_TRANSFERS}
            items={previewItems()}
            warehouses={[
              {
                warehouseId: "prv_wh_bangpoo",
                code: "BPU",
                name: "คลังบางปู",
              },
              {
                warehouseId: "prv_wh_lamphun",
                code: "LPN",
                name: "คลังลำพูน",
              },
            ]}
          />
        ) : (
          <ServerTransferWorkspace warehouseId={warehouseId} />
        )
      }
    </QueryGate>
  );
}

function ServerTransferWorkspace({
  warehouseId,
}: {
  readonly warehouseId: string;
}) {
  const source = useQuery(listSourceTransfersRef, {
    warehouseId,
    maxPageSize: 100,
  });
  const destination = useQuery(listDestinationTransfersRef, {
    warehouseId,
    maxPageSize: 100,
  });
  const warehouses = useQuery(listTransferWarehousesRef, {
    warehouseId,
    maxPageSize: 100,
  });
  const items = useQuery(listItemsRef, {
    status: "ACTIVE",
    maxPageSize: 100,
  });
  if (
    source === undefined ||
    destination === undefined ||
    warehouses === undefined ||
    items === undefined
  ) {
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  }
  if (
    !source.ok ||
    !source.value.ok ||
    !destination.ok ||
    !destination.value.ok ||
    !warehouses.ok ||
    !warehouses.value.ok ||
    !items.ok ||
    !items.value.ok
  ) {
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: source.requestId }}
      />
    );
  }
  return (
    <TransferWorkspace
      warehouseId={warehouseId}
      sourceTransfers={source.value.items}
      destinationTransfers={destination.value.items}
      warehouses={warehouses.value.items}
      items={items.value.items}
    />
  );
}

function TransferWorkspace({
  warehouseId,
  sourceTransfers,
  destinationTransfers,
  warehouses,
  items,
  preview = false,
}: {
  readonly warehouseId: string;
  readonly sourceTransfers: readonly TransferSummary[];
  readonly destinationTransfers: readonly TransferSummary[];
  readonly warehouses: readonly TransferWarehouse[];
  readonly items: readonly ItemRow[];
  readonly preview?: boolean;
}) {
  const t = useTranslations("Transfers");
  const sourceOptions = sourceTransfers.map((transfer) => ({
    value: transfer.transferRequestId,
    label: `${transfer.transferNumber} · ${transfer.status}`,
  }));
  const itemOptions = items
    .filter((item) => item.status === "ACTIVE")
    .map((item) => ({
      value: item.itemId,
      label: `${item.sku} · ${item.name}`,
    }));
  return (
    <section
      aria-labelledby="transfer-board-title"
      className="flex flex-col gap-6"
    >
      <div>
        <h2
          id="transfer-board-title"
          className="text-xl font-semibold text-text"
        >
          {t("boardTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("boardHelp")}</p>
      </div>
      {preview ? <Notice tone="accent" title={t("previewOnly")} /> : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <TransferQueue title={t("sourceQueue")} transfers={sourceTransfers} />
        <TransferQueue
          title={t("destinationQueue")}
          transfers={destinationTransfers}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <EntityWriteForm
          mutationRef={createTransferRequestRef}
          legend={t("createTitle")}
          description={t("createHelp")}
          submitLabel={t("create")}
          requiredMessage={t("required")}
          testId="transfer-create-form"
          fields={[
            {
              name: "destinationWarehouseId",
              label: t("destinationWarehouse"),
              kind: "select",
              required: true,
              options: warehouses
                .filter((warehouse) => warehouse.warehouseId !== warehouseId)
                .map((warehouse) => ({
                  value: warehouse.warehouseId,
                  label: `${warehouse.code} · ${warehouse.name}`,
                })),
            },
            {
              name: "transferNumber",
              label: t("transferNumber"),
              kind: "text",
              required: true,
              initialValue: "TRF-",
            },
            {
              name: "sourceKind",
              label: t("sourceKind"),
              kind: "select",
              required: true,
              options: [
                "SALES_ORDER",
                "INVOICE",
                "PREPARATION",
                "REPLENISHMENT",
                "OTHER",
              ].map((value) => ({ value, label: t(`source${value}`) })),
            },
            {
              name: "sourceReference",
              label: t("sourceReference"),
              kind: "text",
            },
            {
              name: "purpose",
              label: t("purpose"),
              kind: "text",
              required: true,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            destinationWarehouseId: values["destinationWarehouseId"] ?? "",
            transferNumber: values["transferNumber"] ?? "",
            sourceKind: (values["sourceKind"] ??
              "OTHER") as TransferSummary["sourceKind"],
            ...(values["sourceReference"]
              ? { sourceReference: values["sourceReference"] }
              : {}),
            purpose: values["purpose"] ?? "",
          })}
        />
        <EntityWriteForm
          mutationRef={addTransferLineRef}
          legend={t("addLineTitle")}
          submitLabel={t("addLine")}
          requiredMessage={t("required")}
          fields={[
            {
              name: "transferRequestId",
              label: t("transfer"),
              kind: "select",
              required: true,
              options: sourceOptions,
            },
            {
              name: "itemId",
              label: t("item"),
              kind: "select",
              required: true,
              options: itemOptions,
            },
            {
              name: "quantity",
              label: t("quantity"),
              kind: "number",
              required: true,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            transferRequestId: values["transferRequestId"] ?? "",
            itemId: values["itemId"] ?? "",
            requestedBaseMinorUnits: Number(values["quantity"] ?? "0"),
          })}
        />
        <EntityWriteForm
          mutationRef={approveTransferRequestRef}
          legend={t("approveTitle")}
          description={t("approveHelp")}
          submitLabel={t("approve")}
          requiredMessage={t("required")}
          fields={[
            {
              name: "transferRequestId",
              label: t("transfer"),
              kind: "select",
              required: true,
              options: sourceOptions,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            transferRequestId: values["transferRequestId"] ?? "",
          })}
        />
      </div>
      {preview ? (
        <TransferExecution
          warehouseId={warehouseId}
          sourceTransfers={sourceTransfers}
          destinationTransfers={destinationTransfers}
          lines={PREVIEW_LINES}
          locations={previewLocationsFor(warehouseId)}
          discrepancies={PREVIEW_DISCREPANCIES}
          resolutionMode="RECEIVED_AT_DESTINATION"
        />
      ) : (
        <ServerTransferExecution
          warehouseId={warehouseId}
          sourceTransfers={sourceTransfers}
          destinationTransfers={destinationTransfers}
        />
      )}
    </section>
  );
}

function TransferQueue({
  title,
  transfers,
}: {
  readonly title: string;
  readonly transfers: readonly TransferSummary[];
}) {
  const t = useTranslations("Transfers");
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="font-semibold text-text">{title}</h3>
      {transfers.length === 0 ? (
        <div className="mt-3">
          <Notice tone="muted" title={t("empty")} />
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {transfers.map((transfer) => (
            <li
              key={transfer.transferRequestId}
              className="bg-subtle rounded-lg p-3 text-sm"
            >
              <span className="font-mono font-semibold">
                {transfer.transferNumber}
              </span>
              <span className="ml-2 text-muted">{transfer.status}</span>
              <p className="mt-1 text-muted">{transfer.purpose}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ServerTransferExecution({
  warehouseId,
  sourceTransfers,
  destinationTransfers,
}: {
  readonly warehouseId: string;
  readonly sourceTransfers: readonly TransferSummary[];
  readonly destinationTransfers: readonly TransferSummary[];
}) {
  const destination = destinationTransfers.find((row) =>
    ["DISPATCHED", "PARTIALLY_RECEIVED", "DISCREPANCY"].includes(row.status),
  );
  const source = sourceTransfers.find((row) =>
    ["APPROVED", "DISPATCHING", "DISCREPANCY"].includes(row.status),
  );
  const transfer = destination ?? source;
  const lines = useQuery(
    listTransferLinesRef,
    transfer === undefined
      ? "skip"
      : { warehouseId, transferRequestId: transfer.transferRequestId },
  );
  const locations = useQuery(listLocationsRef, {
    warehouseId,
    status: "ACTIVE",
    maxPageSize: 100,
  });
  const discrepancies = useQuery(
    listOpenTransferDiscrepanciesRef,
    transfer === undefined
      ? "skip"
      : { warehouseId, transferRequestId: transfer.transferRequestId },
  );
  if (transfer === undefined) return null;
  if (
    lines === undefined ||
    locations === undefined ||
    discrepancies === undefined
  ) {
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  }
  if (
    !lines.ok ||
    !lines.value.ok ||
    !locations.ok ||
    !locations.value.ok ||
    !discrepancies.ok ||
    !discrepancies.value.ok
  ) {
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: lines.requestId }}
      />
    );
  }
  return (
    <TransferExecution
      warehouseId={warehouseId}
      sourceTransfers={
        source?.transferRequestId === transfer.transferRequestId ? [source] : []
      }
      destinationTransfers={
        destination?.transferRequestId === transfer.transferRequestId
          ? [destination]
          : []
      }
      lines={lines.value.lines}
      locations={locations.value.items}
      discrepancies={discrepancies.value.discrepancies}
      resolutionMode={
        destination === undefined
          ? "RETURNED_TO_SOURCE"
          : "RECEIVED_AT_DESTINATION"
      }
    />
  );
}

function TransferExecution({
  warehouseId,
  sourceTransfers,
  destinationTransfers,
  lines,
  locations,
  discrepancies,
  resolutionMode,
}: {
  readonly warehouseId: string;
  readonly sourceTransfers: readonly TransferSummary[];
  readonly destinationTransfers: readonly TransferSummary[];
  readonly lines: readonly TransferLine[];
  readonly locations: readonly LocationRow[];
  readonly discrepancies: readonly TransferDiscrepancy[];
  readonly resolutionMode: "RECEIVED_AT_DESTINATION" | "RETURNED_TO_SOURCE";
}) {
  const t = useTranslations("Transfers");
  const lineOptions = lines.map((line) => ({
    value: line.transferLineId,
    label: `${t("line", { number: line.lineNumber })} · ${line.itemId}`,
  }));
  const source = sourceTransfers.find((row) =>
    ["APPROVED", "DISPATCHING"].includes(row.status),
  );
  const destination = destinationTransfers.find((row) =>
    ["DISPATCHED", "PARTIALLY_RECEIVED", "DISCREPANCY"].includes(row.status),
  );
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {source === undefined ? null : (
        <EntityWriteForm
          mutationRef={dispatchTransferLineRef}
          legend={t("dispatchTitle")}
          description={t("dispatchHelp")}
          submitLabel={t("dispatch")}
          requiredMessage={t("required")}
          testId="transfer-dispatch-form"
          fields={[
            {
              name: "lineId",
              label: t("transferLine"),
              kind: "select",
              required: true,
              options: lineOptions,
            },
            {
              name: "sourceBucketKey",
              label: t("sourceTag"),
              kind: "text",
              required: true,
              monospace: true,
            },
            {
              name: "quantity",
              label: t("quantity"),
              kind: "number",
              required: true,
            },
            { name: "sealNumber", label: t("seal"), kind: "text" },
            { name: "carrierName", label: t("carrier"), kind: "text" },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            transferRequestId: source.transferRequestId,
            transferLineId: values["lineId"] ?? "",
            sourceBucketKey: values["sourceBucketKey"] ?? "",
            baseMinorUnits: Number(values["quantity"] ?? "0"),
            ...(values["sealNumber"]
              ? { sealNumber: values["sealNumber"] }
              : {}),
            ...(values["carrierName"]
              ? { carrierName: values["carrierName"] }
              : {}),
          })}
        />
      )}
      {destination === undefined ? null : (
        <EntityWriteForm
          mutationRef={receiveTransferLineRef}
          legend={t("receiveTitle")}
          description={t("receiveHelp")}
          submitLabel={t("receive")}
          requiredMessage={t("required")}
          testId="transfer-receive-form"
          fields={[
            {
              name: "lineId",
              label: t("transferLine"),
              kind: "select",
              required: true,
              options: lineOptions,
            },
            {
              name: "locationId",
              label: t("destinationLocation"),
              kind: "select",
              required: true,
              options: locations.map((location) => ({
                value: location.locationId,
                label: `${location.code} · ${location.locationType}`,
              })),
            },
            {
              name: "received",
              label: t("receivedQuantity"),
              kind: "number",
              required: true,
            },
            {
              name: "discrepancy",
              label: t("discrepancyQuantity"),
              kind: "number",
              required: true,
              initialValue: "0",
            },
            {
              name: "discrepancyKind",
              label: t("discrepancyKind"),
              kind: "select",
              options: ["MISSING", "DAMAGED", "WRONG_TAG"].map((value) => ({
                value,
                label: t(`kind${value}`),
              })),
            },
            { name: "note", label: t("discrepancyNote"), kind: "text" },
            {
              name: "stockStatus",
              label: t("stockStatus"),
              kind: "select",
              required: true,
              options: ["AVAILABLE", "QC_HOLD", "QUARANTINE"].map((value) => ({
                value,
                label: value,
              })),
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            transferRequestId: destination.transferRequestId,
            transferLineId: values["lineId"] ?? "",
            destinationLocationId: values["locationId"] ?? "",
            receivedBaseMinorUnits: Number(values["received"] ?? "0"),
            discrepancyBaseMinorUnits: Number(values["discrepancy"] ?? "0"),
            ...(values["discrepancyKind"]
              ? {
                  discrepancyKind: values["discrepancyKind"] as
                    "MISSING" | "DAMAGED" | "WRONG_TAG",
                }
              : {}),
            ...(values["note"] ? { discrepancyNote: values["note"] } : {}),
            stockStatus: (values["stockStatus"] ?? "AVAILABLE") as
              "AVAILABLE" | "QC_HOLD" | "QUARANTINE",
          })}
        />
      )}
      {discrepancies.length === 0 ? null : (
        <EntityWriteForm
          mutationRef={resolveTransferDiscrepancyRef}
          legend={t("resolveTitle")}
          description={
            resolutionMode === "RECEIVED_AT_DESTINATION"
              ? t("resolveReceivedHelp")
              : t("resolveReturnedHelp")
          }
          submitLabel={t("resolve")}
          requiredMessage={t("required")}
          testId="transfer-resolve-discrepancy-form"
          fields={[
            {
              name: "discrepancyId",
              label: t("discrepancy"),
              kind: "select",
              required: true,
              options: discrepancies.map((discrepancy) => ({
                value: discrepancy.transferDiscrepancyId,
                label: `${discrepancy.kind} · ${discrepancy.baseMinorUnits} ${discrepancy.baseUom}`,
              })),
            },
            ...(resolutionMode === "RECEIVED_AT_DESTINATION"
              ? [
                  {
                    name: "locationId",
                    label: t("destinationLocation"),
                    kind: "select" as const,
                    required: true,
                    options: locations.map((location) => ({
                      value: location.locationId,
                      label: `${location.code} · ${location.locationType}`,
                    })),
                  },
                ]
              : []),
            {
              name: "stockStatus",
              label: t("stockStatus"),
              kind: "select",
              required: true,
              options: ["AVAILABLE", "QC_HOLD", "QUARANTINE"].map((value) => ({
                value,
                label: value,
              })),
            },
            {
              name: "resolutionNote",
              label: t("resolutionNote"),
              kind: "text",
              required: true,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            transferDiscrepancyId: values["discrepancyId"] ?? "",
            resolution: resolutionMode,
            ...(values["locationId"]
              ? { destinationLocationId: values["locationId"] }
              : {}),
            stockStatus: (values["stockStatus"] ?? "AVAILABLE") as
              "AVAILABLE" | "QC_HOLD" | "QUARANTINE",
            resolutionNote: values["resolutionNote"] ?? "",
          })}
        />
      )}
    </div>
  );
}
