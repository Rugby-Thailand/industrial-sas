"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import type { FormFieldSpec } from "@/components/masterData/EntityForm";
import { Notice } from "@/components/ui/Notice";
import {
  addPurchaseOrderLineRef,
  buildHandlingUnitRef,
  closeLineShortRef,
  createPurchaseOrderRef,
  generateLabelRef,
  openReceiptRef,
  postReceiptLineRef,
  raiseReceivingExceptionRef,
  reprintLabelRef,
  type PurchaseOrderLineRow,
} from "@/lib/convex/inboundApi";

import {
  ActiveItems,
  ActiveReasonCodes,
  ActiveSuppliers,
  PublishedLabelTemplates,
} from "./CatalogueOptions";
import type { ItemRow } from "@/lib/convex/masterDataApi";

import { OpenPurchaseOrders } from "./InboundOptions";
import { WithWarehouse } from "./InboundPrimitives";
import { ScanToItem, type ScannedItem } from "./ScanToItem";

import { EntityWriteForm } from "../masterData/EntityWriteForm";

const quantityFields = (
  quantityLabel: string,
  uomLabel: string,
): readonly FormFieldSpec[] => [
  {
    name: "quantity",
    label: quantityLabel,
    kind: "number",
    required: true,
    monospace: true,
  },
  {
    name: "uom",
    label: uomLabel,
    kind: "text",
    required: true,
    monospace: true,
  },
];

export function toMinorUnits(text: string): number {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (match === null) return Number.NaN;
  return (
    Number(match[1] ?? "0") * 1000 + Number((match[2] ?? "").padEnd(3, "0"))
  );
}

export function PurchaseOrderForm() {
  const t = useTranslations("Purchasing");
  const writeT = useTranslations("Write");

  return (
    <ActiveSuppliers
      emptyTitle={t("noSuppliers")}
      emptyBody={t("noSuppliersHint")}
      emptyTestId="purchasing-no-suppliers"
    >
      {(suppliers) => (
        <WithWarehouse
          render={(warehouseId) => (
            <EntityWriteForm
              presentation="inline"
              testId="form-purchase-order"
              mutationRef={createPurchaseOrderRef}
              legend={t("formLegend")}
              description={t("formDescription")}
              submitLabel={t("formSubmit")}
              requiredMessage={writeT("required")}
              fields={[
                {
                  name: "poNumber",
                  label: t("columnPoNumber"),
                  kind: "text",
                  required: true,
                  monospace: true,
                },
                {
                  name: "supplierId",
                  label: t("fieldSupplier"),
                  kind: "select",
                  required: true,

                  placeholder: t("selectSupplier"),
                  options: suppliers.map((supplier) => ({
                    value: supplier.supplierId,

                    label: `${supplier.code} · ${supplier.name}`,
                  })),
                },
                {
                  name: "externalRef",
                  label: t("columnExternalRef"),
                  kind: "text",

                  importance: "secondary",
                  monospace: true,
                },
              ]}
              toArgs={(values, requestId) => ({
                requestId,
                warehouseId,
                poNumber: values["poNumber"] ?? "",
                supplierId: values["supplierId"] ?? "",
                ...((values["externalRef"] ?? "") === ""
                  ? {}
                  : { externalRef: values["externalRef"] as string }),
              })}
            />
          )}
        />
      )}
    </ActiveSuppliers>
  );
}

