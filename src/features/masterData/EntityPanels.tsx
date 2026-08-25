"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import {
  BarcodesTable,
  ItemUomsTable,
  LabelTemplatesTable,
  LotsTable,
  StorageClassesTable,
  SuppliersTable,
} from "@/components/masterData/EntityTables";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { DEFAULT_LEDGER_PAGE_SIZE } from "@/lib/convex/ledgerApi";
import {
  createBarcodeRef,
  createItemUomRef,
  createLotRef,
  createStorageClassRef,
  createSupplierRef,
  deactivateBarcodeRef,
  deactivateItemUomRef,
  draftLabelTemplateRef,
  listBarcodesForItemRef,
  listItemUomsRef,
  listLabelTemplatesRef,
  listLotsForItemRef,
  listStorageClassesRef,
  listSuppliersRef,
  publishLabelTemplateRef,
  updateStorageClassRef,
  updateSupplierRef,
  type BarcodeRow,
  type ItemUomRow,
  type LabelTemplateRow,
  type LotRow,
  type StorageClassRow,
  type SupplierRow,
} from "@/lib/convex/masterDataApi";

import { EntityWriteForm } from "./EntityWriteForm";
import { MasterDataPanel } from "./MasterDataPanel";
import { RowActionButton, RowWriteRegion } from "./RowWriteRegion";

const pageArgs = (cursor: string | undefined) => ({
  maxPageSize: DEFAULT_LEDGER_PAGE_SIZE,
  ...(cursor === undefined ? {} : { cursor }),
});

export function SuppliersPanel() {
  const t = useTranslations("MasterData");

  return (
    <MasterDataPanel<SupplierRow, { maxPageSize?: number; cursor?: string }>
      queryRef={listSuppliersRef}
      scope="ORG"
      buildArgs={({ cursor }) => pageArgs(cursor)}
      renderRows={(rows) => (
        <RowWriteRegion mutationRef={updateSupplierRef}>
          {({ submit, busy }) => (
            <SuppliersTable
              rows={rows}
              renderAction={(row) => (
                <RowActionButton
                  busy={busy}
                  testId={`supplier-toggle-${row.code}`}
                  label={
                    row.status === "ACTIVE" ? t("deactivate") : t("reactivate")
                  }
                  onClick={() =>
                    submit(row.supplierId, (requestId) => ({
                      requestId,
                      supplierId: row.supplierId,
                      status: row.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                    }))
                  }
                />
              )}
            />
          )}
        </RowWriteRegion>
      )}
    />
  );
}

export function SupplierForm() {
  const t = useTranslations("MasterData");
  const writeT = useTranslations("Write");

  return (
    <EntityWriteForm
      testId="form-supplier"
      mutationRef={createSupplierRef}
      legend={t("supplierFormLegend")}
      description={t("supplierFormDescription")}
      submitLabel={t("supplierFormSubmit")}
      requiredMessage={writeT("required")}
      fields={[
        {
          name: "code",
          label: t("columnCode"),
          kind: "text",
          required: true,
          monospace: true,
          hint: t("codeHint"),
        },
        { name: "name", label: t("columnName"), kind: "text", required: true },
      ]}
      toArgs={(values, requestId) => ({
        requestId,
        code: values["code"] ?? "",
        name: values["name"] ?? "",
      })}
    />
  );
}

export function StorageClassesPanel() {
  const t = useTranslations("MasterData");

  return (
    <MasterDataPanel<StorageClassRow, { maxPageSize?: number; cursor?: string }>
      queryRef={listStorageClassesRef}
      scope="ORG"
      buildArgs={({ cursor }) => pageArgs(cursor)}
      renderRows={(rows) => (
        <RowWriteRegion mutationRef={updateStorageClassRef}>
          {({ submit, busy }) => (
            <StorageClassesTable
              rows={rows}
              renderAction={(row) => (
                <RowActionButton
                  busy={busy}
                  testId={`storage-class-toggle-${row.code}`}
                  label={
                    row.status === "ACTIVE" ? t("deactivate") : t("reactivate")
                  }
                  onClick={() =>
                    submit(row.storageClassId, (requestId) => ({
                      requestId,
                      storageClassId: row.storageClassId,
                      status: row.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                    }))
                  }
                />
              )}
            />
          )}
        </RowWriteRegion>
      )}
    />
  );
}

export function StorageClassForm() {
  const t = useTranslations("MasterData");
  const writeT = useTranslations("Write");

  return (
    <EntityWriteForm
      testId="form-storage-class"
      mutationRef={createStorageClassRef}
      legend={t("storageClassFormLegend")}
      description={t("storageClassFormDescription")}
      submitLabel={t("storageClassFormSubmit")}
      requiredMessage={writeT("required")}
      fields={[
        {
          name: "code",
          label: t("columnCode"),
          kind: "text",
          required: true,
          monospace: true,
          hint: t("codeHint"),
        },
        { name: "name", label: t("columnName"), kind: "text", required: true },
      ]}
      toArgs={(values, requestId) => ({
        requestId,
        code: values["code"] ?? "",
        name: values["name"] ?? "",
      })}
    />
  );
}

