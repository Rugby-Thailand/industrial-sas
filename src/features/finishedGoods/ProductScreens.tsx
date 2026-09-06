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
import { Notice } from "@/components/ui/Notice";
import { Link, useRouter } from "@/i18n/navigation";
import { fgRefs, type Product } from "@/lib/convex/finishedGoodsApi";
import { PalletScene } from "./PalletScene";
import { FinishedGoodsTable } from "./FinishedGoodsTable";
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
  panel,
  productPath,
  useFGText,
  useDraftKey,
  useCanManage,
  ViewOnlyNotice,
  useOperation,
  useUnsavedWarning,
  written,
} from "./shared";

export function FinishedGoodsCatalogue() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => (
        <Catalogue key={warehouseId} warehouseId={warehouseId} />
      )}
    </QueryGate>
  );
}
function Catalogue({ warehouseId }: { warehouseId: string }) {
  const { tr } = useFGText();
  const canManage = useCanManage();
  const outcome = useQuery(fgRefs.list, { warehouseId });
  const [tab, setTab] = useState<"products" | "pallets">("products");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [layout, setLayout] = useState<"cards" | "table">("cards");
  if (!outcome) return <Loading />;
  if (!outcome.ok) return <Missing />;
  const products = outcome.value.products;
  const pallets = outcome.value.pallets;
  const needle = search.trim().toLocaleLowerCase();
  const shownProducts = products.filter(
    (p) =>
      `${p.sku} ${p.name}`.toLocaleLowerCase().includes(needle) &&
      (status === "ALL" || p.status === status),
  );
  const shownPallets = pallets.filter(
    (p) =>
      `${p.code} ${products.find((product) => product._id === p.productId)?.sku ?? ""} ${products.find((product) => product._id === p.productId)?.name ?? ""} ${p.lot ?? ""}`
        .toLocaleLowerCase()
        .includes(needle) &&
      (status === "ALL" || p.status === status),
  );
  return (
    <>
      <Heading
        title={tr("Finished goods", "สินค้าสำเร็จรูป")}
        description={tr(
          "Create products, measure each pallet and find its exact storage position.",
          "สร้างสินค้า วัดขนาดพาเลท และเลือกตำแหน่งจัดเก็บที่แน่นอน",
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
            tr("Stored pallets", "พาเลทที่จัดเก็บแล้ว"),
            pallets.filter((p) => p.status === "STORED").length,
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
            onClick={() => {
              setTab(value);
              setStatus("ALL");
            }}
          >
            {value === "products"
              ? tr("Products", "รายการสินค้า")
              : tr("Pallets", "รายการพาเลท")}
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
              onClick={() => setLayout(value)}
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
              "Search SKU, name or pallet…",
              "ค้นหารหัส ชื่อสินค้า หรือพาเลท…",
            )}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <SelectControl
          value={status}
          onValueChange={setStatus}
          label={tr("Status", "สถานะ")}
          placeholder={tr("All statuses", "ทุกสถานะ")}
          emptyLabel=""
          className="w-full sm:w-56"
          options={(tab === "products"
            ? ["ALL", "DRAFT", "ACTIVE"]
            : [
                "ALL",
                "AWAITING_MEASUREMENT",
                "AWAITING_PLACEMENT",
                "RESERVED",
                "STORED",
              ]
          ).map((value) => ({
            value,
            label:
              value === "ALL"
                ? tr("All statuses", "ทุกสถานะ")
                : statusName(value, tr),
          }))}
        />
      </div>
      {(tab === "products" ? shownProducts.length : shownPallets.length) ===
      0 ? (
        <div className={`${panel} py-12 text-center`}>
          <Box className="mx-auto mb-4 size-10 text-muted" aria-hidden="true" />
          <h2 className="text-lg font-semibold">
            {search || status !== "ALL"
              ? tr("No matching records", "ไม่พบรายการที่ตรงกัน")
              : tab === "products"
                ? canManage
                  ? tr(
                      "Your first finished good starts here",
                      "เริ่มสร้างสินค้าสำเร็จรูปแรก",
                    )
                  : tr("No products yet", "ยังไม่มีสินค้า")
                : tr("No pallets yet", "ยังไม่มีพาเลท")}
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted">
            {search || status !== "ALL"
              ? tr(
                  "Try a different search or clear the status filter.",
                  "ลองค้นหาใหม่หรือล้างตัวกรองสถานะ",
                )
              : canManage
                ? tr(
                    "Create a product, then add a physical pallet to measure and store.",
                    "สร้างสินค้า แล้วเพิ่มพาเลทจริงเพื่อวัดขนาดและจัดเก็บ",
                  )
                : tr(
                    "No records are available in this warehouse yet.",
                    "ยังไม่มีข้อมูลในคลังสินค้านี้",
                  )}
          </p>
          {!search && status === "ALL" ? (
            canManage ? (
              <Button asChild className="mt-5">
                <Link href={`${FG_PATH}/new`}>
                  {tr("Create finished good", "สร้างสินค้าสำเร็จรูป")}
                </Link>
              </Button>
            ) : null
          ) : (
            <Button
              variant="outline"
              className="mt-5"
              onClick={() => {
                setSearch("");
                setStatus("ALL");
              }}
            >
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
                    {product.defaultQuantity ?? "—"} {product.unit} /{" "}
                    {product.storageFormat}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    {pallets.filter((p) => p.productId === product._id).length}{" "}
                    {tr("pallets", "พาเลท")}
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
                    <p className="font-mono font-semibold">{pallet.code}</p>
                    <Status value={pallet.status} />
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
function statusName(value: string, tr: (en: string, th: string) => string) {
  return (
    (
      {
        DRAFT: tr("Draft", "ฉบับร่าง"),
        ACTIVE: tr("Ready", "พร้อมใช้งาน"),
        AWAITING_MEASUREMENT: tr("Awaiting measurement", "รอวัดขนาด"),
        AWAITING_PLACEMENT: tr("Awaiting placement", "รอเลือกจุดจัดเก็บ"),
        RESERVED: tr("Reserved", "จองแล้ว"),
        STORED: tr("Stored", "จัดเก็บแล้ว"),
      } as Record<string, string>
    )[value] ?? value
  );
}

type ProductDraft = {
  sku: string;
  name: string;
  unit: string;
  storageFormat: "PALLET" | "BOX" | "OTHER";
  defaultQuantity: string;
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
    storageFormat: product?.storageFormat ?? "PALLET",
    defaultQuantity: String(product?.defaultQuantity ?? ""),
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
    if (
      typeof candidate.sku !== "string" ||
      typeof candidate.name !== "string" ||
      typeof candidate.defaultQuantity !== "string"
    )
      return fallback;
    const clean = { ...fallback };
    for (const field of [
      "sku",
      "name",
      "unit",
      "defaultQuantity",
      "storageCondition",
      "notes",
      "customerReference",
      "productReference",
    ] as const) {
      if (typeof candidate[field] === "string") clean[field] = candidate[field];
    }
    if (
      candidate.storageFormat === "PALLET" ||
      candidate.storageFormat === "BOX" ||
      candidate.storageFormat === "OTHER"
    )
      clean.storageFormat = candidate.storageFormat;
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
  const createPallet = useMutation(fgRefs.createPallet);
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
      if (
        next &&
        (!form.sku.trim() ||
          !form.name.trim() ||
          !form.unit.trim() ||
          !(Number(form.defaultQuantity) > 0))
      )
        throw new Error("INVALID_INPUT");
      const payload = {
        warehouseId,
        ...(productId.current ? { productId: productId.current } : {}),
        sku: form.sku,
        name: form.name,
        unit: form.unit,
        storageFormat: form.storageFormat,
        ...(form.defaultQuantity.trim()
          ? { defaultQuantity: Number(form.defaultQuantity) }
          : {}),
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
      if (next && packing) {
        setDirty(false);
        op.clearRequests();
        try {
          localStorage.removeItem(key);
        } catch {}
        router.push(`${productPath(id)}/packing`);
      } else if (next) {
        const palletId =
          resumePalletId ??
          written(
            await createPallet({
              warehouseId,
              productId: id,
              requestId: op.request(`pallet:${id}`),
            }),
          );
        setDirty(false);
        op.clearRequests();
        try {
          localStorage.removeItem(key);
        } catch {}
        router.push(measurePath(palletId));
      } else {
        setDirty(false);
        op.clearRequests();
        try {
          localStorage.removeItem(key);
        } catch {}
        router.push(FG_PATH);
      }
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void save(true);
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
          "Define the product first. Measure the physical pallet in the next step.",
          "กำหนดข้อมูลสินค้า แล้ววัดขนาดพาเลทจริงในขั้นตอนถัดไป",
        )}
      >
        {product ? <Status value={product.status} /> : null}
      </Heading>
      {canManage ? (
        <Steps step={1} />
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
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      {tr("Storage format", "รูปแบบการจัดเก็บ")}
                    </p>
                    <SelectControl
                      label={tr("Storage format", "รูปแบบการจัดเก็บ")}
                      value={form.storageFormat}
                      onValueChange={(v) =>
                        change(
                          "storageFormat",
                          v as ProductDraft["storageFormat"],
                        )
                      }
                      options={[
                        { value: "PALLET", label: tr("Pallet", "พาเลท") },
                        { value: "BOX", label: tr("Box", "กล่อง") },
                        {
                          value: "OTHER",
                          label: tr("Other storage unit", "หน่วยจัดเก็บอื่น"),
                        },
                      ]}
                      placeholder=""
                      emptyLabel=""
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Field
                      label={tr(
                        "Default quantity per storage unit",
                        "จำนวนต่อหน่วยจัดเก็บ (ค่าเริ่มต้น)",
                      )}
                      value={form.defaultQuantity}
                      onChange={(v) => change("defaultQuantity", v)}
                      type="number"
                      min={0.001}
                      step="any"
                      required
                      hint={tr(
                        "You can change the actual quantity for each pallet.",
                        "แก้ไขจำนวนจริงสำหรับแต่ละพาเลทได้ในขั้นตอนวัดขนาด",
                      )}
                    />
                  </div>
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
              <h2 className="mb-3 font-semibold">
                {tr("Product preview", "ภาพตัวอย่างสินค้า")}
              </h2>
              <PalletScene
                dimensions={{ widthMm: 1000, depthMm: 1200, heightMm: 1400 }}
                showDimensions={false}
                locale={locale}
                label={tr(
                  "Illustration — dimensions not measured yet",
                  "ภาพประกอบ — ยังไม่ได้วัดขนาดจริง",
                )}
              />
              <dl className="mt-4 divide-y divide-border text-sm">
                {[
                  [tr("SKU", "รหัสสินค้า"), form.sku || "—"],
                  [tr("Product name", "ชื่อสินค้า"), form.name || "—"],
                  [
                    tr("Quantity per unit", "จำนวนต่อหน่วยจัดเก็บ"),
                    `${form.defaultQuantity || "—"} ${form.unit}`,
                  ],
                  [
                    tr("Measurement", "การวัดขนาด"),
                    tr("Next step", "ขั้นตอนถัดไป"),
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 py-3">
                    <dt className="text-muted">{label}</dt>
                    <dd className="max-w-[65%] text-right font-medium break-words">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </aside>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4">
            <p className="max-w-xl text-xs text-muted">
              {tr(
                "Creating a product does not mark any physical stock as stored.",
                "การสร้างสินค้ายังไม่บันทึกว่ามีสินค้าจัดเก็บในคลัง",
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
              {canManage && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={op.busy}
                  onClick={() => void save(false)}
                >
                  {product?.status === "ACTIVE"
                    ? tr("Save changes", "บันทึกการเปลี่ยนแปลง")
                    : tr("Save draft", "บันทึกฉบับร่าง")}
                </Button>
              )}
              {canManage && !resumePalletId && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={op.busy}
                  onClick={() => void save(true, true)}
                >
                  <PackagePlus className="size-4" aria-hidden="true" />
                  {tr("Pack pallets", "จัดสรรพาเลท")}
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
                        ? tr("Add pallet & measure", "เพิ่มพาเลทและวัดขนาด")
                        : tr("Next: Measure", "ถัดไป: วัดขนาด")}
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
        <Notice
          title={tr(
            "Each physical pallet is measured separately",
            "แต่ละพาเลทจริงวัดขนาดแยกกัน",
          )}
          body={tr(
            "Adding another pallet keeps this product definition and creates a new pallet ID.",
            "การเพิ่มพาเลทจะใช้ข้อมูลสินค้านี้และสร้างรหัสพาเลทใหม่",
          )}
        />
      ) : null}
    </>
  );
}
