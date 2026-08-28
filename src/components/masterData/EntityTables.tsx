"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import type {
  BarcodeRow,
  ItemUomRow,
  LabelTemplateRow,
  LotRow,
  StorageClassRow,
  SupplierRow,
} from "@/lib/convex/masterDataApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";
import { UNRENDERABLE } from "@/lib/formatters";

import { DataTable, type DataTableColumn } from "@/components/table/DataTable";

const STATUS_TONES: Readonly<Record<string, BadgeTone>> = {
  ACTIVE: "success",
  INACTIVE: "muted",
};

const TEMPLATE_TONES: Readonly<Record<string, BadgeTone>> = {
  DRAFT: "pending",
  ACTIVE: "success",
  RETIRED: "muted",
};

const BARCODE_TONES: Readonly<Record<string, BadgeTone>> = {
  GTIN: "accent",
  SSCC: "neutral",
  INTERNAL: "neutral",
  SUPPLIER: "muted",
};

const statusCell = <Row extends { readonly status: string }>(
  header: string,
  translate: CodeTranslator,
  renderStatus?: (row: Row) => ReactNode,
  tones: Readonly<Record<string, BadgeTone>> = STATUS_TONES,
): DataTableColumn<Row> => ({
  key: "status",
  header,
  render: (row) =>
    renderStatus?.(row) ?? (
      <StatusBadge
        tone={tones[row.status] ?? "neutral"}
        label={codeLabel(translate, row.status)}
      />
    ),
});

