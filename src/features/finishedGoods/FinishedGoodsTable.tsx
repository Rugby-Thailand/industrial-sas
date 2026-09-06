"use client";

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
  measurePath,
  palletPath,
  productPath,
  Status,
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
}: {
  tab: "products" | "pallets";
  products: FinishedGoodsList["products"];
  pallets: FinishedGoodsList["pallets"];
  allProducts: FinishedGoodsList["products"];
  allPallets: FinishedGoodsList["pallets"];
  canManage: boolean;
}) {
  const { tr } = useFGText();
  const isProduct = tab === "products";
  const title = isProduct
    ? tr("Finished goods table", "ตารางสินค้าสำเร็จรูป")
    : tr("Pallets table", "ตารางพาเลท");
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
            <TableHead className="pl-4">
              {isProduct ? tr("Product", "สินค้า") : tr("Pallet", "พาเลท")}
            </TableHead>
            <TableHead>{tr("Quantity", "จำนวน")}</TableHead>
            <TableHead>
              {isProduct
                ? tr("Format", "รูปแบบ")
                : tr("Dimensions (m)", "ขนาด (ม.)")}
            </TableHead>
            <TableHead>
              {isProduct ? tr("Pallets", "พาเลท") : tr("Lot", "ล็อต")}
            </TableHead>
            <TableHead>{tr("Status", "สถานะ")}</TableHead>
            <TableHead className="pr-4 text-right">
              <span className="sr-only">{tr("Actions", "การดำเนินการ")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isProduct
            ? products.map((product) => (
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
                    {product.defaultQuantity ?? "—"} {product.unit}
                    <p className="text-xs text-muted">
                      {tr("per storage unit", "ต่อหน่วยจัดเก็บ")}
                    </p>
                  </TableCell>
                  <TableCell>
                    {product.storageFormat === "PALLET"
                      ? tr("Pallet", "พาเลท")
                      : product.storageFormat === "BOX"
                        ? tr("Box", "กล่อง")
                        : tr("Other", "อื่น ๆ")}
                  </TableCell>
                  <TableCell>
                    {
                      allPallets.filter((p) => p.productId === product._id)
                        .length
                    }
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
                          <ArrowUpRight className="size-4" aria-hidden="true" />
                        )}
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            : pallets.map((pallet) => {
                const product = allProducts.find(
                  (p) => p._id === pallet.productId,
                );
                const href =
                  canManage && pallet.status === "AWAITING_MEASUREMENT"
                    ? measurePath(pallet._id)
                    : palletPath(pallet._id);
                return (
                  <TableRow key={pallet._id}>
                    <TableCell className="max-w-80 py-4 pl-4 whitespace-normal">
                      <Link
                        href={href}
                        className="font-mono font-medium hover:underline"
                      >
                        {pallet.code}
                      </Link>
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
                      <Status value={pallet.status} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button asChild variant="ghost" size="icon">
                        <Link
                          href={href}
                          aria-label={`${tr("View", "ดู")} ${pallet.code}`}
                          title={tr("Open pallet", "เปิดพาเลท")}
                        >
                          <ArrowUpRight className="size-4" aria-hidden="true" />
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