export function PurchaseOrderLineForm({
  purchaseOrderId,
}: {
  readonly purchaseOrderId: string;
}) {
  const t = useTranslations("Purchasing");
  const receivingT = useTranslations("Receiving");
  const writeT = useTranslations("Write");

  return (
    <ActiveItems
      emptyTitle={t("noItems")}
      emptyBody={t("noItemsHint")}
      emptyTestId="purchasing-no-items"
    >
      {(items) => (
        <WithWarehouse
          render={(warehouseId) => (
            <EntityWriteForm
              presentation="inline"
              testId="form-order-line"
              mutationRef={addPurchaseOrderLineRef}
              legend={t("lineFormLegend")}
              description={t("lineFormDescription")}
              submitLabel={t("lineFormSubmit")}
              requiredMessage={writeT("required")}
              fields={[
                {
                  name: "lineNumber",
                  label: t("columnLineNumber"),
                  kind: "number",
                  required: true,
                  initialValue: "1",
                },
                {
                  name: "itemId",
                  label: t("fieldItem"),
                  kind: "select",
                  required: true,
                  placeholder: t("selectItem"),
                  options: items.map((item) => ({
                    value: item.itemId,
                    label: `${item.sku} · ${item.name}`,
                  })),
                },
                ...quantityFields(
                  receivingT("fieldQuantity"),
                  receivingT("fieldUom"),
                ),
              ]}
              toArgs={(values, requestId) => ({
                requestId,
                warehouseId,
                purchaseOrderId,
                lineNumber: Number(values["lineNumber"]),
                itemId: values["itemId"] ?? "",
                quantity: {
                  uom: (values["uom"] ?? "").toUpperCase(),
                  minorUnits: toMinorUnits(values["quantity"] ?? ""),
                },
              })}
            />
          )}
        />
      )}
    </ActiveItems>
  );
}

export function CloseLineShortForm({
  line,
}: {
  readonly line: PurchaseOrderLineRow;
}) {
  const t = useTranslations("Purchasing");
  const writeT = useTranslations("Write");

  return (
    <ActiveReasonCodes
      scope="ADJUSTMENT"
      emptyTitle={writeT("noReasonCodes")}
      emptyBody={writeT("noReasonCodesHint")}
      emptyTestId="close-short-no-reasons"
    >
      {(reasons) => (
        <WithWarehouse
          render={(warehouseId) => (
            <EntityWriteForm
              presentation="inline"
              testId="form-close-short"
              mutationRef={closeLineShortRef}
              legend={t("closeShort")}
              description={t("closeShortHint")}
              submitLabel={t("closeShort")}
              requiredMessage={writeT("required")}
              fields={[
                {
                  name: "reasonCodeId",
                  label: writeT("reasonCodeLabel"),
                  kind: "select",
                  required: true,
                  placeholder: writeT("selectReasonCode"),
                  options: reasons.map((reason) => ({
                    value: reason.reasonCodeId,
                    label: `${reason.code} · ${reason.name}`,
                  })),
                },
              ]}
              toArgs={(values, requestId) => ({
                requestId,
                warehouseId,
                purchaseOrderLineId: line.purchaseOrderLineId,
                reasonCodeId: values["reasonCodeId"] ?? "",
              })}
            />
          )}
        />
      )}
    </ActiveReasonCodes>
  );
}

export function OpenReceiptForm({
  purchaseOrderId,
  onOpened,
  chooseOrder = false,
}: {
  readonly purchaseOrderId?: string | undefined;

  readonly onOpened?: (receiptId: string) => void;
  readonly chooseOrder?: boolean;
}) {
  const t = useTranslations("Receiving");

  if (!chooseOrder) {
    return (
      <OpenReceiptFormBody
        {...(purchaseOrderId === undefined ? {} : { purchaseOrderId })}
        {...(onOpened === undefined ? {} : { onOpened })}
        orders={[]}
      />
    );
  }

  return (
    <OpenPurchaseOrders
      emptyTitle={t("noOpenOrders")}
      emptyBody={t("noOpenOrdersHint")}
      emptyTestId="receiving-no-open-orders"
    >
      {(orders) => (
        <OpenReceiptFormBody
          {...(purchaseOrderId === undefined ? {} : { purchaseOrderId })}
          {...(onOpened === undefined ? {} : { onOpened })}
          orders={orders}
        />
      )}
    </OpenPurchaseOrders>
  );
}

