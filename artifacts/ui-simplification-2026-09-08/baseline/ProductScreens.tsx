"use client";

import { useMutation, useQuery } from "convex/react";
import { useRef, useState, type FormEvent } from "react";
import { Box, LayoutGrid, List, PackagePlus, Plus, Search } from "lucide-react";
import { QueryGate } from "@/components/system/QueryGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectControl } from "@/components/ui/SelectControl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Link, useRouter } from "@/i18n/navigation";
import { fgRefs, type Product } from "@/lib/convex/finishedGoodsApi";
import { CatalogueFiltersButton, FilterChips } from "./CatalogueFilterControls";
import {
  catalogueRows,
  filterRows,
  hasFilters,
  newFilters,
} from "./catalogueFilters";
import { useCatalogueState } from "./useCatalogueState";
import { FinishedGoodsTable } from "./FinishedGoodsTable";
import {
  productPalletSummary,
  summaryFormatText,
  summaryStatusText,
} from "./productPalletSummary";
import { ProductBatches } from "./ProductBatches";
import {
  ErrorNotice,
  FG_PATH,
  Field,
  Heading,
  Loading,
  Missing,
  Status,
  Steps,
  measurePath,
  palletPath,
  palletDisplayStatus,
  panel,
  productPath,
  unitNoun,
  useFGText,
  useDraftKey,
  useCanManage,
  ViewOnlyNotice,
  useOperation,
  useUnsavedWarning,
  written,
} from "./shared";

