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
}: {
  tab: "products" | "pallets";
  products: FinishedGoodsList["products"];
  pallets: FinishedGoodsList["pallets"];
  allProducts: FinishedGoodsList["products"];
  allPallets: FinishedGoodsList["pallets"];
  canManage: boolean;
  filterControls?: FilterControlsProps;
}) {
  const { tr } = useFGText();
  const isProduct = tab === "products";
  const title = isProduct
    ? tr("Finished goods table", "ตารางสินค้าสำเร็จรูป")
    : tr("Storage units table", "ตารางหน่วยจัดเก็บ");
  return (
    <div
      role="region"
      aria-label={title}
      tabIndex={0}
      className="min-w-0 overflow-hidden rounded-xl border border-border focus-visible:outline-2 focus-visible:outline-accent"
    >
      <Table aria-label={title} className="min-w-[720px]">
        <TableHeader>
          <TableRow className="bg-surface">
            {columns(tab).map((column, index) => {
              const label =
                column === "quantity" && isProduct
                  ? tr(
                      "Total in storage units",
                      "สินค้าที่บันทึกในหน่วยจัดเก็บ",
                    )
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
              <span className="sr-only">{tr("Actions", "การดำเนินการ")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isProduct
            ? products.map((product) => {
                const summary = productPalletSummary(
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
                        {product.name ||
                          tr("Untitled draft", "ฉบับร่างยังไม่มีชื่อ")}
                      </Link>
                      <p className="mt-1 font-mono text-xs break-all text-muted">
                        {product.sku || tr("No SKU yet", "ยังไม่มีรหัส")}
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
                          aria-label={`${canManage ? tr("Edit", "แก้ไข") : tr("View", "ดู")} ${product.sku || product.name}`}
                          title={
                            canManage
                              ? tr("Edit product", "แก้ไขสินค้า")
                              : tr("View product", "ดูสินค้า")
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
                const product = allProducts.find(
                  (p) => p._id === pallet.productId,
                );
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
                        : tr("Not measured", "ยังไม่ได้วัด")}
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
    </div>
  );
}
