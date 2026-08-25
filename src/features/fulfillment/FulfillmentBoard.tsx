"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import {
  allocateFulfillmentLineRef,
  cancelFulfillmentLineRemainderRef,
  createPickWaveRef,
  createShipmentRef,
  listFulfillmentLinesRef,
  listFulfillmentOrdersRef,
  releaseFulfillmentOrderRef,
  releasePickWaveRef,
  releaseShipmentRef,
  routeCustomerOrderLineRef,
  type FulfillmentLineRow,
  type FulfillmentOrderRow,
} from "@/lib/convex/fulfillmentApi";
import {
  listRoutableCustomerOrderLinesRef,
  type CustomerOrderLineRow,
} from "@/lib/convex/orderToShipApi";

const previewOrder: FulfillmentOrderRow = {
  fulfillmentOrderId: "prv_fulfillment_1",
  fulfillmentNumber: "FF-2608-001",
  customerOrderId: "prv_so_1",
  customerId: "prv_customer_1",
  warehouseId: "prv_warehouse",
  status: "RELEASED",
  routeDecision: "PRODUCTION",
  routeVersion: 1,
  allowPartial: true,
  requestedDeliveryAt: Date.now() + 86_400_000,
  shipTo: {
    name: "Top Gold Foods DC",
    addressLine1: "99 Industrial Road",
    province: "Bangkok",
    countryCode: "TH",
  },
};

const previewLine: FulfillmentLineRow = {
  fulfillmentLineId: "prv_line_1",
  fulfillmentOrderId: previewOrder.fulfillmentOrderId,
  itemId: "prv_item_fg",
  baseUom: "PCS",
  orderedBaseMinorUnits: 8_000,
  routeDecision: "PRODUCTION",
  routeVersion: 1,
  productionShortageBaseMinorUnits: 5_000,
  status: "UNPLANNED",
  quantities: { DEMAND: 8_000, RESERVED: 0 },
};

const previewRoutableLine: CustomerOrderLineRow = {
  customerOrderLineId: "prv_sol_ready_2",
  customerOrderId: "prv_so_ready_2",
  lineNumber: 2,
  customerProductCode: "TOP-GOLD-BOX-02",
  specification: {
    styleCode: "RSC",
    internalLengthMm: 300,
    internalWidthMm: 200,
    internalHeightMm: 150,
    boardGrade: "KA125/C/KA125",
    printColourCount: 2,
  },
  designKey: "RSC-300-200-150",
  designSource: "EXISTING",
  status: "DESIGN_READY",
  orderedQuantity: 8,
  masterCardRevisionId: "prv_revision_ready_2",
};

const idFromOutcome = (outcome: Record<string, unknown>) => {
  const value = outcome["value"] as Record<string, unknown> | undefined;
  return typeof value?.["documentId"] === "string"
    ? value["documentId"]
    : undefined;
};

export function FulfillmentBoard() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId, preview) =>
        preview ? (
          <FulfillmentWorkspace
            warehouseId={warehouseId}
            orders={[{ ...previewOrder, warehouseId }]}
            routableLines={[previewRoutableLine]}
            preview
          />
        ) : (
          <ServerFulfillmentBoard warehouseId={warehouseId} />
        )
      }
    </QueryGate>
  );
}

function ServerFulfillmentBoard({
  warehouseId,
}: {
  readonly warehouseId: string;
}) {
  const outcome = useQuery(listFulfillmentOrdersRef, {
    warehouseId,
    maxPageSize: 50,
  });
  const routable = useQuery(listRoutableCustomerOrderLinesRef, {
    maxPageSize: 50,
  });
  if (outcome === undefined || routable === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok)
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  if (!routable.ok)
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: routable.requestId }}
      />
    );
  if (!outcome.value.ok || !routable.value.ok)
    return (
      <LedgerPanelStatus state={{ kind: "ERROR", code: "FULFILLMENT_READ" }} />
    );
  return (
    <FulfillmentWorkspace
      warehouseId={warehouseId}
      orders={outcome.value.items}
      routableLines={routable.value.items}
    />
  );
}