export function SuppliersTable({
  rows,
  renderStatus,
  renderAction,
}: {
  readonly rows: readonly SupplierRow[];
  readonly renderStatus?: (row: SupplierRow) => ReactNode;
  readonly renderAction?: (row: SupplierRow) => ReactNode;
}) {
  const t = useTranslations("MasterData");
  const statusT = useTranslations(
    "MasterDataStatus",
  ) as unknown as CodeTranslator;

  return (
    <DataTable<SupplierRow>
      testId="table-suppliers"
      caption={t("suppliersCaption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => row.supplierId}
      columns={[
        {
          key: "code",
          header: t("columnCode"),
          rowHeader: true,
          render: (row) => row.code,
        },
        { key: "name", header: t("columnName"), render: (row) => row.name },
        statusCell<SupplierRow>(t("columnStatus"), statusT, renderStatus),
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnAction"), renderAction })}
    />
  );
}

export function StorageClassesTable({
  rows,
  renderStatus,
  renderAction,
}: {
  readonly rows: readonly StorageClassRow[];
  readonly renderStatus?: (row: StorageClassRow) => ReactNode;
  readonly renderAction?: (row: StorageClassRow) => ReactNode;
}) {
  const t = useTranslations("MasterData");
  const statusT = useTranslations(
    "MasterDataStatus",
  ) as unknown as CodeTranslator;

  return (
    <DataTable<StorageClassRow>
      testId="table-storage-classes"
      caption={t("storageClassesCaption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => row.storageClassId}
      columns={[
        {
          key: "code",
          header: t("columnCode"),
          rowHeader: true,
          render: (row) => row.code,
        },
        { key: "name", header: t("columnName"), render: (row) => row.name },
        statusCell<StorageClassRow>(t("columnStatus"), statusT, renderStatus),
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnAction"), renderAction })}
    />
  );
}

export function BarcodesTable({
  rows,
  renderAction,
}: {
  readonly rows: readonly BarcodeRow[];
  readonly renderAction?: (row: BarcodeRow) => ReactNode;
}) {
  const t = useTranslations("MasterData");
  const statusT = useTranslations(
    "MasterDataStatus",
  ) as unknown as CodeTranslator;
  const kindT = useTranslations("BarcodeKind") as unknown as CodeTranslator;

  return (
    <DataTable<BarcodeRow>
      testId="table-barcodes"
      caption={t("barcodesCaption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => row.barcodeId}
      columns={[
        {
          key: "barcode",
          header: t("columnBarcode"),
          rowHeader: true,
          render: (row) => row.barcode,
        },
        {
          key: "kind",
          header: t("columnBarcodeKind"),
          render: (row) => (
            <StatusBadge
              tone={BARCODE_TONES[row.kind] ?? "neutral"}
              label={codeLabel(kindT, row.kind)}
            />
          ),
        },
        statusCell<BarcodeRow>(t("columnStatus"), statusT),
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnAction"), renderAction })}
    />
  );
}

// Keep ratios exact; decimal formatting would invent rounded values.
export const conversionLabel = (row: ItemUomRow): string =>
  row.toBaseDenominator === 1
    ? String(row.toBaseNumerator)
    : `${row.toBaseNumerator}/${row.toBaseDenominator}`;

export function ItemUomsTable({
  rows,
  baseUom,
  renderAction,
}: {
  readonly rows: readonly ItemUomRow[];

  readonly baseUom: string;
  readonly renderAction?: (row: ItemUomRow) => ReactNode;
}) {
  const t = useTranslations("MasterData");
  const statusT = useTranslations(
    "MasterDataStatus",
  ) as unknown as CodeTranslator;

  return (
    <DataTable<ItemUomRow>
      testId="table-item-uoms"
      caption={t("itemUomsCaption", { count: rows.length, baseUom })}
      rows={rows}
      rowKey={(row) => row.itemUomId}
      columns={[
        {
          key: "uom",
          header: t("columnUom"),
          rowHeader: true,
          render: (row) => row.uom,
        },
        {
          key: "factor",
          header: t("columnConversion", { baseUom }),
          monospace: true,
          render: (row) => conversionLabel(row),
        },
        statusCell<ItemUomRow>(t("columnStatus"), statusT),
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnAction"), renderAction })}
    />
  );
}

export function LotsTable({ rows }: { readonly rows: readonly LotRow[] }) {
  const t = useTranslations("MasterData");
  const statusT = useTranslations(
    "MasterDataStatus",
  ) as unknown as CodeTranslator;

  return (
    <DataTable<LotRow>
      testId="table-lots"
      caption={t("lotsCaption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => row.lotId}
      columns={[
        {
          key: "lotCode",
          header: t("columnLotCode"),
          rowHeader: true,
          render: (row) => row.lotCode,
        },
        {
          key: "manufactureDate",
          header: t("columnManufactureDate"),
          monospace: true,

          render: (row) => row.manufactureDate ?? UNRENDERABLE,
        },
        {
          key: "expirationDate",
          header: t("columnExpirationDate"),
          monospace: true,
          render: (row) => row.expirationDate ?? UNRENDERABLE,
        },
        statusCell<LotRow>(t("columnStatus"), statusT),
      ]}
    />
  );
}

export function LabelTemplatesTable({
  rows,
  renderAction,
}: {
  readonly rows: readonly LabelTemplateRow[];
  readonly renderAction?: (row: LabelTemplateRow) => ReactNode;
}) {
  const t = useTranslations("MasterData");
  const statusT = useTranslations(
    "LabelTemplateStatus",
  ) as unknown as CodeTranslator;

  return (
    <DataTable<LabelTemplateRow>
      testId="table-label-templates"
      caption={t("labelTemplatesCaption", { count: rows.length })}
      rows={rows}
      rowKey={(row) => row.labelTemplateId}
      columns={[
        {
          key: "code",
          header: t("columnCode"),
          rowHeader: true,
          render: (row) => row.code,
        },
        {
          key: "version",
          header: t("columnVersion"),
          monospace: true,

          render: (row) => String(row.version),
        },
        { key: "name", header: t("columnName"), render: (row) => row.name },
        {
          key: "format",
          header: t("columnFormat"),
          monospace: true,
          render: (row) => row.format,
        },
        statusCell<LabelTemplateRow>(
          t("columnStatus"),
          statusT,
          undefined,
          TEMPLATE_TONES,
        ),
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnAction"), renderAction })}
    />
  );
}