function OpenReceiptFormBody({
  purchaseOrderId,
  onOpened,
  orders,
}: {
  readonly purchaseOrderId?: string | undefined;
  readonly onOpened?: (receiptId: string) => void;
  readonly orders: readonly {
    readonly purchaseOrderId: string;
    readonly poNumber: string;
  }[];
}) {
  const t = useTranslations("Receiving");
  const purchasingT = useTranslations("Purchasing");
  const writeT = useTranslations("Write");

  return (
    <WithWarehouse
      render={(warehouseId) => (
        <EntityWriteForm
          presentation="inline"
          testId="form-open-receipt"
          mutationRef={openReceiptRef}
          legend={t("openFormLegend")}
          description={t("openFormDescription")}
          submitLabel={t("openFormSubmit")}
          requiredMessage={writeT("required")}
          fields={[
            {
              name: "receiptNumber",
              label: t("fieldReceiptNumber"),
              kind: "text",
              required: true,
              monospace: true,
            },
            ...(orders.length === 0
              ? []
              : [
                  {
                    name: "purchaseOrderId",
                    label: purchasingT("fieldOrder"),
                    kind: "select" as const,
                    required: true,
                    placeholder: purchasingT("selectOrder"),
                    options: orders.map((order) => ({
                      value: order.purchaseOrderId,
                      label: order.poNumber,
                    })),
                  },
                ]),
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            receiptNumber: values["receiptNumber"] ?? "",
            ...(() => {
              const chosen = values["purchaseOrderId"] ?? purchaseOrderId ?? "";
              return chosen === "" ? {} : { purchaseOrderId: chosen };
            })(),
          })}
          {...(onOpened === undefined
            ? {}
            : {
                onSaved: (outcome: Record<string, unknown>) => {
                  const value = outcome["value"] as
                    { readonly documentId?: string } | undefined;
                  if (value?.documentId !== undefined) {
                    onOpened(value.documentId);
                  }
                },
              })}
        />
      )}
    />
  );
}

export function ReceiptLineForm({
  receiptId,
  lines,
  locationId,
}: {
  readonly receiptId: string;

  readonly lines: readonly PurchaseOrderLineRow[];
  readonly locationId: string;
}) {
  const t = useTranslations("Receiving");

  if (lines.length === 0) {
    return (
      <Notice
        tone="muted"
        title={t("noOpenLines")}
        body={t("noOpenLinesHint")}
        testId="receiving-no-open-lines"
      />
    );
  }

  return (
    <ActiveItems
      emptyTitle={t("noItems")}
      emptyBody={t("noItemsHint")}
      emptyTestId="receiving-no-items"
    >
      {(items) => (
        <ScanToItem label={t("scanItem")} hint={t("scanItemHint")}>
          {(scanned) => (
            <ReceiptLineFormBody
              receiptId={receiptId}
              lines={lines}
              locationId={locationId}
              items={items}
              scanned={scanned}
            />
          )}
        </ScanToItem>
      )}
    </ActiveItems>
  );
}

