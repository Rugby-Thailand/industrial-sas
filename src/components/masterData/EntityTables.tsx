"use client";

/**
 * The six new master-data collections, as columns.
 *
 * One file because they share the status vocabulary and the tone map, and a
 * per-entity file would have copied both. The structure lives in `EntityTable`;
 * what is here is the decision about *which* facts each screen shows, which is
 * the part that differs and the part worth reviewing.
 */
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

import { EntityTable, type ColumnSpec } from "./EntityTable";

const STATUS_TONES: Readonly<Record<string, BadgeTone>> = {
  ACTIVE: "success",
  INACTIVE: "muted",
};

/**
 * A draft is `pending`, not `neutral`.
 *
 * A draft cannot print: it has not been published, and publishing needs a second
 * person (`INV-0006-05`). Showing it as an ordinary state would leave an
 * operator waiting for a label that will never come out of the printer.
 */
const TEMPLATE_TONES: Readonly<Record<string, BadgeTone>> = {
  DRAFT: "pending",
  ACTIVE: "success",
  RETIRED: "muted",
};

/**
 * `GTIN` is `accent` because it is the only kind whose check digit this
 * repository verifies; the rest are recorded as printed and are not vouched for.
 */
const BARCODE_TONES: Readonly<Record<string, BadgeTone>> = {
  GTIN: "accent",
  SSCC: "neutral",
  INTERNAL: "neutral",
  SUPPLIER: "muted",
};

const statusCell = <Row extends { readonly status: string }>(
  header: string,
  translate: CodeTranslator,
  tones: Readonly<Record<string, BadgeTone>> = STATUS_TONES,
): ColumnSpec<Row> => ({
  key: "status",
  header,
  render: (row) => (
    <StatusBadge
      tone={tones[row.status] ?? "neutral"}
      label={codeLabel(translate, row.status)}
    />
  ),
});

/* -------------------------------------------------------------------------- */
/* Suppliers and storage classes                                               */
/* -------------------------------------------------------------------------- */

export function SuppliersTable({
  rows,
  renderAction,
}: {
  readonly rows: readonly SupplierRow[];
  readonly renderAction?: (row: SupplierRow) => ReactNode;
}) {
  const t = useTranslations("MasterData");
  const statusT = useTranslations(
    "MasterDataStatus",
  ) as unknown as CodeTranslator;

  return (
    <EntityTable<SupplierRow>
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
        statusCell<SupplierRow>(t("columnStatus"), statusT),
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnAction"), renderAction })}
    />
  );
}

export function StorageClassesTable({
  rows,
  renderAction,
}: {
  readonly rows: readonly StorageClassRow[];
  readonly renderAction?: (row: StorageClassRow) => ReactNode;
}) {
  const t = useTranslations("MasterData");
  const statusT = useTranslations(
    "MasterDataStatus",
  ) as unknown as CodeTranslator;

  return (
    <EntityTable<StorageClassRow>
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
        statusCell<StorageClassRow>(t("columnStatus"), statusT),
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnAction"), renderAction })}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Item-scoped collections                                                     */
/* -------------------------------------------------------------------------- */

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
    <EntityTable<BarcodeRow>
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

/**
 * A conversion is shown as the exact ratio that is stored, not as a decimal.
 *
 * `200/3` litres per third-drum has no decimal expansion, and rounding it for
 * display would put a number on the screen that the ledger will never agree
 * with. When the denominator is one — which it usually is — the fraction is
 * dropped, because `12/1` reads as a defect.
 */
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
  /** The item's base unit. Every factor on this table is "to base". */
  readonly baseUom: string;
  readonly renderAction?: (row: ItemUomRow) => ReactNode;
}) {
  const t = useTranslations("MasterData");
  const statusT = useTranslations(
    "MasterDataStatus",
  ) as unknown as CodeTranslator;

  return (
    <EntityTable<ItemUomRow>
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
    <EntityTable<LotRow>
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
          /*
           * The stored business date, verbatim. It is already an ISO date in the
           * warehouse's own timezone (`ADR-0011`), and re-formatting it through
           * a locale would risk showing a different day than the one the ledger
           * posted against.
           */
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

/* -------------------------------------------------------------------------- */
/* Label templates                                                             */
/* -------------------------------------------------------------------------- */

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
    <EntityTable<LabelTemplateRow>
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
          // A count of published revisions, not an opaque handle: a printed
          // label cites the version that produced it.
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
          TEMPLATE_TONES,
        ),
      ]}
      {...(renderAction === undefined
        ? {}
        : { actionHeader: t("columnAction"), renderAction })}
    />
  );
}
