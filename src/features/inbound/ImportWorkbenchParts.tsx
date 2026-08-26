"use client";

import { useTranslations } from "next-intl";

import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { applyPurchaseOrderImportChunkRef } from "@/lib/convex/inboundApi";

import { OpenPurchaseOrders } from "./InboundOptions";
import { EntityWriteForm } from "../masterData/EntityWriteForm";

export function InboundSectionHeading({ title }: { readonly title: string }) {
  return <h2 className="text-lg font-semibold text-text">{title}</h2>;
}

export function ImportChunkForm({
  batchRef,
  text,
  cursor,
  total,
  onAdvance,
}: {
  readonly batchRef: string;
  readonly text: string;
  readonly cursor: number;
  readonly total: number;
  readonly onAdvance: (next: number) => void;
}) {
  const t = useTranslations("Purchasing");
  const receivingT = useTranslations("Receiving");
  const writeT = useTranslations("Write");
  const warehouseId = useWorkspace().selectedWarehouseId;

  if (warehouseId === undefined) {
    return <LedgerPanelStatus state={{ kind: "WAREHOUSE_MISSING" }} />;
  }

  return (
    <OpenPurchaseOrders
      emptyTitle={receivingT("noOpenOrders")}
      emptyBody={receivingT("noOpenOrdersHint")}
      emptyTestId="import-no-open-orders"
    >
      {(orders) => (
        <EntityWriteForm
          presentation="inline"
          testId="form-import-chunk"
          mutationRef={applyPurchaseOrderImportChunkRef}
          legend={t("importApplyLegend")}
          description={t("importApplyDescription")}
          submitLabel={t("importApply")}
          requiredMessage={writeT("required")}
          fields={[
            {
              name: "purchaseOrderId",
              label: t("fieldOrder"),
              kind: "select",
              required: true,
              placeholder: t("selectOrder"),
              options: orders.map((order) => ({
                value: order.purchaseOrderId,
                label: order.poNumber,
              })),
              hint: t("importOrderHint"),
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            purchaseOrderId: values["purchaseOrderId"] ?? "",
            batchRef,
            text,
            cursor,
          })}
          onSaved={(outcome) => {
            const value = outcome["value"] as
              { readonly nextCursor?: number | null } | undefined;
            const next = value?.nextCursor;
            onAdvance(typeof next === "number" ? next : total);
          }}
        />
      )}
    </OpenPurchaseOrders>
  );
}
