"use client";

import {
  ColumnFilter,
  type FilterControlsProps,
  filterLabel,
} from "./CatalogueFilterControls";
import { columns, sortColumn } from "./catalogueFilters";
import { unitNextAction } from "./unitNextAction";
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
  const isProduct = tab === "products";
  const title = isProduct
    ? t("copy.finished-goods-table")
    : t("copy.storage-units-table");
  return (
    <TableScroller label={title}>
      <Table scroll={false} aria-label={title} className="min-w-[720px]">
        <TableHeader>
          <TableRow className="bg-surface">
            {columns(tab).map((column, index) => {
              const label =
                column === "quantity" && isProduct
                  ? t("copy.total-in-storage-units")
                  : filterLabel(column, tab, tr);
              const sorted =
                filterControls &&
                sortColumn(filterControls.filters.sort) === column;
              return (
                <TableHead
                  key={column}
                  className={index === 0 ? "pl-4" : ""}
                  aria-sort={
                    sorted
                      ? filterControls.filters.sort.endsWith(":desc")
                        ? "descending"
                        : "ascending"
                      : undefined
                  }
                >
                  {filterControls ? (
                    <ColumnFilter {...filterControls} column={column}>
                      {label}
                    </ColumnFilter>
                  ) : (
                    label
                  )}
                </TableHead>
              );
            })}
            <TableHead className="pr-4 text-right">
              <span className="sr-only">{t("copy.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isProduct
            ? products.map((product) => {
                const summary =
                  productSummaries?.[product._id] ??
                  productPalletSummary(
                    product._id,
                    allPallets,
                    product.storageFormat,
                  );
                return (
                  <TableRow key={product._id}>
                    <TableCell className="max-w-80 py-4 pl-4 whitespace-normal">
                      <Link
                        href={productPath(product._id)}
                        className="font-medium break-words hover:underline"
                      >
                        {product.name || t("copy.untitled-draft")}
                      </Link>
                      <p className="mt-1 font-mono text-xs break-all text-muted">
                        {product.sku || t("copy.no-sku-yet")}
                      </p>
                    </TableCell>
                    <TableCell>
                      {summary.quantity} {product.unit}
                    </TableCell>
                    <TableCell>{summaryFormatText(summary, tr)}</TableCell>
                    <TableCell>
                      {summaryStatusText(summary, tr) || "—"}
                    </TableCell>
                    <TableCell>
                      <Status value={product.status} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button asChild variant="ghost" size="icon">
                        <Link
                          href={productPath(product._id)}
                          aria-label={`${canManage ? t("copy.edit") : t("copy.view")} ${product.sku || product.name}`}
                          title={
                            canManage
                              ? t("copy.edit-product")
                              : t("copy.view-product")
                          }
                        >
                          {canManage ? (
                            <Pencil className="size-4" aria-hidden="true" />
                          ) : (
                            <ArrowUpRight
                              className="size-4"
                              aria-hidden="true"
                            />
                          )}
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
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
                return (
                  <TableRow key={pallet._id}>
                    <TableCell className="max-w-80 py-4 pl-4 whitespace-normal">
                      <Link
                        href={palletPath(pallet._id)}
                        className="font-mono font-medium hover:underline"
                      >
                        {pallet.code}
                      </Link>
                      <p className="mt-1 text-xs text-muted">
                        {unitNoun(
                          pallet.storageFormat ?? product?.storageFormat,
                          tr,
                        )}
                      </p>
                      <p className="mt-1 text-xs break-words text-muted">
                        {product ? `${product.sku} · ${product.name}` : "—"}
                      </p>
                    </TableCell>
                    <TableCell>
                      {pallet.quantity} {product?.unit ?? ""}
                    </TableCell>
                    <TableCell>
                      {pallet.lengthMm && pallet.widthMm && pallet.heightMm
                        ? `${pallet.lengthMm / 1000} × ${pallet.widthMm / 1000} × ${pallet.heightMm / 1000}`
                        : t("copy.not-measured")}
                    </TableCell>
                    <TableCell>{pallet.lot || "—"}</TableCell>
                    <TableCell>
                      <Status value={palletDisplayStatus(pallet)} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button asChild variant="outline">
                        <Link
                          href={action.href}
                          aria-label={`${tr(...action.label)} ${pallet.code}`}
                        >
                          {tr(...action.label)}
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
        </TableBody>
      </Table>
    </TableScroller>
  );
}