function ReceiptLineFormBody({
  receiptId,
  lines,
  locationId,
  items,
  scanned,
}: {
  readonly receiptId: string;
  readonly lines: readonly PurchaseOrderLineRow[];
  readonly locationId: string;
  readonly items: readonly ItemRow[];
  readonly scanned: ScannedItem | undefined;
}) {
  const t = useTranslations("Receiving");
  const writeT = useTranslations("Write");

  const skuOf = (itemId: string) =>
    items.find((item) => item.itemId === itemId)?.sku ?? itemId;

  const scannedLine = lines.find((line) => line.itemId === scanned?.itemId);
  const defaultLine = scannedLine ?? lines[0];
  const notOnOrder = scanned !== undefined && scannedLine === undefined;

  return (
    <div className="flex flex-col gap-4">
      {notOnOrder ? (
        <Notice
          tone="warning"
          title={t("scanNotOnOrder")}
          body={t("scanNotOnOrderHint")}
          testId="receiving-scan-not-on-order"
        />
      ) : null}
      <WithWarehouse
        render={(warehouseId) => (
          <EntityWriteForm
            presentation="inline"
            key={scannedLine?.purchaseOrderLineId ?? "manual"}
            testId="form-receipt-line"
            mutationRef={postReceiptLineRef}
            legend={t("lineFormLegend")}
            description={t("lineFormDescription")}
            submitLabel={t("lineFormSubmit")}
            requiredMessage={writeT("required")}
            fields={[
              {
                name: "purchaseOrderLineId",
                label: t("fieldOrderLine"),
                kind: "select",
                required: true,
                placeholder: t("selectOrderLine"),
                options: lines.map((line) => ({
                  value: line.purchaseOrderLineId,
                  label: `#${line.lineNumber} · ${skuOf(line.itemId)}`,
                })),
                ...(defaultLine === undefined
                  ? {}
                  : { initialValue: defaultLine.purchaseOrderLineId }),
              },
              {
                name: "itemId",
                label: t("fieldItemChoice"),
                kind: "select",
                required: true,
                placeholder: t("selectItemChoice"),
                hint: t("fieldItemChoiceHint"),

                options: [...new Set(lines.map((line) => line.itemId))].map(
                  (itemId) => ({ value: itemId, label: skuOf(itemId) }),
                ),
                ...(defaultLine === undefined
                  ? {}
                  : { initialValue: defaultLine.itemId }),
              },
              ...quantityFields(t("fieldQuantity"), t("fieldUom")),
              {
                name: "lotCode",
                label: t("fieldLotCode"),
                kind: "text",
                monospace: true,
                hint: t("fieldLotHint"),
              },
              {
                name: "expirationDate",
                label: t("fieldExpirationDate"),
                kind: "text",

                importance: "secondary",
                monospace: true,
                placeholder: "2027-05-01",
              },
            ]}
            toArgs={(values, requestId) => ({
              requestId,
              warehouseId,
              receiptId,
              locationId,
              itemId: values["itemId"] ?? "",
              purchaseOrderLineId: values["purchaseOrderLineId"] ?? "",
              quantity: {
                uom: (values["uom"] ?? "").toUpperCase(),
                minorUnits: toMinorUnits(values["quantity"] ?? ""),
              },
              ...((values["lotCode"] ?? "") === ""
                ? {}
                : { lotCode: values["lotCode"] as string }),
              ...((values["expirationDate"] ?? "") === ""
                ? {}
                : { expirationDate: values["expirationDate"] as string }),
            })}
          />
        )}
      />
    </div>
  );
}

export function ReceivingExceptionForm() {
  const t = useTranslations("Receiving");
  const kindT = useTranslations("ReceiptLineKind");
  const writeT = useTranslations("Write");

  return (
    <ActiveReasonCodes
      scope="ADJUSTMENT"
      emptyTitle={writeT("noReasonCodes")}
      emptyBody={writeT("noReasonCodesHint")}
      emptyTestId="exception-no-reasons"
    >
      {(reasons) => (
        <WithWarehouse
          render={(warehouseId) => (
            <EntityWriteForm
              presentation="inline"
              testId="form-receiving-exception"
              mutationRef={raiseReceivingExceptionRef}
              legend={t("exceptionLegend")}
              description={t("exceptionDescription")}
              submitLabel={t("exceptionSubmit")}
              requiredMessage={writeT("required")}
              fields={[
                {
                  name: "kind",
                  label: t("exceptionKind"),
                  kind: "select",
                  required: true,
                  placeholder: t("selectExceptionKind"),

                  options: (
                    ["UNEXPECTED", "CANCELLED_LINE", "BLIND"] as const
                  ).map((kind) => ({ value: kind, label: kindT(kind) })),
                },
                {
                  name: "reasonCodeId",
                  label: writeT("reasonCodeLabel"),
                  kind: "select",
                  required: true,
                  placeholder: writeT("selectReasonCode"),
                  options: reasons.map((reason) => ({
                    value: reason.reasonCodeId,
                    label: `${reason.code} · ${reason.name}`,
                  })),
                },
                {
                  name: "note",
                  label: t("exceptionNote"),
                  kind: "textarea",

                  importance: "secondary",
                },
              ]}
              toArgs={(values, requestId) => ({
                requestId,
                warehouseId,
                kind: (values["kind"] ?? "BLIND") as
                  "UNEXPECTED" | "CANCELLED_LINE" | "BLIND",
                reasonCodeId: values["reasonCodeId"] ?? "",
                ...((values["note"] ?? "") === ""
                  ? {}
                  : { note: values["note"] as string }),
              })}
            />
          )}
        />
      )}
    </ActiveReasonCodes>
  );
}

