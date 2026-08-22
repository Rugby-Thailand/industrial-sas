"use client";

/**
 * The inbound write controls.
 *
 * All of them go through `EntityWriteForm`, which is the Phase 2 contract: gate
 * first, mint one idempotency key per attempt, hold the key across a transport
 * failure so a retry replays, and report the ending in words. Receiving a pallet
 * twice because a handheld lost Wi-Fi mid-post is exactly the failure that
 * machinery exists to prevent, so the inbound forms do not get their own version
 * of it.
 *
 * What is specific to this file is the **fields**, and in a few places a wider
 * outcome: a receipt posting answers with its classification and where the stock
 * landed, and those are the two facts an operator at a dock actually needs. They
 * are surfaced by `ReceiptOutcomeNotice` rather than collapsed into "saved".
 *
 * The quality and putaway writes are not here — they are `QualityInspections`
 * and `PutawayTasks` — because importing one form from this file reaches all of
 * them, and a screen that only records a disposition has no use for the ordering
 * and receiving vocabularies this file carries.
 */
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

/** A quantity captured as two fields: the number, and the unit it is counted in. */
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

/**
 * Read a decimal quantity into integer minor units.
 *
 * The same three-decimal rule the server parses with (`ADR-0004`). Parsed from
 * the string rather than multiplied as a float, because `0.1 * 1000` is
 * `100.00000000000001` and the ledger stores integers. Anything unparseable
 * becomes `NaN`, which the server refuses by naming the field — the client does
 * not guess.
 */
export function toMinorUnits(text: string): number {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (match === null) return Number.NaN;
  return (
    Number(match[1] ?? "0") * 1000 + Number((match[2] ?? "").padEnd(3, "0"))
  );
}

/* -------------------------------------------------------------------------- */
/* Purchase orders                                                             */
/* -------------------------------------------------------------------------- */

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
                  // The empty control says which choice is outstanding, rather
                  // than repeating the label above it.
                  placeholder: t("selectSupplier"),
                  options: suppliers.map((supplier) => ({
                    value: supplier.supplierId,
                    // The code is what a buyer recognises; the ID is what the
                    // mutation needs. Showing one and sending the other is the whole
                    // point of a selector.
                    label: `${supplier.code} · ${supplier.name}`,
                  })),
                },
                {
                  name: "externalRef",
                  label: t("columnExternalRef"),
                  kind: "text",
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

/* -------------------------------------------------------------------------- */
/* Receiving                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Open a receipt.
 *
 * `chooseOrder` decides whether the operator picks the order here. The desk
 * screen opens a receipt without one in hand, so it chooses; the order-detail
 * screen and the handheld flow already know which order, and asking again would
 * be asking somebody to confirm what they just clicked.
 *
 * Either way the order is *selected*, never typed: a pre-filled document ID is
 * still a document ID somebody can corrupt with a keystroke.
 */
export function OpenReceiptForm({
  purchaseOrderId,
  onOpened,
  chooseOrder = false,
}: {
  readonly purchaseOrderId?: string | undefined;
  /**
   * The receipt the server just created.
   *
   * Handed to the caller rather than left for the operator to find, because the
   * next step posts against it: a handheld that made somebody read a Convex
   * document ID off one screen and type it into the next is a flow nobody
   * completes wearing gloves.
   */
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

/** The receipt-opening form itself, once the order question is settled. */
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

/**
 * Capture one received line.
 *
 * The field order is the order an operator works in: what came off the truck,
 * how much, which lot, when it expires.
 *
 * ### The item is scanned or chosen, never typed as an ID
 *
 * `postReceiptLine` takes an item's document ID, and an operator at a dock does
 * not have one. So the screen offers the two things they *do* have: the barcode
 * on the carton, resolved by the server against this tenant's catalogue, and a
 * list of the items the order actually asked for. The scan box sits outside the
 * form so a wedge scanner's Enter cannot post a half-filled line.
 *
 * A scan that resolves to something not on the order is named as such rather
 * than silently accepted: the ordinary path posts ordered items, and an
 * unexpected delivery goes through the exception a second person decides on
 * (`INV-0007-06`).
 *
 * Every domain rule stays on the server — the lot requirement, the unit
 * conversion, the tolerance. The form does not pre-check any of them, because a
 * second implementation of the tolerance in the browser would eventually
 * disagree with the one that decides.
 */
export function ReceiptLineForm({
  receiptId,
  lines,
  locationId,
}: {
  readonly receiptId: string;
  /** The order lines this receipt may post against. */
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

  // The SKU a person recognises, for an ID they never see. Falling back to the
  // ID keeps a newly created item legible rather than blank.
  const skuOf = (itemId: string) =>
    items.find((item) => item.itemId === itemId)?.sku ?? itemId;

  /*
   * The line the scan points at, if the order has one. A scan for an item the
   * order did not ask for leaves the form on its default line and is called out
   * above it — quietly switching to an unrelated line would be worse than not
   * reacting at all.
   */
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
            /*
             * Remounted when the scan changes, so the resolved line and item
             * become the form's starting values. Without the key the operator
             * would scan a carton and watch the form keep the previous item.
             */
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
                /*
                 * The items this order asked for, not the whole catalogue: the
                 * ordinary path refuses anything else, and offering the catalogue
                 * would be offering a refusal.
                 */
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

/**
 * Raise a receiving exception, so somebody else can post against it.
 *
 * The description says what the server enforces: the raiser and the receiver
 * must differ. An operator who reads that before pressing is an operator who
 * does not experience the denial as a bug.
 */
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
                  // `ORDERED` is absent: an ordinary receipt is not an exception,
                  // and raising one would create a maker for a posting that needs
                  // no second person.
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
                { name: "note", label: t("exceptionNote"), kind: "textarea" },
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

/* -------------------------------------------------------------------------- */
/* Labels                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Generate a label payload, or generate it again as a reprint.
 *
 * Two mutations behind one form, chosen by a control the operator can see. The
 * reprint is not a hidden retry: `label.print.reprint` is a distinct permission
 * and the stored `reason` is what an auditor reads, so the screen makes the
 * choice explicit rather than inferring it from how many jobs already exist.
 */
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
                /*
                 * Keyed by the mode so switching it remounts the form. Without the
                 * key, a `SAVED` notice from the first print would still be on
                 * screen under a button that now says "reprint", which reads as a
                 * reprint that already happened.
                 */
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