function FulfillmentWorkspace({
  warehouseId,
  orders,
  routableLines,
  preview = false,
}: {
  readonly warehouseId: string;
  readonly orders: readonly FulfillmentOrderRow[];
  readonly routableLines: readonly CustomerOrderLineRow[];
  readonly preview?: boolean;
}) {
  const t = useTranslations("Fulfillment");
  const [selectedId, setSelectedId] = useState(orders[0]?.fulfillmentOrderId);
  const selected = orders.find(
    (order) => order.fulfillmentOrderId === selectedId,
  );

  return (
    <div className="flex flex-col gap-6">
      <DemandRoutingForm
        warehouseId={warehouseId}
        routableLines={routableLines}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,2fr)]">
        <section
          aria-labelledby="fulfillment-queue"
          className="rounded-xl border border-border bg-surface p-4"
        >
          <h2
            id="fulfillment-queue"
            className="text-lg font-semibold text-text"
          >
            {t("queueTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("queueHelp")}</p>
          <div className="mt-4 flex flex-col gap-2">
            {orders.length === 0 ? (
              <Notice tone="muted" title={t("empty")} />
            ) : (
              orders.map((order) => (
                <button
                  key={order.fulfillmentOrderId}
                  type="button"
                  onClick={() => setSelectedId(order.fulfillmentOrderId)}
                  aria-pressed={selectedId === order.fulfillmentOrderId}
                  className="bg-surface-raised rounded-lg border border-border p-3 text-left transition hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-mono text-sm font-semibold text-text">
                      {order.fulfillmentNumber}
                    </span>
                    <StatusBadge
                      tone={order.status === "RELEASED" ? "accent" : "neutral"}
                      label={t(`orderStatus.${order.status}`)}
                    />
                  </span>
                  <span className="mt-2 block text-sm text-muted">
                    {order.shipTo.name} · {order.shipTo.province}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
        {selected === undefined ? (
          <Notice tone="muted" title={t("selectOrder")} />
        ) : (
          <OrderActions
            key={selected.fulfillmentOrderId}
            warehouseId={warehouseId}
            order={selected}
            preview={preview}
          />
        )}
      </div>
    </div>
  );
}

function DemandRoutingForm({
  warehouseId,
  routableLines,
}: {
  readonly warehouseId: string;
  readonly routableLines: readonly CustomerOrderLineRow[];
}) {
  const t = useTranslations("Fulfillment");
  const optional = (value: string | undefined) => {
    const normalized = value?.trim();
    return normalized === undefined || normalized === ""
      ? undefined
      : normalized;
  };
  return (
    <EntityWriteForm
      mutationRef={routeCustomerOrderLineRef}
      legend={t("routeTitle")}
      description={t("routeHelp")}
      submitLabel={t("routeDemand")}
      requiredMessage={t("required")}
      fields={[
        {
          name: "fulfillmentNumber",
          label: t("fulfillmentNumber"),
          kind: "text",
          required: true,
          monospace: true,
        },
        {
          name: "customerOrderLineId",
          label: t("customerOrderLineId"),
          kind: "select",
          required: true,
          options: routableLines.map((line) => ({
            value: line.customerOrderLineId,
            label: `${line.customerProductCode} · ${t("lineSummary", {
              line: line.lineNumber,
              quantity: line.orderedQuantity,
            })}`,
          })),
        },
        {
          name: "itemId",
          label: t("itemId"),
          kind: "text",
          required: true,
          monospace: true,
        },
        {
          name: "allowPartial",
          label: t("allowPartial"),
          kind: "select",
          required: true,
          initialValue: "YES",
          options: [
            { value: "YES", label: t("yes") },
            { value: "NO", label: t("no") },
          ],
        },
        {
          name: "shipToName",
          label: t("shipToName"),
          kind: "text",
          required: true,
        },
        {
          name: "addressLine1",
          label: t("addressLine1"),
          kind: "text",
          required: true,
        },
        {
          name: "province",
          label: t("province"),
          kind: "text",
          required: true,
        },
        {
          name: "countryCode",
          label: t("countryCode"),
          kind: "text",
          required: true,
          initialValue: "TH",
          monospace: true,
        },
        /*
         * The optional address detail waits behind "More options": name,
         * street, and province are what routing needs, and the rest is filled
         * only when the customer supplied it.
         */
        {
          name: "district",
          label: t("district"),
          kind: "text",
          importance: "secondary",
        },
        {
          name: "postalCode",
          label: t("postalCode"),
          kind: "text",
          importance: "secondary",
        },
        {
          name: "recipientName",
          label: t("recipientName"),
          kind: "text",
          importance: "secondary",
        },
        {
          name: "recipientPhone",
          label: t("recipientPhone"),
          kind: "text",
          importance: "secondary",
        },
      ]}
      toArgs={(values, requestId) => ({
        requestId,
        warehouseId,
        fulfillmentNumber: values.fulfillmentNumber ?? "",
        customerOrderLineId: values.customerOrderLineId ?? "",
        itemId: values.itemId ?? "",
        allowPartial: values.allowPartial === "YES",
        shipTo: {
          name: values.shipToName ?? "",
          addressLine1: values.addressLine1 ?? "",
          ...(optional(values.district) === undefined
            ? {}
            : { district: optional(values.district) }),
          province: values.province ?? "",
          ...(optional(values.postalCode) === undefined
            ? {}
            : { postalCode: optional(values.postalCode) }),
          countryCode: values.countryCode ?? "TH",
          ...(optional(values.recipientName) === undefined
            ? {}
            : { recipientName: optional(values.recipientName) }),
          ...(optional(values.recipientPhone) === undefined
            ? {}
            : { recipientPhone: optional(values.recipientPhone) }),
        },
      })}
    />
  );
}

function OrderActions({
  warehouseId,
  order,
  preview,
}: {
  readonly warehouseId: string;
  readonly order: FulfillmentOrderRow;
  readonly preview: boolean;
}) {
  if (preview)
    return (
      <OrderActionBody
        warehouseId={warehouseId}
        order={order}
        lines={[previewLine]}
        preview
      />
    );
  return <ServerOrderActions warehouseId={warehouseId} order={order} />;
}

function ServerOrderActions({
  warehouseId,
  order,
}: {
  readonly warehouseId: string;
  readonly order: FulfillmentOrderRow;
}) {
  const outcome = useQuery(listFulfillmentLinesRef, {
    warehouseId,
    fulfillmentOrderId: order.fulfillmentOrderId,
    maxPageSize: 50,
  });
  if (outcome === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok)
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  if (!outcome.value.ok)
    return (
      <LedgerPanelStatus state={{ kind: "ERROR", code: "FULFILLMENT_LINES" }} />
    );
  return (
    <OrderActionBody
      warehouseId={warehouseId}
      order={order}
      lines={outcome.value.items}
    />
  );
}

function OrderActionBody({
  warehouseId,
  order,
  lines,
  preview = false,
}: {
  readonly warehouseId: string;
  readonly order: FulfillmentOrderRow;
  readonly lines: readonly FulfillmentLineRow[];
  readonly preview?: boolean;
}) {
  const t = useTranslations("Fulfillment");
  const [waveId, setWaveId] = useState<string>();
  const [shipmentId, setShipmentId] = useState<string>();
  const lineOptions = lines.map((line) => ({
    value: line.fulfillmentLineId,
    label: `${line.itemId} · ${line.orderedBaseMinorUnits / 1000} ${line.baseUom} · ${t(`lineStatus.${line.status}`)}`,
  }));
  return (
    <section
      aria-labelledby="fulfillment-actions"
      className="flex flex-col gap-5"
    >
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2
          id="fulfillment-actions"
          className="text-lg font-semibold text-text"
        >
          {order.fulfillmentNumber}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {order.shipTo.name} · {order.shipTo.addressLine1} ·{" "}
          {order.shipTo.province}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge
            tone={order.routeDecision === "PRODUCTION" ? "warning" : "accent"}
            label={t(`route.${order.routeDecision}`)}
          />
          <span className="text-xs text-muted">
            {t("routeVersion", { version: order.routeVersion })}
          </span>
        </div>
        {preview ? (
          <div className="mt-3">
            <Notice tone="accent" title={t("previewOnly")} />
          </div>
        ) : null}
      </div>
      {order.status === "DRAFT" ? (
        <EntityWriteForm
          mutationRef={releaseFulfillmentOrderRef}
          legend={t("releaseOrderTitle")}
          description={t("releaseOrderHelp")}
          submitLabel={t("releaseOrder")}
          requiredMessage={t("required")}
          fields={[]}
          toArgs={(_values, requestId) => ({
            requestId,
            warehouseId,
            fulfillmentOrderId: order.fulfillmentOrderId,
          })}
        />
      ) : null}
      {lines.some((line) => line.routeDecision === "PRODUCTION") ? (
        <Notice
          tone="warning"
          title={t("productionRequired")}
          body={t("productionRequiredHelp", {
            quantity: lines.reduce(
              (sum, line) => sum + (line.productionShortageBaseMinorUnits ?? 0),
              0,
            ),
          })}
        />
      ) : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <EntityWriteForm
          mutationRef={allocateFulfillmentLineRef}
          legend={t("allocateTitle")}
          description={t("allocateHelp")}
          submitLabel={t("allocate")}
          requiredMessage={t("required")}
          fields={[
            {
              name: "lineId",
              label: t("line"),
              kind: "select",
              required: true,
              options: lineOptions,
            },
            {
              name: "strategy",
              label: t("rotation"),
              kind: "select",
              required: true,
              initialValue: "FEFO",
              options: [
                { value: "FEFO", label: "FEFO" },
                { value: "FIFO", label: "FIFO" },
              ],
            },
            {
              name: "quantity",
              label: t("quantityMinor"),
              kind: "number",
              required: true,
              initialValue: String(lines[0]?.orderedBaseMinorUnits ?? 0),
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            fulfillmentLineId: values["lineId"] ?? "",
            strategy: (values["strategy"] ?? "FEFO") as "FIFO" | "FEFO",
            asOfBusinessDate: new Date().toISOString().slice(0, 10),
            requestedBaseMinorUnits: Number(values["quantity"]),
          })}
        />
        <EntityWriteForm
          mutationRef={cancelFulfillmentLineRemainderRef}
          legend={t("cancelRemainingTitle")}
          description={t("cancelRemainingHelp")}
          submitLabel={t("cancelRemaining")}
          requiredMessage={t("required")}
          fields={[
            {
              name: "lineId",
              label: t("line"),
              kind: "select",
              required: true,
              options: lineOptions,
            },
            {
              name: "reason",
              label: t("cancelReason"),
              kind: "text",
              required: true,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            fulfillmentLineId: values["lineId"] ?? "",
            reason: values["reason"] ?? "",
          })}
        />
        <EntityWriteForm
          mutationRef={createPickWaveRef}
          legend={t("waveTitle")}
          submitLabel={t("createWave")}
          requiredMessage={t("required")}
          fields={[
            {
              name: "waveNumber",
              label: t("waveNumber"),
              kind: "text",
              required: true,
              initialValue: "WAVE-",
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            fulfillmentOrderId: order.fulfillmentOrderId,
            waveNumber: values["waveNumber"] ?? "",
          })}
          onSaved={(outcome) => setWaveId(idFromOutcome(outcome))}
        />
        <EntityWriteForm
          mutationRef={createShipmentRef}
          legend={t("shipmentTitle")}
          description={t("shipmentHelp")}
          submitLabel={t("createShipment")}
          requiredMessage={t("required")}
          fields={[
            {
              name: "shipmentNumber",
              label: t("shipmentNumber"),
              kind: "text",
              required: true,
              initialValue: "SHP-",
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            fulfillmentOrderId: order.fulfillmentOrderId,
            shipmentNumber: values["shipmentNumber"] ?? "",
          })}
          onSaved={(outcome) => setShipmentId(idFromOutcome(outcome))}
        />
        <div className="flex flex-col gap-3">
          {/*
           * The success notices no longer print the created document ID: it is
           * a Convex identifier nobody can act on, and the release control
           * that appears below is the actual next step.
           */}
          <Notice
            tone={waveId === undefined ? "muted" : "success"}
            title={waveId === undefined ? t("wavePending") : t("waveCreated")}
          />
          <Notice
            tone={shipmentId === undefined ? "muted" : "success"}
            title={
              shipmentId === undefined
                ? t("shipmentPending")
                : t("shipmentCreated")
            }
          />
          {waveId === undefined ? null : (
            <EntityWriteForm
              mutationRef={releasePickWaveRef}
              legend={t("releaseWave")}
              submitLabel={t("releaseWave")}
              requiredMessage={t("required")}
              fields={[]}
              toArgs={(_values, requestId) => ({
                requestId,
                warehouseId,
                pickWaveId: waveId,
              })}
            />
          )}
          {shipmentId === undefined ? null : (
            <EntityWriteForm
              mutationRef={releaseShipmentRef}
              legend={t("releaseShipment")}
              submitLabel={t("releaseShipment")}
              requiredMessage={t("required")}
              fields={[]}
              toArgs={(_values, requestId) => ({
                requestId,
                warehouseId,
                shipmentId,
              })}
            />
          )}
        </div>
      </div>
    </section>
  );
}
