"use client";

import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { FinishedGoodsList } from "@/lib/convex/finishedGoodsApi";
import {
  productPalletSummary,
  summaryFormatText,
  summaryStatusText,
} from "./productPalletSummary";
import {
  palletDisplayStatus,
  palletPath,
  productPath,
  Status,
  useFGText,
} from "./shared";
import { unitNextAction } from "./unitNextAction";

/** The same cursor page as the desktop table, without a horizontally scrolling table. */
export function FinishedGoodsMobileList({
  tab,
  products,
  pallets,
  allProducts,
  allPallets,
  canManage,
  productSummaries,
}: {
  tab: "products" | "pallets";
  products: FinishedGoodsList["products"];
  pallets: FinishedGoodsList["pallets"];
  allProducts: FinishedGoodsList["products"];
  allPallets: FinishedGoodsList["pallets"];
  canManage: boolean;
  productSummaries?: Record<string, Parameters<typeof summaryFormatText>[0]>;
}) {
  const { t, tr } = useFGText();
  const row = "min-w-0 space-y-2 border-b border-border py-3 first:border-t";
  return (
    <ul
      aria-label={
        tab === "products"
          ? t("copy.products-f41f9c")
          : t("copy.storage-units-965913")
      }
    >
      {tab === "products"
        ? products.map((product) => {
            const summary =
              productSummaries?.[product._id] ??
              productPalletSummary(
                product._id,
                allPallets,
                product.storageFormat,
              );
            return (
              <li key={product._id} className={row}>
                <Link
                  href={productPath(product._id)}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-link"
                >
                  <span className="min-w-0">
                    <span className="block font-medium break-words">
                      {product.name || t("copy.untitled-draft")}
                    </span>
                    <span className="block font-mono text-xs break-all text-muted">
                      {product.sku || t("copy.no-sku-yet")}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-link"
                  />
                </Link>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    {summary.quantity} {product.unit}
                  </span>
                  <Status value={product.status} />
                </div>
                <p className="text-xs text-muted">
                  {summaryFormatText(summary, tr)} ·{" "}
                  {summaryStatusText(summary, tr) || "—"}
                </p>
              </li>
            );
          })
        : pallets.map((pallet) => {
            const product = allProducts.find(
              (product) => product._id === pallet.productId,
            );
            const unit =
              product?.unit ?? ("unit" in pallet ? String(pallet.unit) : "");
            const name =
              product?.name ??
              ("productName" in pallet ? String(pallet.productName) : "—");
            const action = unitNextAction(pallet, canManage);
            return (
              <li key={pallet._id} className={row}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={palletPath(pallet._id)}
                    className="flex min-h-11 max-w-full items-center font-mono font-semibold break-all text-link hover:underline"
                  >
                    {pallet.code}
                  </Link>
                  <Status value={palletDisplayStatus(pallet)} />
                </div>
                <p className="break-words">{name}</p>
                <p className="text-sm">
                  {pallet.quantity} {unit}
                  {pallet.lot ? ` · ${pallet.lot}` : ""}
                </p>
                <p className="text-xs text-muted">
                  {pallet.lengthMm && pallet.widthMm && pallet.heightMm
                    ? `${pallet.lengthMm / 1000} × ${pallet.widthMm / 1000} × ${pallet.heightMm / 1000} m`
                    : t("copy.not-measured")}
                </p>
                <Button asChild variant="outline" className="w-full">
                  <Link
                    href={action.href}
                    aria-label={`${tr(...action.label)} ${pallet.code}`}
                  >
                    {tr(...action.label)}
                  </Link>
                </Button>
              </li>
            );
          })}
    </ul>
  );
}