export function FinishedGoodsCatalogue() {
  const viewScope = useDraftKey("fg-catalogue");
  if (!viewScope) return <Loading />;
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => (
        <Catalogue
          key={`${viewScope}:${warehouseId}`}
          warehouseId={warehouseId}
          viewKey={`${viewScope}:${warehouseId}`}
        />
      )}
    </QueryGate>
  );
}
function Catalogue({
  warehouseId,
  viewKey,
}: {
  warehouseId: string;
  viewKey: string;
}) {
  const { tr, locale } = useFGText();
  const canManage = useCanManage();
  const outcome = useQuery(fgRefs.list, { warehouseId });
  const { state, update: updateState } = useCatalogueState(viewKey);
  const { tab, search, layout } = state;
  const filters = state[tab];
  const clearFilters = () => updateState({ search: "", [tab]: newFilters() });
  if (!outcome) return <Loading />;
  if (!outcome.ok) return <Missing />;
  const products = outcome.value.products;
  const pallets = outcome.value.pallets.filter(
    (p) =>
      p.retiredAt === undefined &&
      !["CANCELLED", "REPLACED"].includes(p.status),
  );
  const rows = catalogueRows(outcome.value);
  const productById = new Map(products.map((p) => [p._id as string, p]));
  const palletById = new Map(pallets.map((p) => [p._id as string, p]));
  const shownProducts = filterRows(
    rows.products,
    state.products,
    search,
    locale,
  ).flatMap((r) => {
    const p = productById.get(r.id);
    return p ? [p] : [];
  });
  const shownPallets = filterRows(
    rows.pallets,
    state.pallets,
    search,
    locale,
  ).flatMap((r) => {
    const p = palletById.get(r.id);
    return p ? [p] : [];
  });
  const filterControls = {
    tab,
    filters,
    units: [...new Set(products.map((p) => p.unit))].filter(Boolean).sort(),
    onChange: (next: typeof filters) => updateState({ [tab]: next }),
  };
  const filtered = Boolean(search.trim()) || hasFilters(filters, tab);
  return (
    <>
      <Heading
        title={tr("Finished goods", "สินค้าสำเร็จรูป")}
        description={tr(
          "Prepare goods, measure storage units and choose their exact positions.",
          "จัดเตรียมสินค้า วัดขนาดหน่วยจัดเก็บ และเลือกตำแหน่งจัดเก็บที่แน่นอน",
        )}
      >
        {canManage && (
          <Button asChild>
            <Link href={`${FG_PATH}/new`}>
              <Plus className="size-4" aria-hidden="true" />
              {tr("Add finished good", "เพิ่มสินค้าสำเร็จรูป")}
            </Link>
          </Button>
        )}
      </Heading>
      {!canManage && (
        <div className="mb-5">
          <ViewOnlyNotice />
        </div>
      )}
      <div className="mb-5 grid grid-cols-2 overflow-hidden rounded-2xl border border-border bg-surface lg:grid-cols-4">
        {[
          [tr("Products", "สินค้า"), products.length],
          [
            tr("Awaiting measurement", "รอวัดขนาด"),
            pallets.filter((p) => p.status === "AWAITING_MEASUREMENT").length,
          ],
          [
            tr("Awaiting storage", "รอจัดเก็บ"),
            pallets.filter(
              (p) =>
                p.status === "AWAITING_PLACEMENT" || p.status === "RESERVED",
            ).length,
          ],
          [
            tr("Stored units", "หน่วยที่จัดเก็บแล้ว"),
            pallets.filter(
              (p) => p.status === "STORED" && p.moveStatus !== "IN_TRANSIT",
            ).length,
          ],
        ].map(([label, count], index) => (
          <div
            key={label}
            className={`min-w-0 border-border p-4 sm:p-5 ${index < 2 ? "border-b lg:border-b-0" : ""} ${index % 2 === 0 ? "border-r" : ""} ${index === 1 ? "lg:border-r" : ""}`}
          >
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{count}</p>
          </div>
        ))}
      </div>
      {pallets.some((p) => p.moveStatus === "IN_TRANSIT") && (
        <p role="status" className="mb-4 text-sm text-warning">
          {tr("Moving units", "หน่วยที่กำลังย้าย")}:{" "}
          {pallets.filter((p) => p.moveStatus === "IN_TRANSIT").length}
        </p>
      )}
      <div
        className="mb-4 flex flex-wrap gap-2"
        role="group"
        aria-label={tr("View records", "เลือกประเภทข้อมูล")}
      >
        {(["products", "pallets"] as const).map((value) => (
          <Button
            key={value}
            variant={tab === value ? "default" : "outline"}
            aria-pressed={tab === value}
            onClick={() => updateState({ tab: value })}
          >
            {value === "products"
              ? tr("Products", "รายการสินค้า")
              : tr("Storage units", "รายการหน่วยจัดเก็บ")}
          </Button>
        ))}
        <div
          className="ml-auto flex gap-1"
          role="group"
          aria-label={tr("Display layout", "รูปแบบการแสดงผล")}
        >
          {(["cards", "table"] as const).map((value) => (
            <Button
              key={value}
              variant={layout === value ? "secondary" : "ghost"}
              size="icon"
              aria-pressed={layout === value}
              aria-label={
                value === "cards"
                  ? tr("Card view", "มุมมองการ์ด")
                  : tr("Table view", "มุมมองตาราง")
              }
              title={
                value === "cards"
                  ? tr("Card view", "มุมมองการ์ด")
                  : tr("Table view", "มุมมองตาราง")
              }
              onClick={() => updateState({ layout: value })}
            >
              {value === "cards" ? (
                <LayoutGrid className="size-4" aria-hidden="true" />
              ) : (
                <List className="size-4" aria-hidden="true" />
              )}
            </Button>
          ))}
        </div>
      </div>
      <div className="mb-5 flex flex-wrap gap-3">
        <div className="relative min-w-0 flex-1">
          <Search
            className="absolute top-3.5 left-3 size-4 text-muted"
            aria-hidden="true"
          />
          <Input
            aria-label={tr("Search finished goods", "ค้นหาสินค้าสำเร็จรูป")}
            placeholder={tr(
              "Search SKU, name or storage unit…",
              "ค้นหารหัส ชื่อสินค้า หรือหน่วยจัดเก็บ…",
            )}
            value={search}
            onChange={(e) => updateState({ search: e.target.value })}
            className="pl-10"
          />
        </div>
        <CatalogueFiltersButton {...filterControls} />
      </div>
      <FilterChips
        {...filterControls}
        search={search}
        onClearSearch={() => updateState({ search: "" })}
        onClearAll={clearFilters}
      />
      <p role="status" className="mb-3 text-xs text-muted">
        {tr("Showing", "แสดง")}{" "}
        {tab === "products" ? shownProducts.length : shownPallets.length} /{" "}
        {tab === "products" ? products.length : pallets.length}{" "}
        {tr("records", "รายการ")}
      </p>
      {(tab === "products" ? shownProducts.length : shownPallets.length) ===
      0 ? (
        <div className={`${panel} py-12 text-center`}>
          <Box className="mx-auto mb-4 size-10 text-muted" aria-hidden="true" />
          <h2 className="text-lg font-semibold">
            {filtered
              ? tr("No matching records", "ไม่พบรายการที่ตรงกัน")
              : tab === "products"
                ? canManage
                  ? tr(
                      "Your first finished good starts here",
                      "เริ่มสร้างสินค้าสำเร็จรูปแรก",
                    )
                  : tr("No products yet", "ยังไม่มีสินค้า")
                : tr("No storage units yet", "ยังไม่มีหน่วยจัดเก็บ")}
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted">
            {filtered
              ? tr(
                  "Try a different search or clear the filters.",
                  "ลองค้นหาใหม่หรือล้างตัวกรอง",
                )
              : canManage
                ? tr(
                    "Create a product, then prepare a batch to pack, measure and store.",
                    "สร้างสินค้า แล้วจัดเตรียมชุดเพื่อแบ่งบรรจุ วัดขนาด และจัดเก็บ",
                  )
                : tr(
                    "No records are available in this warehouse yet.",
                    "ยังไม่มีข้อมูลในคลังสินค้านี้",
                  )}
          </p>
          {!filtered ? (
            canManage ? (
              <Button asChild className="mt-5">
                <Link href={`${FG_PATH}/new`}>
                  {tr("Create finished good", "สร้างสินค้าสำเร็จรูป")}
                </Link>
              </Button>
            ) : null
          ) : (
            <Button variant="outline" className="mt-5" onClick={clearFilters}>
              {tr("Clear filters", "ล้างตัวกรอง")}
            </Button>
          )}
        </div>
      ) : layout === "table" ? (
        <FinishedGoodsTable
          tab={tab}
          products={shownProducts}
          pallets={shownPallets}
          allProducts={products}
          allPallets={pallets}
          canManage={canManage}
          filterControls={filterControls}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tab === "products"
            ? shownProducts.map((product) => (
                <Link
                  key={product._id}
                  href={productPath(product._id)}
                  className={`${panel} transition hover:border-accent`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <Box className="size-8 text-accent" aria-hidden="true" />
                    <Status value={product.status} />
                  </div>
                  <p className="mt-5 font-mono text-xs break-all text-muted">
                    {product.sku || tr("No SKU yet", "ยังไม่มีรหัส")}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold break-words">
                    {product.name ||
                      tr("Untitled draft", "ฉบับร่างยังไม่มีชื่อ")}
                  </h2>
                  <p className="mt-3 text-sm text-muted">
                    {tr(
                      "Total in storage units",
                      "สินค้าที่บันทึกในหน่วยจัดเก็บ",
                    )}
                    :{" "}
                    {
                      productPalletSummary(
                        product._id,
                        pallets,
                        product.storageFormat,
                      ).quantity
                    }{" "}
                    {product.unit}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    {summaryFormatText(
                      productPalletSummary(
                        product._id,
                        pallets,
                        product.storageFormat,
                      ),
                      tr,
                    )}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    {summaryStatusText(
                      productPalletSummary(
                        product._id,
                        pallets,
                        product.storageFormat,
                      ),
                      tr,
                    )}
                  </p>
                </Link>
              ))
            : shownPallets.map((pallet) => (
                <Link
                  key={pallet._id}
                  href={
                    canManage && pallet.status === "AWAITING_MEASUREMENT"
                      ? measurePath(pallet._id)
                      : palletPath(pallet._id)
                  }
                  className={`${panel} transition hover:border-accent`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-mono font-semibold">
                      {pallet.code}
                      <span className="mt-1 block font-sans text-xs font-normal text-muted">
                        {unitNoun(
                          pallet.storageFormat ??
                            products.find((p) => p._id === pallet.productId)
                              ?.storageFormat,
                          tr,
                        )}
                      </span>
                    </p>
                    <Status value={palletDisplayStatus(pallet)} />
                  </div>
                  <h2 className="mt-4 font-medium">
                    {products.find((p) => p._id === pallet.productId)?.name ??
                      "—"}
                  </h2>
                  <p className="mt-2 text-sm text-muted">
                    {pallet.quantity}{" "}
                    {products.find((p) => p._id === pallet.productId)?.unit ??
                      ""}
                    {pallet.lot ? ` · ${pallet.lot}` : ""}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    {pallet.lengthMm && pallet.widthMm && pallet.heightMm
                      ? `${pallet.lengthMm / 1000} × ${pallet.widthMm / 1000} × ${pallet.heightMm / 1000} m`
                      : tr("Dimensions not complete", "ยังวัดขนาดไม่ครบ")}
                  </p>
                </Link>
              ))}
        </div>
      )}
    </>
  );
}
type ProductDraft = {
  sku: string;
  name: string;
  unit: string;
  storageCondition: string;
  notes: string;
  customerReference: string;
  productReference: string;
  savedProductId?: string;
};
function initialDraft(
  product?: Product,
  locale: "th" | "en" = "th",
): ProductDraft {
  return {
    sku: product?.sku ?? "",
    name: product?.name ?? "",
    unit: product?.unit ?? (locale === "th" ? "ชิ้น" : "pieces"),
    storageCondition: product?.storageCondition ?? "ANY",
    notes: product?.notes ?? "",
    customerReference: product?.customerReference ?? "",
    productReference: product?.productReference ?? "",
    ...(product ? { savedProductId: product._id } : {}),
  };
}
function readDraft(key: string, fallback: ProductDraft): ProductDraft {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return fallback;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.sku !== "string" || typeof candidate.name !== "string")
      return fallback;
    const clean = { ...fallback };
    for (const field of [
      "sku",
      "name",
      "unit",
      "storageCondition",
      "notes",
      "customerReference",
      "productReference",
    ] as const) {
      if (typeof candidate[field] === "string") clean[field] = candidate[field];
    }
    if (typeof candidate.savedProductId === "string")
      clean.savedProductId = candidate.savedProductId;
    return clean;
  } catch {
    return fallback;
  }
}
export function ProductScreen({
  productId,
  resumePalletId,
}: {
  productId?: string;
  resumePalletId?: string;
}) {
  const canManage = useCanManage();
  const { tr } = useFGText();
  const draftScope = useDraftKey("fg-product");
  if (!draftScope) return <Loading />;
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) =>
        productId ? (
          <ProductLoader
            key={`${draftScope}:${warehouseId}:${productId}`}
            draftScope={draftScope}
            warehouseId={warehouseId}
            productId={productId}
            {...(resumePalletId ? { resumePalletId } : {})}
          />
        ) : canManage ? (
          <ProductForm
            key={`${draftScope}:${warehouseId}`}
            draftScope={draftScope}
            warehouseId={warehouseId}
          />
        ) : (
          <>
            <Heading
              title={tr("Create finished good", "สร้างสินค้าสำเร็จรูป")}
            />
            <ViewOnlyNotice />
          </>
        )
      }
    </QueryGate>
  );
}
function ProductLoader({
  draftScope,
  warehouseId,
  productId,
  resumePalletId,
}: {
  draftScope: string;
  warehouseId: string;
  productId: string;
  resumePalletId?: string;
}) {
  const result = useQuery(fgRefs.getProduct, { warehouseId, productId });
  const resume = useQuery(
    fgRefs.getPallet,
    resumePalletId ? { warehouseId, palletId: resumePalletId } : "skip",
  );
  if (!result || (resumePalletId && !resume)) return <Loading />;
  if (!result.ok || !result.value) return <Missing />;
  if (
    resumePalletId &&
    (!resume?.ok ||
      !resume.value ||
      resume.value.pallet.productId !== productId ||
      resume.value.pallet.warehouseId !== warehouseId ||
      !["AWAITING_MEASUREMENT", "AWAITING_PLACEMENT"].includes(
        resume.value.pallet.status,
      ))
  )
    return <Missing />;
  return (
    <ProductForm
      key={`${draftScope}:${warehouseId}:${productId}:${resumePalletId ?? "new-pallet"}`}
      draftScope={draftScope}
      warehouseId={warehouseId}
      product={result.value}
      {...(resumePalletId ? { resumePalletId } : {})}
    />
  );
}
function ProductForm({
  draftScope,
  warehouseId,
  product,
  resumePalletId,
}: {
  draftScope: string;
  warehouseId: string;
  product?: Product;
  resumePalletId?: string;
}) {
  const { tr, locale } = useFGText();
  const canManage = useCanManage();
  const router = useRouter();
  const saveProduct = useMutation(fgRefs.saveProduct);
  const key = `${draftScope}:${warehouseId}:${product?._id ?? "new"}`;
  const op = useOperation(key);
  const [form, setForm] = useState(() =>
    canManage
      ? readDraft(key, initialDraft(product, locale))
      : initialDraft(product, locale),
  );
  const [dirty, setDirty] = useState(
    () =>
      JSON.stringify(form) !== JSON.stringify(initialDraft(product, locale)),
  );
  const [cancel, setCancel] = useState(false);
  const duplicateCatalogue = useQuery(
    fgRefs.list,
    op.errorCode === "DUPLICATE_KEY" && op.error ? { warehouseId } : "skip",
  );
  const duplicateProduct = duplicateCatalogue?.ok
    ? duplicateCatalogue.value.products.find(
        (candidate) =>
          candidate.sku.trim().toUpperCase() ===
            form.sku.trim().toUpperCase() && candidate._id !== product?._id,
      )
    : undefined;
  const productId = useRef(product?._id ?? form.savedProductId);
  useUnsavedWarning(dirty);
  function change<K extends keyof ProductDraft>(
    field: K,
    value: ProductDraft[K],
  ) {
    if (!canManage) return;
    op.setError("");
    const next = { ...form, [field]: value };
    setForm(next);
    setDirty(true);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Server save remains available when browser storage is blocked. */
    }
  }
  async function save(next: boolean, packing = false) {
    await op.run(async () => {
      if (!canManage) throw new Error("ACCESS_DENIED");
      if (next && (!form.sku.trim() || !form.name.trim() || !form.unit.trim()))
        throw new Error("INVALID_INPUT");
      const payload = {
        warehouseId,
        ...(productId.current ? { productId: productId.current } : {}),
        sku: form.sku,
        name: form.name,
        unit: form.unit,
        storageCondition: form.storageCondition,
        notes: form.notes,
        customerReference: form.customerReference,
        productReference: form.productReference,
        draft: !next && product?.status !== "ACTIVE",
      };
      const id = written(
        await saveProduct({
          ...payload,
          requestId: op.request(`product:${JSON.stringify(payload)}`),
        }),
      );
      productId.current = id;
      try {
        localStorage.setItem(
          key,
          JSON.stringify({ ...form, savedProductId: id }),
        );
      } catch {}
      setDirty(false);
      op.clearRequests();
      try {
        localStorage.removeItem(key);
      } catch {}
      router.push(
        next && packing
          ? `${productPath(id)}/packing${product ? `?draft=${crypto.randomUUID()}` : ""}`
          : next && resumePalletId
            ? measurePath(resumePalletId)
            : FG_PATH,
      );
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void save(resumePalletId ? true : !product, !product);
  }
  return (
    <>
      <Heading
        title={
          product
            ? tr("Finished good details", "ข้อมูลสินค้าสำเร็จรูป")
            : tr("Create finished good", "สร้างสินค้าสำเร็จรูป")
        }
        description={tr(
          "Define the product, then prepare a batch with its quantities, packaging and actual dimensions.",
          "กำหนดข้อมูลสินค้า แล้วจัดเตรียมชุดสินค้า ระบุจำนวน แบ่งบรรจุ และวัดขนาดจริง",
        )}
      >
        {product ? <Status value={product.status} /> : null}
      </Heading>
      {canManage ? (
        <Steps step={1} packing={!resumePalletId} />
      ) : (
        <div className="mb-5">
          <ViewOnlyNotice />
        </div>
      )}
      <form onSubmit={submit} className="space-y-5">
        <fieldset disabled={op.busy} className="min-w-0 space-y-5">
          <ErrorNotice message={op.error} />
          {op.errorCode === "DUPLICATE_KEY" && op.error && duplicateProduct ? (
            <Button asChild variant="outline">
              <Link href={productPath(duplicateProduct._id)}>
                {tr("Open existing product", "เปิดสินค้าที่มีอยู่")}
              </Link>
            </Button>
          ) : null}
          <div className="grid items-start gap-5 xl:grid-cols-[1.3fr_1fr]">
            <fieldset disabled={!canManage} className="min-w-0 space-y-4">
              <section className={panel}>
                <h2 className="mb-4 font-semibold">
                  {tr("Product details", "ข้อมูลสินค้า")}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label={tr("SKU", "รหัสสินค้า (SKU)")}
                    value={form.sku}
                    onChange={(v) => change("sku", v)}
                    required
                    maxLength={64}
                  />
                  <Field
                    label={tr("Product name", "ชื่อสินค้า")}
                    value={form.name}
                    onChange={(v) => change("name", v)}
                    required
                    maxLength={200}
                  />
                  <Field
                    label={tr("Counting unit", "หน่วยนับสินค้า")}
                    value={form.unit}
                    onChange={(v) => change("unit", v)}
                    required
                    maxLength={32}
                  />
                </div>
              </section>
              <section className={panel}>
                <h2 className="mb-4 font-semibold">
                  {tr("Storage requirements", "ข้อกำหนดการจัดเก็บ")}
                </h2>
                <SelectControl
                  label={tr("Storage condition", "เงื่อนไขการจัดเก็บ")}
                  value={form.storageCondition}
                  onValueChange={(v) => change("storageCondition", v)}
                  options={[
                    {
                      value: "ANY",
                      label: tr("No special condition", "ไม่มีเงื่อนไขพิเศษ"),
                    },
                    { value: "DRY", label: tr("Dry area", "พื้นที่แห้ง") },
                    { value: "COOL", label: tr("Cool area", "พื้นที่เย็น") },
                  ]}
                  placeholder=""
                  emptyLabel=""
                />
                <div className="mt-4">
                  <Field
                    label={tr("Storage notes", "หมายเหตุการจัดเก็บ")}
                    value={form.notes}
                    onChange={(v) => change("notes", v)}
                    maxLength={1000}
                  />
                </div>
              </section>
              <details className={panel}>
                <summary className="cursor-pointer font-medium">
                  {tr("References (optional)", "ข้อมูลอ้างอิง (ไม่บังคับ)")}
                </summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field
                    label={tr("Customer reference", "อ้างอิงลูกค้า")}
                    value={form.customerReference}
                    onChange={(v) => change("customerReference", v)}
                    maxLength={200}
                  />
                  <Field
                    label={tr("Product reference", "รหัสอ้างอิงสินค้า")}
                    value={form.productReference}
                    onChange={(v) => change("productReference", v)}
                    maxLength={200}
                  />
                </div>
              </details>
            </fieldset>
            <aside className={`${panel} xl:sticky xl:top-4`}>
              <h2 className="font-semibold">
                {tr("Product information only", "ข้อมูลสินค้าเท่านั้น")}
              </h2>
              <p className="mt-3 text-sm text-muted">
                {tr(
                  "Quantities, packaging and actual outer dimensions belong to each preparation batch in the next step. Saving this form never changes existing storage units.",
                  "จำนวนสินค้า การแบ่งบรรจุ และขนาดภายนอกจริงอยู่ในชุดจัดเตรียมแต่ละชุดในขั้นตอนถัดไป การบันทึกหน้านี้ไม่เปลี่ยนหน่วยจัดเก็บที่มีอยู่",
                )}
              </p>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-muted">SKU</dt>
                  <dd className="break-words">{form.sku || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted">
                    {tr("Product name", "ชื่อสินค้า")}
                  </dt>
                  <dd className="break-words">{form.name || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted">
                    {tr("Counting unit", "หน่วยนับสินค้า")}
                  </dt>
                  <dd>{form.unit || "—"}</dd>
                </div>
              </dl>
            </aside>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4">
            <p className="max-w-xl text-xs text-muted">
              {tr(
                "Saving product details does not add storage units. Prepare more goods to start a separate batch.",
                "บันทึกข้อมูลสินค้าไม่เพิ่มหน่วยจัดเก็บ เลือกจัดเตรียมสินค้าเพิ่มเพื่อเริ่มชุดใหม่",
              )}
            </p>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <Button
                type="button"
                variant="ghost"
                disabled={op.busy}
                onClick={() => (dirty ? setCancel(true) : router.push(FG_PATH))}
              >
                {tr("Cancel", "ยกเลิก")}
              </Button>
              {canManage && (!product || resumePalletId) && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={op.busy}
                  onClick={() => void save(false)}
                >
                  {product?.status === "ACTIVE"
                    ? tr("Save product details", "บันทึกข้อมูลสินค้า")
                    : tr("Save draft", "บันทึกฉบับร่าง")}
                </Button>
              )}
              {canManage && product && !resumePalletId && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={op.busy}
                  onClick={() => void save(true, true)}
                >
                  <PackagePlus className="size-4" aria-hidden="true" />
                  {tr("Prepare more goods", "จัดเตรียมสินค้าเพิ่ม")}
                </Button>
              )}
              {canManage && (
                <Button type="submit" disabled={op.busy}>
                  <PackagePlus className="size-4" aria-hidden="true" />
                  {op.busy
                    ? tr("Saving…", "กำลังบันทึก…")
                    : resumePalletId
                      ? tr("Return to measurement", "กลับไปวัดขนาด")
                      : product
                        ? tr("Save product details", "บันทึกข้อมูลสินค้า")
                        : tr("Next: Packing", "ถัดไป: บรรจุ")}
                </Button>
              )}
            </div>
          </div>
        </fieldset>
      </form>
      <Dialog open={cancel} onOpenChange={setCancel}>
        <DialogContent closeLabel={tr("Close", "ปิด")}>
          <DialogHeader>
            <DialogTitle>
              {tr("Discard unsaved changes?", "ละทิ้งการเปลี่ยนแปลง?")}
            </DialogTitle>
            <DialogDescription>
              {tr(
                "Your last server-saved version will remain available.",
                "ข้อมูลล่าสุดที่บันทึกไว้ในระบบจะยังคงอยู่",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancel(false)}>
              {tr("Continue editing", "แก้ไขต่อ")}
            </Button>
            <Button
              onClick={() => {
                try {
                  localStorage.removeItem(key);
                } catch {}
                setDirty(false);
                router.push(FG_PATH);
              }}
            >
              {tr("Discard changes", "ละทิ้งการเปลี่ยนแปลง")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {dirty ? (
        <p className="mt-3 text-xs text-muted">
          {tr(
            "Draft changes are kept on this device until you save or discard them.",
            "ข้อมูลร่างจะเก็บไว้ในอุปกรณ์นี้จนกว่าจะบันทึกหรือละทิ้ง",
          )}
        </p>
      ) : null}
      {product ? (
        <ProductBatches warehouseId={warehouseId} product={product} />
      ) : null}
    </>
  );
}
