"use client";
import { drafts } from "@/lib/browser/storage";

import { useMutation, useQuery } from "convex/react";
import { useRef, useState, type FormEvent } from "react";
import { PackagePlus } from "lucide-react";
import { QueryGate } from "@/components/system/QueryGate";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Button } from "@/components/ui/button";
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
import { ProductBatches } from "./ProductBatches";
import {
  ErrorNotice,
  FG_PATH,
  Field,
  Heading,
  useFGCrumb,
  Loading,
  Missing,
  Status,
  Steps,
  measurePath,
  productPath,
  useFGText,
  useDraftKey,
  useCanManage,
  ViewOnlyNotice,
  useOperation,
  useUnsavedWarning,
  written,
} from "./shared";

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
  return drafts.read(
    key,
    (value) => {
      if (typeof value !== "object" || value === null) return fallback;
      const candidate = value as Record<string, unknown>;
      if (
        typeof candidate.sku !== "string" ||
        typeof candidate.name !== "string"
      )
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
        if (typeof candidate[field] === "string")
          clean[field] = candidate[field];
      }
      if (typeof candidate.savedProductId === "string")
        clean.savedProductId = candidate.savedProductId;
      return clean;
    },
    fallback,
  );
}
export function ProductScreen({
  productId,
  resumePalletId,
}: {
  productId?: string;
  resumePalletId?: string;
}) {
  const canManage = useCanManage();
  const { t } = useFGText();
  const fgCrumb = useFGCrumb();
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
              title={t("copy.create-finished-good")}
              breadcrumbs={[fgCrumb]}
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
  if (!result.ok) {
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: result.requestId }}
      />
    );
  }
  if (!result.value) return <Missing />;
  if (resumePalletId) {
    if (!resume) return <Loading />;
    if (!resume.ok) {
      return (
        <LedgerPanelStatus
          state={{ kind: "DENIED", requestId: resume.requestId }}
        />
      );
    }
    if (
      !resume.value ||
      resume.value.pallet.productId !== productId ||
      resume.value.pallet.warehouseId !== warehouseId ||
      !["AWAITING_MEASUREMENT", "AWAITING_PLACEMENT"].includes(
        resume.value.pallet.status,
      )
    ) {
      return <Missing />;
    }
  }
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
  const fgCrumb = useFGCrumb();
  const { t, locale } = useFGText();
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
  const storageConditions = [
    { value: "ANY", label: t("copy.no-special-condition") },
    { value: "AMBIENT", label: t("copy.ambient") },
    { value: "DRY", label: t("copy.dry-area") },
    { value: "COOL", label: t("copy.cool-area") },
  ];
  // Keep imported/custom conditions available when editing other product details.
  for (const value of [product?.storageCondition, form.storageCondition]) {
    if (value && !storageConditions.some((option) => option.value === value)) {
      storageConditions.push({ value, label: value });
    }
  }
  const [dirty, setDirty] = useState(
    () =>
      JSON.stringify(form) !== JSON.stringify(initialDraft(product, locale)),
  );
  const [cancel, setCancel] = useState(false);
  const duplicateCatalogue = useQuery(
    fgRefs.productBySku,
    op.errorCode === "DUPLICATE_KEY" && op.error
      ? { warehouseId, sku: form.sku }
      : "skip",
  );
  const duplicateProduct =
    duplicateCatalogue?.ok && duplicateCatalogue.value?._id !== product?._id
      ? duplicateCatalogue.value
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
    drafts.write(key, next);
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
      drafts.write(key, { ...form, savedProductId: id });
      setDirty(false);
      op.clearRequests();
      drafts.remove(key);
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
        breadcrumbs={[fgCrumb]}
        title={
          product
            ? t("copy.finished-good-details")
            : t("copy.create-finished-good")
        }
        helpText={t(
          "copy.define-the-product-then-prepare-a-batch-with-its-quantities-packaging-an",
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
      <form onSubmit={submit} className="max-w-3xl space-y-4">
        <fieldset disabled={op.busy} className="min-w-0 space-y-4">
          <ErrorNotice message={op.error} />
          {op.errorCode === "DUPLICATE_KEY" && op.error && duplicateProduct ? (
            <Button asChild variant="outline">
              <Link href={productPath(duplicateProduct._id)}>
                {t("copy.open-existing-product")}
              </Link>
            </Button>
          ) : null}
          <div className="space-y-6">
            <fieldset disabled={!canManage} className="min-w-0 space-y-4">
              <section className="border-b border-border pb-4">
                <h2 className="mb-4 text-base leading-6 font-semibold">
                  {t("copy.product-details")}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label={t("copy.sku")}
                    value={form.sku}
                    onChange={(v) => change("sku", v)}
                    required
                    maxLength={64}
                  />
                  <Field
                    label={t("copy.product-name")}
                    value={form.name}
                    onChange={(v) => change("name", v)}
                    required
                    maxLength={200}
                  />
                  <Field
                    label={t("copy.counting-unit-78d38c")}
                    value={form.unit}
                    onChange={(v) => change("unit", v)}
                    required
                    maxLength={32}
                  />
                </div>
              </section>
              <section className="border-b border-border pb-4">
                <h2 className="mb-4 text-base leading-6 font-semibold">
                  {t("copy.storage-requirements")}
                </h2>
                <SelectControl
                  label={t("copy.storage-condition")}
                  value={form.storageCondition}
                  onValueChange={(v) => change("storageCondition", v)}
                  options={storageConditions}
                  placeholder=""
                  emptyLabel=""
                />
                <div className="mt-4">
                  <Field
                    label={t("copy.storage-notes")}
                    value={form.notes}
                    onChange={(v) => change("notes", v)}
                    maxLength={1000}
                  />
                </div>
              </section>
              <details className="border-b border-border pb-3">
                <summary className="flex min-h-11 cursor-pointer items-center font-medium">
                  {t("copy.references-optional")}
                </summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field
                    label={t("copy.customer-reference")}
                    value={form.customerReference}
                    onChange={(v) => change("customerReference", v)}
                    maxLength={200}
                  />
                  <Field
                    label={t("copy.product-reference")}
                    value={form.productReference}
                    onChange={(v) => change("productReference", v)}
                    maxLength={200}
                  />
                </div>
              </details>
            </fieldset>
            <aside className="border-t border-border py-3">
              <h2 className="text-base leading-6 font-semibold">
                {t("copy.product-information-only")}
              </h2>
              <p className="mt-3 text-sm text-muted">
                {t(
                  "copy.quantities-packaging-and-actual-outer-dimensions-belong-to-each-preparat",
                )}
              </p>
            </aside>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border py-3">
            <p className="max-w-xl text-xs text-muted">
              {t(
                "copy.saving-product-details-does-not-add-storage-units-prepare-more-goods-to-",
              )}
            </p>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <Button
                type="button"
                variant="ghost"
                disabled={op.busy}
                onClick={() => (dirty ? setCancel(true) : router.push(FG_PATH))}
              >
                {t("copy.cancel")}
              </Button>
              {canManage && (!product || resumePalletId) && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={op.busy}
                  onClick={() => void save(false)}
                >
                  {product?.status === "ACTIVE"
                    ? t("copy.save-product-details")
                    : t("copy.save-draft")}
                </Button>
              )}
              {canManage && product && !resumePalletId && (
                <Button
                  type="button"
                  variant={dirty ? "outline" : "default"}
                  disabled={op.busy}
                  onClick={() => void save(true, true)}
                >
                  <PackagePlus className="size-4" aria-hidden="true" />
                  {t("copy.prepare-more-goods")}
                </Button>
              )}
              {canManage && (
                <Button
                  type="submit"
                  variant={
                    product && !resumePalletId && !dirty ? "outline" : "default"
                  }
                  disabled={op.busy}
                >
                  <PackagePlus className="size-4" aria-hidden="true" />
                  {op.busy
                    ? t("copy.saving")
                    : resumePalletId
                      ? t("copy.return-to-measurement")
                      : product
                        ? t("copy.save-product-details")
                        : t("copy.next-packing")}
                </Button>
              )}
            </div>
          </div>
        </fieldset>
      </form>
      <Dialog open={cancel} onOpenChange={setCancel}>
        <DialogContent closeLabel={t("copy.close")}>
          <DialogHeader>
            <DialogTitle>{t("copy.discard-unsaved-changes")}</DialogTitle>
            <DialogDescription>
              {t("copy.your-last-server-saved-version-will-remain-available")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancel(false)}>
              {t("copy.continue-editing")}
            </Button>
            <Button
              onClick={() => {
                drafts.remove(key);
                setDirty(false);
                router.push(FG_PATH);
              }}
            >
              {t("copy.discard-changes-d093b0")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {dirty ? (
        <p className="mt-3 text-xs text-muted">
          {t(
            "copy.draft-changes-are-kept-on-this-device-until-you-save-or-discard-them",
          )}
        </p>
      ) : null}
      {product ? (
        <ProductBatches warehouseId={warehouseId} product={product} />
      ) : null}
    </>
  );
}