export function LabelTemplatesPanel() {
  const t = useTranslations("MasterData");

  return (
    <MasterDataPanel<
      LabelTemplateRow,
      { maxPageSize?: number; cursor?: string }
    >
      queryRef={listLabelTemplatesRef}
      scope="ORG"
      buildArgs={({ cursor }) => pageArgs(cursor)}
      renderRows={(rows) => (
        <RowWriteRegion mutationRef={publishLabelTemplateRef}>
          {({ submit, busy }) => (
            <LabelTemplatesTable
              rows={rows}

              renderAction={(row) =>
                row.status === "DRAFT" ? (
                  <RowActionButton
                    busy={busy}
                    testId={`template-publish-${row.code}-${row.version}`}
                    label={t("publish")}
                    onClick={() =>
                      submit(row.labelTemplateId, (requestId) => ({
                        requestId,
                        labelTemplateId: row.labelTemplateId,
                      }))
                    }
                  />
                ) : null
              }
            />
          )}
        </RowWriteRegion>
      )}
    />
  );
}

export function LabelTemplateForm() {
  const t = useTranslations("MasterData");
  const writeT = useTranslations("Write");

  return (
    <EntityWriteForm
      testId="form-label-template"
      mutationRef={draftLabelTemplateRef}
      legend={t("templateFormLegend")}
      description={t("templateFormDescription")}
      submitLabel={t("templateFormSubmit")}
      requiredMessage={writeT("required")}
      fields={[
        {
          name: "code",
          label: t("columnCode"),
          kind: "text",
          required: true,
          monospace: true,
          hint: t("codeHint"),
        },
        { name: "name", label: t("columnName"), kind: "text", required: true },
        {
          name: "format",
          label: t("columnFormat"),
          kind: "select",
          required: true,
          placeholder: t("selectFormat"),
          options: [
            { value: "ZPL", label: "ZPL" },
            { value: "PDF", label: "PDF" },
          ],
        },
        {
          name: "body",
          label: t("columnBody"),
          kind: "textarea",
          required: true,
          monospace: true,

          hint: t("bodyHint"),
          placeholder: "^XA\n^FO50,50^A0N,40,40^FD...^FS\n^XZ",
        },
      ]}
      toArgs={(values, requestId) => ({
        requestId,
        code: values["code"] ?? "",
        name: values["name"] ?? "",
        format: (values["format"] === "PDF" ? "PDF" : "ZPL") as "ZPL" | "PDF",
        body: values["body"] ?? "",
      })}
    />
  );
}

export function ItemBarcodesPanel({ itemId }: { readonly itemId: string }) {
  const t = useTranslations("MasterData");

  return (
    <MasterDataPanel<
      BarcodeRow,
      { itemId: string; maxPageSize?: number; cursor?: string }
    >
      queryRef={listBarcodesForItemRef}
      scope="ORG"
      buildArgs={({ cursor }) => ({ itemId, ...pageArgs(cursor) })}
      renderRows={(rows) => (
        <RowWriteRegion mutationRef={deactivateBarcodeRef}>
          {({ submit, busy }) => (
            <BarcodesTable
              rows={rows}

              renderAction={(row) =>
                row.status === "ACTIVE" ? (
                  <RowActionButton
                    busy={busy}
                    testId={`barcode-deactivate-${row.barcode}`}
                    label={t("deactivate")}
                    onClick={() =>
                      submit(row.barcodeId, (requestId) => ({
                        requestId,
                        barcodeId: row.barcodeId,
                      }))
                    }
                  />
                ) : null
              }
            />
          )}
        </RowWriteRegion>
      )}
    />
  );
}

export function BarcodeForm({ itemId }: { readonly itemId: string }) {
  const t = useTranslations("MasterData");
  const writeT = useTranslations("Write");
  const kindT = useTranslations("BarcodeKind");

  return (
    <EntityWriteForm
      testId="form-barcode"
      mutationRef={createBarcodeRef}
      legend={t("barcodeFormLegend")}
      description={t("barcodeFormDescription")}
      submitLabel={t("barcodeFormSubmit")}
      requiredMessage={writeT("required")}
      fields={[
        {
          name: "barcode",
          label: t("columnBarcode"),
          kind: "text",
          required: true,
          monospace: true,
          hint: t("barcodeHint"),
        },
        {
          name: "kind",
          label: t("columnBarcodeKind"),
          kind: "select",
          required: true,
          placeholder: t("selectBarcodeKind"),
          options: (["GTIN", "SSCC", "INTERNAL", "SUPPLIER"] as const).map(
            (kind) => ({ value: kind, label: kindT(kind) }),
          ),
        },
      ]}
      toArgs={(values, requestId) => ({
        requestId,
        itemId,
        barcode: values["barcode"] ?? "",
        kind: (values["kind"] ?? "GTIN") as
          "GTIN" | "SSCC" | "INTERNAL" | "SUPPLIER",
      })}
    />
  );
}

