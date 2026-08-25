"use client";

import { useQuery } from "convex/react";
import { ListOrdered } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import {
  acknowledgeDesignChangeImpactRef,
  listDesignChangeImpactsRef,
  type DesignChangeImpactRow,
} from "@/lib/convex/orderToShipApi";
import {
  listItemsRef,
  listLocationsRef,
  type ItemRow,
  type LocationRow,
} from "@/lib/convex/masterDataApi";
import {
  createProductionOrderRef,
  decideProductionOutputQualityRef,
  issueProductionMaterialRef,
  listProductionOrdersRef,
  receiveProductionOutputRef,
  releaseProductionOrderRef,
  reportProductionOperationRef,
  type ProductionOrderRow,
} from "@/lib/convex/productionApi";
import type { AppLocale } from "@/i18n/routing";
import { formatCount, formatInstantDate } from "@/lib/formatters";
const tone = (status: ProductionOrderRow["status"]): BadgeTone => {
  if (status === "COMPLETE") return "success";
  if (status === "CLOSED_REJECTED" || status === "CANCELLED") return "danger";
  if (status === "QC_PENDING") return "pending";
  if (status === "IN_PROGRESS") return "accent";
  return "neutral";
};

export function ProductionBoard() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => <ServerProductionWorkspace warehouseId={warehouseId} />}
    </QueryGate>
  );
}

function ServerProductionWorkspace({
  warehouseId,
}: {
  readonly warehouseId: string;
}) {
  const orders = useQuery(listProductionOrdersRef, {
    warehouseId,
    maxPageSize: 100,
  });
  const items = useQuery(listItemsRef, { status: "ACTIVE", maxPageSize: 100 });
  const locations = useQuery(listLocationsRef, {
    warehouseId,
    status: "ACTIVE",
    maxPageSize: 100,
  });
  const impacts = useQuery(listDesignChangeImpactsRef, {
    warehouseId,
    status: "OPEN",
    maxPageSize: 100,
  });
  if (
    orders === undefined ||
    items === undefined ||
    locations === undefined ||
    impacts === undefined
  ) {
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  }
  if (!orders.ok) {
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: orders.requestId }}
      />
    );
  }
  if (!items.ok) {
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: items.requestId }}
      />
    );
  }
  if (!locations.ok) {
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: locations.requestId }}
      />
    );
  }
  if (!impacts.ok) {
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: impacts.requestId }}
      />
    );
  }
  if (
    !orders.value.ok ||
    !items.value.ok ||
    !locations.value.ok ||
    !impacts.value.ok
  ) {
    return (
      <LedgerPanelStatus state={{ kind: "ERROR", code: "PRODUCTION_READ" }} />
    );
  }
  return (
    <ProductionWorkspace
      warehouseId={warehouseId}
      orders={orders.value.items}
      items={items.value.items}
      locations={locations.value.items}
      impacts={impacts.value.items}
    />
  );
}

