"use client";
import { useMemo, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  createTable,
  type ColumnDef,
  type CellContext,
} from "@tanstack/react-table";

import {
  ColumnFilter,
  type FilterControlsProps,
  filterLabel,
} from "./CatalogueFilterControls";
import { columns, sortColumn, type FilterColumn } from "./catalogueFilters";
import { unitNextAction } from "./unitNextAction";
import { FinishedGoodsMobileList } from "./FinishedGoodsMobileList";
import { useIsMobile } from "@/hooks/use-mobile";
import { ArrowUpRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableScroller } from "@/components/ui/TableScroller";
import { Link } from "@/i18n/navigation";
import type { FinishedGoodsList } from "@/lib/convex/finishedGoodsApi";
import {
  productPalletSummary,
  summaryFormatText,
  summaryStatusText,
} from "./productPalletSummary";
import {
  palletPath,
  palletDisplayStatus,
  productPath,
  Status,
  unitNoun,
  useFGText,
} from "./shared";

// Adapted from ReUI @reui/c-table-10: primary/secondary record text,
// compact status badges and a trailing action, using the app's existing tokens.
export function FinishedGoodsTable({
  tab,
  products,
  pallets,
  allProducts,
  allPallets,
  canManage,
  filterControls,
  productSummaries,
}: {
  tab: "products" | "pallets";
  products: FinishedGoodsList["products"];
  pallets: FinishedGoodsList["pallets"];
  allProducts: FinishedGoodsList["products"];
  allPallets: FinishedGoodsList["pallets"];
  canManage: boolean;
  filterControls?: FilterControlsProps;
  productSummaries?: Record<string, Parameters<typeof summaryFormatText>[0]>;
}) {
  const { t, tr } = useFGText();
  const mobile = useIsMobile();
  const isProduct = tab === "products";
  const title = isProduct
    ? t("copy.finished-goods-table")
    : t("copy.storage-units-table");
  if (mobile)
    return (
      <FinishedGoodsMobileList
        {...{
          tab,
          products,
          pallets,
          allProducts,
          allPallets,
          canManage,
        }}
        {...(productSummaries ? { productSummaries } : {})}
      />
    );
  const rows = isProduct
    ? products.map((product) => {
        const summary =
          productSummaries?.[product._id] ??
          productPalletSummary(product._id, allPallets, product.storageFormat);

        return {
          id: product._id,
          cells: [
            <>
              <Link
                href={productPath(product._id)}
                className="font-medium break-words hover:underline"
              >
                {product.name || t("copy.untitled-draft")}
              </Link>
              <p className="mt-1 font-mono text-xs break-all text-muted">
                {product.sku || t("copy.no-sku-yet")}
              </p>
            </>,
            <>
              {summary.quantity} {product.unit}
            </>,
            <>{summaryFormatText(summary, tr)}</>,
            <>{summaryStatusText(summary, tr) || "—"}</>,
            <>
              <Status value={product.status} />
            </>,
            <>
              <Button asChild variant="ghost" size="icon">
                <Link
                  href={productPath(product._id)}
                  aria-label={`${canManage ? t("copy.edit") : t("copy.view")} ${product.sku || product.name}`}
                  title={
                    canManage ? t("copy.edit-product") : t("copy.view-product")
                  }
                >
                  {canManage ? (
                    <Pencil className="size-4" aria-hidden="true" />
                  ) : (
                    <ArrowUpRight className="size-4" aria-hidden="true" />
                  )}
                </Link>
              </Button>
            </>,
          ],
        };
      })
    : pallets.map((pallet) => {
        const product =
          allProducts.find((p) => p._id === pallet.productId) ??
          ("productName" in pallet
            ? {
                name: String(pallet.productName),
                sku: "sku" in pallet ? String(pallet.sku) : "",
                unit: "unit" in pallet ? String(pallet.unit) : "",
                storageFormat: pallet.storageFormat,
              }
            : undefined);
        const action = unitNextAction(pallet, canManage);

        return {
          id: pallet._id,
          cells: [
            <>
              <Link
                href={palletPath(pallet._id)}
                className="font-mono font-medium hover:underline"
              >
                {pallet.code}
              </Link>
              <p className="mt-1 text-xs text-muted">
                {unitNoun(pallet.storageFormat ?? product?.storageFormat, tr)}
              </p>
              <p className="mt-1 text-xs break-words text-muted">
                {product ? `${product.sku} · ${product.name}` : "—"}
              </p>
            </>,
            <>
              {pallet.quantity} {product?.unit ?? ""}
            </>,
            <>
              {pallet.lengthMm && pallet.widthMm && pallet.heightMm
                ? `${pallet.lengthMm / 1000} × ${pallet.widthMm / 1000} × ${pallet.heightMm / 1000} m`
                : t("copy.not-measured")}
            </>,
            <>{pallet.lot || "—"}</>,
            <>
              <Status value={palletDisplayStatus(pallet)} />
            </>,
            <>
              <Button asChild variant="outline">
                <Link
                  href={action.href}
                  aria-label={`${tr(...action.label)} ${pallet.code}`}
                >
                  {tr(...action.label)}
                </Link>
              </Button>
            </>,
          ],
        };
      });
  return (
    <DesktopCatalogueTable
      title={title}
      tab={tab}
      rows={rows}
      {...(filterControls ? { filterControls } : {})}
    />
  );
}
type CatalogueRow = { id: string; cells: ReactNode[] };
function CatalogueCell({ getValue }: CellContext<CatalogueRow, unknown>) {
  return <>{getValue<ReactNode>()}</>;
}
function CatalogueColumnHeader({
  column,
  tab,
  filterControls,
}: {
  column: FilterColumn;
  tab: "products" | "pallets";
  filterControls?: FilterControlsProps;
}) {
  const { t, tr } = useFGText();
  const label =
    column === "quantity" && tab === "products"
      ? t("copy.total-in-storage-units")
      : filterLabel(column, tab, tr);
  return filterControls ? (
    <ColumnFilter {...filterControls} column={column}>
      {label}
    </ColumnFilter>
  ) : (
    label
  );
}
function DesktopCatalogueTable({
  title,
  tab,
  rows,
  filterControls,
}: {
  title: string;
  tab: "products" | "pallets";
  rows: CatalogueRow[];
  filterControls?: FilterControlsProps;
}) {
  // This manual table has no internal UI state: create a fresh engine when
  // the authoritative page or column definitions change.
  // Convex owns complete-result filtering, sorting and cursor boundaries.
  const { t } = useFGText();
  const definitions = useMemo<ColumnDef<CatalogueRow>[]>(
    () => [
      ...columns(tab).map((column, index) => ({
        id: column,
        accessorFn: (row: CatalogueRow) => row.cells[index],
        cell: CatalogueCell,
      })),
      {
        id: "actions",
        accessorFn: (row: CatalogueRow) => row.cells[5],
        cell: CatalogueCell,
      },
    ],
    [tab],
  );
  const sorted = filterControls
    ? sortColumn(filterControls.filters.sort)
    : undefined;
  const table = useMemo(() => {
    const engine = createTable<CatalogueRow>({
      onStateChange: () => {},
      renderFallbackValue: null,
      data: rows,
      columns: definitions,
      getRowId: (row) => row.id,
      getCoreRowModel: getCoreRowModel(),
      manualSorting: true,
      manualFiltering: true,
      manualPagination: true,
      pageCount: -1,
      state: {
        sorting: sorted
          ? [
              {
                id: sorted,
                desc: filterControls!.filters.sort.endsWith(":desc"),
              },
            ]
          : [],
      },
    });
    engine.setOptions((previous) => ({
      ...previous,
      state: { ...engine.initialState, ...previous.state },
    }));
    return engine;
  }, [rows, definitions, sorted, filterControls]);

  return (
    <TableScroller label={title}>
      <Table scroll={false} aria-label={title} className="min-w-[720px]">
        <TableHeader>
          <TableRow className="bg-surface">
            {table.getFlatHeaders().map((header, index) => (
              <TableHead
                key={header.id}
                className={
                  header.id === "actions"
                    ? "pr-4 text-right"
                    : index === 0
                      ? "pl-4"
                      : ""
                }
                aria-sort={
                  header.column.getIsSorted() === "desc"
                    ? "descending"
                    : header.column.getIsSorted() === "asc"
                      ? "ascending"
                      : undefined
                }
              >
                {header.column.id === "actions" ? (
                  <span className="sr-only">{t("copy.actions")}</span>
                ) : (
                  <CatalogueColumnHeader
                    column={columns(tab)[index]!}
                    tab={tab}
                    {...(filterControls ? { filterControls } : {})}
                  />
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell, index) => (
                <TableCell
                  key={cell.id}
                  className={
                    cell.column.id === "actions"
                      ? "pr-4 text-right"
                      : index === 0
                        ? "max-w-80 py-2 pl-4 whitespace-normal"
                        : ""
                  }
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableScroller>
  );
}