export function ItemUomsPanel({
  itemId,
  baseUom,
}: {
  readonly itemId: string;
  readonly baseUom: string;
}) {
  const t = useTranslations("MasterData");

  return (
    <MasterDataPanel<
      ItemUomRow,
      { itemId: string; maxPageSize?: number; cursor?: string }
    >
      queryRef={listItemUomsRef}
      scope="ORG"
      buildArgs={({ cursor }) => ({ itemId, ...pageArgs(cursor) })}
      renderRows={(rows) => (
        <RowWriteRegion mutationRef={deactivateItemUomRef}>
          {({ submit, busy }) => (
            <ItemUomsTable
              rows={rows}
              baseUom={baseUom}
              renderAction={(row) =>
                row.status === "ACTIVE" ? (
                  <RowActionButton
                    busy={busy}
                    testId={`uom-deactivate-${row.uom}`}
                    label={t("deactivate")}
                    onClick={() =>
                      submit(row.itemUomId, (requestId) => ({
                        requestId,
                        itemUomId: row.itemUomId,
                      }))
                    }
                  />
                ) : null
              }
            />
          )}
        </RowWriteRegion>
      )}
    />
  );
}

export function ItemUomForm({
  itemId,
  baseUom,
}: {
  readonly itemId: string;
  readonly baseUom: string;
}) {
  const t = useTranslations("MasterData");
  const writeT = useTranslations("Write");

  return (
    <EntityWriteForm
      testId="form-item-uom"
      mutationRef={createItemUomRef}
      legend={t("uomFormLegend")}
      description={t("uomFormDescription", { baseUom })}
      submitLabel={t("uomFormSubmit")}
      requiredMessage={writeT("required")}
      fields={[
        {
          name: "uom",
          label: t("columnUom"),
          kind: "text",
          required: true,
          monospace: true,
          hint: t("uomHint"),
        },
        {
          name: "toBaseNumerator",
          label: t("columnNumerator", { baseUom }),
          kind: "number",
          required: true,
          initialValue: "1",
        },
        {
          name: "toBaseDenominator",
          label: t("columnDenominator"),
          kind: "number",
          required: true,
          initialValue: "1",
          // Two integers rather than a decimal, because a factor like 200/3 has
          // no decimal expansion and the ledger stores it exactly (`ADR-0004`).
          hint: t("denominatorHint"),
        },
      ]}
      toArgs={(values, requestId) => ({
        requestId,
        itemId,
        uom: values["uom"] ?? "",

        toBaseNumerator: Number(values["toBaseNumerator"]),
        toBaseDenominator: Number(values["toBaseDenominator"]),
      })}
    />
  );
}

export function ItemLotsPanel({ itemId }: { readonly itemId: string }) {
  return (
    <MasterDataPanel<
      LotRow,
      { itemId: string; maxPageSize?: number; cursor?: string }
    >
      queryRef={listLotsForItemRef}
      scope="ORG"
      buildArgs={({ cursor }) => ({ itemId, ...pageArgs(cursor) })}
      renderRows={(rows) => <LotsTable rows={rows} />}
    />
  );
}

export function LotForm({ itemId }: { readonly itemId: string }) {
  const t = useTranslations("MasterData");
  const writeT = useTranslations("Write");

  return (
    <EntityWriteForm
      testId="form-lot"
      mutationRef={createLotRef}
      legend={t("lotFormLegend")}
      description={t("lotFormDescription")}
      submitLabel={t("lotFormSubmit")}
      requiredMessage={writeT("required")}
      fields={[
        {
          name: "lotCode",
          label: t("columnLotCode"),
          kind: "text",
          required: true,
          monospace: true,
          hint: t("codeHint"),
        },
        {
          name: "expirationDate",
          label: t("columnExpirationDate"),
          kind: "text",

          importance: "secondary",
          monospace: true,
          placeholder: "2026-12-31",

          hint: t("businessDateHint"),
        },
      ]}
      toArgs={(values, requestId) => ({
        requestId,
        itemId,
        lotCode: values["lotCode"] ?? "",
        ...((values["expirationDate"] ?? "") === ""
          ? {}
          : { expirationDate: values["expirationDate"] as string }),
      })}
    />
  );
}

export function PanelSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="mb-8 flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      {children}
    </section>
  );
}

export function useSelectedWarehouseId(): string | undefined {
  return useWorkspace().selectedWarehouseId;
}