function ProductionWorkspace({
  warehouseId,
  orders,
  items,
  locations,
  impacts,
}: {
  readonly warehouseId: string;
  readonly orders: readonly ProductionOrderRow[];
  readonly items: readonly ItemRow[];
  readonly locations: readonly LocationRow[];
  readonly impacts: readonly DesignChangeImpactRow[];
}) {
  const t = useTranslations("Production");
  const orderOptions = orders.map((order) => ({
    value: order.productionOrderId,
    label: `${order.productionOrderNumber} · ${t(`status.${order.status}`)}`,
  }));
  const itemOptions = items.map((item) => ({
    value: item.itemId,
    label: `${item.sku} · ${item.name}`,
  }));
  const locationOptions = locations.map((location) => ({
    value: location.locationId,
    label: `${location.code} · ${location.locationType}`,
  }));
  const impactOptions = impacts.map((impact) => ({
    value: impact.designChangeImpactId,
    label: `${impact.productionOrderNumber} · ${impact.severity}`,
  }));
  return (
    <section aria-labelledby="production-board-title" className="space-y-6">
      <div>
        <h2
          id="production-board-title"
          className="text-xl font-semibold text-text"
        >
          {t("boardTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("boardHelp")}</p>
      </div>

      <section
        aria-labelledby="design-impact-title"
        className="rounded-xl border border-border bg-surface p-4"
      >
        <h3 id="design-impact-title" className="font-semibold text-text">
          {t("designImpacts")}
        </h3>
        <p className="mt-1 text-sm text-muted">{t("designImpactsHelp")}</p>
        {impacts.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("noDesignImpacts")}</p>
        ) : (
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">
            {impacts.map((impact) => (
              <li
                key={impact.designChangeImpactId}
                className="rounded-lg border border-warning/50 bg-raised p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-text">
                    {impact.productionOrderNumber}
                  </strong>
                  <StatusBadge
                    tone={impact.severity === "BLOCKING" ? "danger" : "pending"}
                    label={t(`impactSeverity.${impact.severity}`)}
                  />
                </div>
                <p className="mt-2 text-sm text-muted">
                  {t("revisionChanged", {
                    from: impact.fromRevisionId,
                    to: impact.toRevisionId,
                  })}
                </p>
                <p className="mt-1 text-sm text-text">
                  {t("changedFields", {
                    fields: impact.changedFields.join(", "),
                  })}
                </p>
                <p className="mt-2 text-xs text-warning">
                  {t("pinnedRevisionWarning")}
                </p>
              </li>
            ))}
          </ul>
        )}
        {impacts.length === 0 ? null : (
          <div className="mt-4 max-w-2xl">
            <EntityWriteForm
              mutationRef={acknowledgeDesignChangeImpactRef}
              legend={t("acknowledgeImpact")}
              description={t("acknowledgeImpactHelp")}
              submitLabel={t("acknowledge")}
              requiredMessage={t("required")}
              fields={[
                {
                  name: "designChangeImpactId",
                  label: t("designImpact"),
                  kind: "select",
                  required: true,
                  options: impactOptions,
                },
                {
                  name: "note",
                  label: t("impactDecisionNote"),
                  kind: "textarea",
                  required: true,
                },
              ]}
              toArgs={(values, requestId) => ({
                requestId,
                warehouseId,
                designChangeImpactId: values.designChangeImpactId ?? "",
                note: values.note ?? "",
              })}
            />
          </div>
        )}
      </section>

      {/*
       * The five-step explainer is training material: collapsed so the live
       * orders — the operator's actual state — sit directly under the impacts.
       */}
      <CollapsibleSection label={t("flowLabel")} icon={ListOrdered}>
        <ol className="grid gap-2 text-sm md:grid-cols-5">
          {["pin", "issue", "run", "hold", "release"].map((step, index) => (
            <li
              key={step}
              className="rounded-lg border border-border bg-raised p-3"
            >
              <span className="font-mono text-xs text-muted">
                {index + 1}/5
              </span>
              <strong className="mt-1 block text-text">
                {t(`flow.${step}`)}
              </strong>
            </li>
          ))}
        </ol>
      </CollapsibleSection>

      {orders.length === 0 ? (
        <Notice tone="muted" title={t("empty")} />
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {orders.map((order) => (
            <ProductionCard key={order.productionOrderId} order={order} />
          ))}
        </ul>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <EntityWriteForm
          mutationRef={createProductionOrderRef}
          legend={t("createTitle")}
          description={t("createHelp")}
          submitLabel={t("create")}
          requiredMessage={t("required")}
          testId="production-create-form"
          fields={[
            {
              name: "factoryPacketId",
              label: t("factoryPacketId"),
              kind: "text",
              required: true,
              monospace: true,
            },
            {
              name: "productionOrderNumber",
              label: t("orderNumber"),
              kind: "text",
              required: true,
              initialValue: "MO-",
            },
            {
              name: "outputItemId",
              label: t("outputItem"),
              kind: "select",
              required: true,
              options: itemOptions,
            },
            {
              name: "dueDate",
              label: t("dueDate"),
              kind: "text",
              required: true,
              placeholder: "2026-08-20",
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            factoryPacketId: values["factoryPacketId"] ?? "",
            productionOrderNumber: values["productionOrderNumber"] ?? "",
            outputItemId: values["outputItemId"] ?? "",
            dueAt: Date.parse(`${values["dueDate"] ?? ""}T12:00:00Z`),
          })}
        />
        <EntityWriteForm
          mutationRef={releaseProductionOrderRef}
          legend={t("releaseOrderTitle")}
          description={t("releaseOrderHelp")}
          submitLabel={t("releaseOrder")}
          requiredMessage={t("required")}
          testId="production-release-form"
          fields={[
            {
              name: "productionOrderId",
              label: t("productionOrder"),
              kind: "select",
              required: true,
              options: orderOptions,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            productionOrderId: values["productionOrderId"] ?? "",
          })}
        />
        <EntityWriteForm
          mutationRef={issueProductionMaterialRef}
          legend={t("issueTitle")}
          description={t("issueHelp")}
          submitLabel={t("issue")}
          requiredMessage={t("required")}
          testId="production-issue-form"
          fields={[
            {
              name: "productionOrderId",
              label: t("productionOrder"),
              kind: "select",
              required: true,
              options: orderOptions,
            },
            {
              name: "requirementId",
              label: t("requirementId"),
              kind: "text",
              required: true,
              monospace: true,
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
              label: t("quantityMinor"),
              kind: "number",
              required: true,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            productionOrderId: values["productionOrderId"] ?? "",
            productionMaterialRequirementId: values["requirementId"] ?? "",
            sourceBucketKey: values["sourceBucketKey"] ?? "",
            baseMinorUnits: Number(values["quantity"] ?? "0"),
          })}
        />
        <EntityWriteForm
          mutationRef={reportProductionOperationRef}
          legend={t("reportTitle")}
          description={t("reportHelp")}
          submitLabel={t("report")}
          requiredMessage={t("required")}
          testId="production-report-form"
          fields={[
            {
              name: "productionOrderId",
              label: t("productionOrder"),
              kind: "select",
              required: true,
              options: orderOptions,
            },
            {
              name: "sequence",
              label: t("operationSequence"),
              kind: "number",
              required: true,
            },
            { name: "good", label: t("good"), kind: "number", required: true },
            {
              name: "scrap",
              label: t("scrap"),
              kind: "number",
              required: true,
              initialValue: "0",
            },
            {
              name: "rework",
              label: t("rework"),
              kind: "number",
              required: true,
              initialValue: "0",
            },
            {
              name: "downtime",
              label: t("downtime"),
              kind: "number",
              required: true,
              initialValue: "0",
            },
            {
              name: "downtimeReason",
              label: t("downtimeReason"),
              kind: "text",

              importance: "secondary",
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            productionOrderId: values["productionOrderId"] ?? "",
            operationSequence: Number(values["sequence"] ?? "0"),
            goodBaseMinorUnits: Number(values["good"] ?? "0"),
            scrapBaseMinorUnits: Number(values["scrap"] ?? "0"),
            reworkBaseMinorUnits: Number(values["rework"] ?? "0"),
            downtimeMinutes: Number(values["downtime"] ?? "0"),
            ...(values["downtimeReason"]
              ? { downtimeReason: values["downtimeReason"] }
              : {}),
          })}
        />
        <EntityWriteForm
          mutationRef={receiveProductionOutputRef}
          legend={t("receiveTitle")}
          description={t("receiveHelp")}
          submitLabel={t("receive")}
          requiredMessage={t("required")}
          testId="production-receive-form"
          fields={[
            {
              name: "productionOrderId",
              label: t("productionOrder"),
              kind: "select",
              required: true,
              options: orderOptions,
            },
            {
              name: "outputLotId",
              label: t("outputLotId"),
              kind: "text",
              required: true,
              monospace: true,
            },
            {
              name: "destinationLocationId",
              label: t("destination"),
              kind: "select",
              required: true,
              options: locationOptions,
            },
            {
              name: "quantity",
              label: t("quantityMinor"),
              kind: "number",
              required: true,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            productionOrderId: values["productionOrderId"] ?? "",
            outputLotId: values["outputLotId"] ?? "",
            destinationLocationId: values["destinationLocationId"] ?? "",
            baseMinorUnits: Number(values["quantity"] ?? "0"),
          })}
        />
        <EntityWriteForm
          mutationRef={decideProductionOutputQualityRef}
          legend={t("qualityTitle")}
          description={t("qualityHelp")}
          submitLabel={t("qualityDecide")}
          requiredMessage={t("required")}
          testId="production-quality-form"
          fields={[
            {
              name: "receiptId",
              label: t("outputReceiptId"),
              kind: "text",
              required: true,
              monospace: true,
            },
            {
              name: "decision",
              label: t("decision"),
              kind: "select",
              required: true,
              options: [
                { value: "RELEASE", label: t("decisionRelease") },
                { value: "REJECT", label: t("decisionReject") },
              ],
            },
            {
              name: "note",
              label: t("qualityNote"),
              kind: "textarea",
              required: true,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            productionOutputReceiptId: values["receiptId"] ?? "",
            decision: (values["decision"] ?? "REJECT") as "RELEASE" | "REJECT",
            note: values["note"] ?? "",
          })}
        />
      </div>
    </section>
  );
}

function ProductionCard({ order }: { readonly order: ProductionOrderRow }) {
  const t = useTranslations("Production");
  const locale = useLocale() as AppLocale;
  const q = order.quantities;
  const percent = Math.min(100, Math.round((q.good / q.target) * 100));
  return (
    <li
      className="rounded-xl border border-border-strong bg-surface p-4"
      data-testid="production-order-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-mono text-lg font-bold text-text">
            {order.productionOrderNumber}
          </h3>
          <p className="mt-1 text-sm text-muted">
            {t("revision", { number: order.revisionNumber })} ·{" "}
            {formatInstantDate(order.dueAt, locale)}
          </p>
          {order.planningSource === undefined ? null : (
            <p className="mt-1 text-xs font-semibold text-accent">
              {t(`planningSource.${order.planningSource}`)}
            </p>
          )}
        </div>
        <StatusBadge
          tone={tone(order.status)}
          label={t(`status.${order.status}`)}
        />
      </div>
      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-raised"
        aria-label={t("progress", { percent })}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-sm sm:grid-cols-6">
        {(
          [
            "target",
            "good",
            "scrap",
            "rework",
            "received",
            "qcReleased",
          ] as const
        ).map((key) => (
          <div key={key} className="rounded bg-raised p-2">
            <dt className="text-xs text-muted">{t(`quantity.${key}`)}</dt>
            <dd className="mt-1 font-mono font-semibold text-text">
              {formatCount(q[key], locale)}
            </dd>
          </div>
        ))}
      </dl>
      <ol className="mt-4 flex flex-wrap gap-2" aria-label={t("route")}>
        {order.route.map((step) => (
          <li
            key={step.sequence}
            className="rounded border border-border px-2 py-1 text-xs text-text"
          >
            {step.sequence}. {step.operationCode} · {step.workCenterCode}
          </li>
        ))}
      </ol>
    </li>
  );
}
