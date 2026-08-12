"use client";

/**
 * The import workbench's two small pieces.
 *
 * Separate from `ImportWorkbench` because the chunk form owns a decision the
 * workbench should not: **when the cursor advances**. On a real deployment the
 * cursor comes from the server's answer, and in preview it advances locally so
 * the resume path can be walked — with a notice that says nothing was stored.
 * Putting both in the workbench would bury that distinction inside a screen that
 * is otherwise about layout.
 */
import { useTranslations } from "next-intl";

import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { applyPurchaseOrderImportChunkRef } from "@/lib/convex/inboundApi";
import { DEFAULT_CHUNK_SIZE } from "@/lib/inbound/importChunking";

import { OpenPurchaseOrders } from "./InboundOptions";
import { EntityWriteForm } from "../masterData/EntityWriteForm";

/** A section heading. `PageHeader` owns the `<h1>`; sections start at `<h2>`. */
export function InboundSectionHeading({ title }: { readonly title: string }) {
  return <h2 className="text-lg font-semibold text-text">{title}</h2>;
}

/**
 * Write one bounded chunk, and advance the cursor from what the server said.
 *
 * The cursor is taken from the mutation's own `nextCursor`, never accumulated by
 * the client. A replayed chunk answers with the same cursor it would have
 * answered with the first time, so a reconnect mid-import resumes at the right
 * row instead of skipping or repeating one.
 */
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
          testId="form-import-chunk"
          mutationRef={applyPurchaseOrderImportChunkRef}
          legend={t("importApplyLegend")}
          description={t("importApplyDescription")}
          submitLabel={t("importApply")}
          requiredMessage={writeT("required")}
          fields={[
            {
              /*
               * Chosen, not typed. The import writes lines into an order that
               * already exists, and a text box here would ask an operator for a
               * Convex document ID — which they would paste from a URL or guess.
               */
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
            /*
             * `nextCursor` is `null` when the chunk was the last one. Advancing to
             * `total` rather than leaving the cursor where it was is what makes the
             * screen say "complete" instead of offering a chunk with nothing in it.
             */
            const value = outcome["value"] as
              { readonly nextCursor?: number | null } | undefined;
            const next = value?.nextCursor;
            onAdvance(typeof next === "number" ? next : total);
          }}
          onDemonstrated={() => {
            // Preview walks the same arithmetic the server would, so the resume path
            // is reviewable. The outcome notice says nothing was stored.
            onAdvance(Math.min(total, cursor + DEFAULT_CHUNK_SIZE));
          }}
        />
      )}
    </OpenPurchaseOrders>
  );
}