export function BuildPalletForm({
  receiptLineIds,
  locationId,
}: {
  readonly receiptLineIds: readonly string[];
  readonly locationId: string;
}) {
  const t = useTranslations("Receiving");
  const writeT = useTranslations("Write");

  return (
    <WithWarehouse
      render={(warehouseId) => (
        <EntityWriteForm
          presentation="inline"
          testId="form-build-pallet"
          mutationRef={buildHandlingUnitRef}
          legend={t("palletLegend")}
          description={t("palletDescription")}
          submitLabel={t("palletSubmit")}
          requiredMessage={writeT("required")}
          fields={[
            {
              name: "lpn",
              label: t("fieldLpn"),
              kind: "text",
              required: true,
              monospace: true,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            lpn: values["lpn"] ?? "",
            locationId,
            receiptLineIds,
          })}
        />
      )}
    />
  );
}

export function LabelForm({
  targetKind,
  targetId,
}: {
  readonly targetKind: string;
  readonly targetId: string;
}) {
  const t = useTranslations("LabelEvidence");
  const receivingT = useTranslations("Receiving");
  const writeT = useTranslations("Write");
  const [reprint, setReprint] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <Notice
        tone="warning"
        title={t("printerBoundary")}
        body={t("printerBoundaryHint")}
        testId="printer-boundary"
      />
      <label className="flex min-h-touch items-center gap-3 text-sm font-medium">
        <input
          type="checkbox"
          checked={reprint}
          onChange={(event) => setReprint(event.target.checked)}
          data-testid="label-reprint-toggle"
          className="h-5 w-5"
        />
        {t("reprintSubmit")}
      </label>
      <PublishedLabelTemplates
        emptyTitle={receivingT("noTemplates")}
        emptyBody={receivingT("noTemplatesHint")}
        emptyTestId="label-no-templates"
      >
        {(templates) => (
          <WithWarehouse
            render={(warehouseId) => (
              <EntityWriteForm
                presentation="inline"
                key={reprint ? "reprint" : "initial"}
                testId="form-label"
                mutationRef={reprint ? reprintLabelRef : generateLabelRef}
                legend={t("generateLegend")}
                description={t("generateDescription")}
                submitLabel={reprint ? t("reprintSubmit") : t("generateSubmit")}
                requiredMessage={writeT("required")}
                fields={[
                  {
                    name: "labelTemplateId",
                    label: t("fieldTemplate"),
                    kind: "select",
                    required: true,
                    placeholder: t("selectTemplate"),
                    // Published versions only; the version is shown because a
                    // printed label cites the one that produced it.
                    options: templates.map((template) => ({
                      value: template.labelTemplateId,
                      label: `${template.code} v${template.version}`,
                    })),
                  },
                  {
                    name: "LPN",
                    label: "LPN",
                    kind: "text",
                    required: true,
                    monospace: true,
                  },
                  {
                    name: "SKU",
                    label: "SKU",
                    kind: "text",
                    required: true,
                    monospace: true,
                  },
                ]}
                toArgs={(values, requestId) => ({
                  requestId,
                  warehouseId,
                  labelTemplateId: values["labelTemplateId"] ?? "",
                  targetKind,
                  targetId,
                  fields: {
                    LPN: values["LPN"] ?? "",
                    SKU: values["SKU"] ?? "",
                  },
                })}
              />
            )}
          />
        )}
      </PublishedLabelTemplates>
    </div>
  );
}
