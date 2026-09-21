"use client";
import { drafts } from "@/lib/browser/storage";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Box,
  LayoutGrid,
  List,
  PackagePlus,
  Plus,
  ScanLine,
} from "lucide-react";
import { SummaryPreparation } from "./SummaryPreparation";
import { CursorPagination } from "@/components/system/CursorPagination";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { useCatalogueSync } from "@/hooks/useCatalogueSync";
import {
  useDebouncedSearch,
  useScanContinuation,
} from "@/hooks/useScanContinuation";
import { QueryGate } from "@/components/system/QueryGate";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Button } from "@/components/ui/button";
import { StatusReason } from "@/components/ui/StatusReason";
import { CollectionToolbar } from "@/components/system/CollectionToolbar";
import { IconButton } from "@/components/ui/IconButton";
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
import { hasFilters, newFilters } from "./catalogueFilters";
import { useCatalogueState } from "./useCatalogueState";
import { FinishedGoodsTable } from "./FinishedGoodsTable";
import { unitNextAction } from "./unitNextAction";
import { summaryFormatText, summaryStatusText } from "./productPalletSummary";
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
  const { t, tr, locale } = useFGText();
  const canManage = useCanManage();
  const summaryResetAttempt = useRef<string | null>(null);
  const { state, update: updateState } = useCatalogueState(viewKey);
  const { tab, search, layout } = state;
  const filters = state[tab];
  const clearFilters = () => updateState({ search: "", [tab]: newFilters() });
  const settledSearch = useDebouncedSearch(search);
  const paging = useCursorPagination({
    scope: `${viewKey}:${tab}`,
    criteria: { tab, search, filters, locale },
  });
  const requestKey = JSON.stringify({
    viewKey,
    tab,
    search: settledSearch,
    filters,
    locale,
    cursor: paging.cursor,
    pageSize: paging.pageSize,
  });
  const scan = useScanContinuation(requestKey);
  const outcome = useQuery(
    fgRefs.cataloguePage,
    search === settledSearch
      ? {
          warehouseId,
          tab,
          search: settledSearch,
          filters,
          locale,
          pageSize: paging.pageSize,
          ...(paging.cursor ? { cursor: paging.cursor } : {}),
          ...(scan.cursor ? { scanCursor: scan.cursor } : {}),
        }
      : "skip",
  );
  const summaryScan = useScanContinuation(viewKey);
  const summaryOutcome = useQuery(fgRefs.catalogueSummary, {
    warehouseId,
    ...(summaryScan.cursor ? { scanCursor: summaryScan.cursor } : {}),
  });
  useCatalogueSync({
    outcome,
    continuation: scan,
    paging,
    resetKey: requestKey,
  });
  useEffect(() => {
    if (summaryOutcome?.ok && summaryOutcome.value.status === "scanning")
      summaryScan.advance(summaryOutcome.value.scanCursor);
    if (
      summaryOutcome?.ok &&
      summaryOutcome.value.status === "reset" &&
      summaryScan.cursor &&
      summaryResetAttempt.current !== viewKey
    ) {
      summaryResetAttempt.current = viewKey;
      summaryScan.advance();
    }
    if (summaryOutcome?.ok && summaryOutcome.value.status === "ready")
      summaryResetAttempt.current = null;
  }, [summaryOutcome, summaryScan, viewKey]);
  const ready = outcome?.ok && outcome.value.status === "ready";
  const products = ready ? outcome.value.products : [];
  const pallets = ready ? outcome.value.pallets : [];
  const shownProducts = products;
  const shownPallets = pallets;
  const summary =
    summaryOutcome?.ok && summaryOutcome.value.status === "ready"
      ? summaryOutcome.value.totals
      : undefined;
  const loading =
    !outcome || (outcome.ok && outcome.value.status === "scanning");
  const filterControls = {
    tab,
    filters,
    units: [...(summary?.units ?? [])],
    onChange: (next: typeof filters) => updateState({ [tab]: next }),
  };
  const filtered = Boolean(search.trim()) || hasFilters(filters, tab);
  return (
    <>
      <Heading
        title={t("copy.finished-goods")}
        description={t(
          "copy.prepare-goods-scan-packages-and-confirm-their-storage-location",
        )}
      >
        {canManage && (
          <IconButton
            asChild
            variant="outline"
            label={t("copy.scan-packages-27bf0c")}
            tooltip={t("copy.scan-packages-27bf0c")}
          >
            <Link href={`${FG_PATH}/scan`}>
              <ScanLine className="size-5" aria-hidden="true" />
            </Link>
          </IconButton>
        )}
        {canManage && (
          <Button asChild>
            <Link href={`${FG_PATH}/new`}>
              <Plus className="size-4" aria-hidden="true" />
              {t("copy.add-finished-good")}
            </Link>
          </Button>
        )}
      </Heading>
      {!canManage && (
        <div className="mb-5">
          <ViewOnlyNotice />
        </div>
      )}
      {summaryOutcome?.ok &&
        summaryOutcome.value.status === "not_ready" &&
        !(outcome?.ok && outcome.value.status === "not_ready") && (
          <SummaryPreparation warehouseId={warehouseId} />
        )}
      {summaryOutcome &&
        (!summaryOutcome.ok || summaryOutcome.value.status === "reset") && (
          <ErrorNotice
            message={t(
              "copy.warehouse-totals-could-not-be-loaded-refresh-to-try-again",
            )}
          />
        )}
      <div className="mb-6 grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-surface lg:grid-cols-4">
        {[
          [t("copy.products"), summary?.products ?? "…"],
          [t("copy.awaiting-measurement"), summary?.awaitingMeasurement ?? "…"],
          [t("copy.awaiting-storage"), summary?.awaitingStorage ?? "…"],
          [t("copy.stored-units"), summary?.stored ?? "…"],
        ].map(([label, count], index) => (
          <div
            key={label}
            className={`relative min-w-0 border-border p-4 ${index < 2 ? "border-b lg:border-b-0" : ""} ${index % 2 === 0 ? "border-r" : ""} ${index === 1 ? "lg:border-r" : ""}`}
          >
            <p className={`text-xs text-muted ${index === 0 ? "pr-10" : ""}`}>
              {label}
            </p>
            <p className="mt-2 text-2xl font-semibold">{count}</p>
            {index === 0 ? (
              <div className="absolute top-1 right-1">
                <StatusReason
                  label={t("copy.about-warehouse-totals")}
                  message={t(
                    "copy.totals-cover-the-selected-warehouse-not-just-this-page-or-the-filtered-r",
                  )}
                />
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {!!summary?.moving && (
        <p role="status" className="mb-4 text-sm text-warning">
          {t("copy.moving-units")}: {summary?.moving}
        </p>
      )}
      <div
        className="mb-4 flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t("copy.view-records")}
      >
        {(["products", "pallets"] as const).map((value) => (
          <Button
            key={value}
            variant={tab === value ? "secondary" : "ghost"}
            aria-pressed={tab === value}
            onClick={() => updateState({ tab: value })}
          >
            {value === "products"
              ? t("copy.products-f41f9c")
              : t("copy.storage-units-965913")}
          </Button>
        ))}
      </div>
      <CollectionToolbar
        className="mb-4"
        searchType="text"
        value={search}
        onValueChange={(value) => updateState({ search: value })}
        searchLabel={t("copy.search-finished-goods")}
        placeholder={t("copy.search-sku-name-or-storage-unit")}
        clearLabel={t("copy.clear-search-414314")}
        actions={
          <>
            <CatalogueFiltersButton {...filterControls} />
            <div
              className="flex gap-1"
              role="group"
              aria-label={t("copy.display-layout")}
            >
              {(["cards", "table"] as const).map((value) => (
                <IconButton
                  key={value}
                  variant={layout === value ? "secondary" : "ghost"}
                  aria-pressed={layout === value}
                  label={
                    value === "cards"
                      ? t("copy.card-view")
                      : t("copy.table-view")
                  }
                  onClick={() => updateState({ layout: value })}
                >
                  {value === "cards" ? (
                    <LayoutGrid className="size-4" aria-hidden="true" />
                  ) : (
                    <List className="size-4" aria-hidden="true" />
                  )}
                </IconButton>
              ))}
            </div>
          </>
        }
      />
      <FilterChips
        {...filterControls}
        search={search}
        onClearSearch={() => updateState({ search: "" })}
        onClearAll={clearFilters}
      />
      {ready && (
        <p role="status" className="mb-3 text-xs text-muted">
          {t("copy.showing")}{" "}
          {tab === "products" ? shownProducts.length : shownPallets.length}{" "}
          {t("copy.records")}
        </p>
      )}
      {outcome?.ok && outcome.value.status === "not_ready" ? (
        <SummaryPreparation warehouseId={warehouseId} />
      ) : loading ? (
        <Loading />
      ) : outcome && (!outcome.ok || outcome.value.status === "reset") ? (
        <ErrorNotice
          message={t("copy.records-could-not-be-loaded-please-try-again")}
        />
      ) : (tab === "products" ? shownProducts.length : shownPallets.length) ===
        0 ? (
        <div className={`${panel} py-12 text-center`}>
          <Box className="mx-auto mb-4 size-10 text-muted" aria-hidden="true" />
          <h2 className="text-lg leading-7 font-semibold">
            {filtered
              ? t("copy.no-matching-records")
              : tab === "products"
                ? canManage
                  ? t("copy.your-first-finished-good-starts-here")
                  : t("copy.no-products-yet")
                : t("copy.no-storage-units-yet")}
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted">
            {filtered
              ? t("copy.try-a-different-search-or-clear-the-filters")
              : canManage
                ? t(
                    "copy.create-a-product-then-prepare-a-batch-to-pack-scan-and-store",
                  )
                : t("copy.no-records-are-available-in-this-warehouse-yet")}
          </p>
          {!filtered ? (
            canManage ? (
              <Button asChild className="mt-5">
                <Link href={`${FG_PATH}/new`}>
                  {t("copy.create-finished-good")}
                </Link>
              </Button>
            ) : null
          ) : (
            <Button variant="outline" className="mt-5" onClick={clearFilters}>
              {t("copy.clear-filters")}
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
          productSummaries={Object.fromEntries(
            products.map((p) => [p._id, p.summary]),
          )}
          canManage={canManage}
          filterControls={filterControls}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tab === "products"
            ? shownProducts.map((product) => {
                const summary = product.summary;
                return (
                  <Link
                    key={product._id}
                    href={productPath(product._id)}
                    className={`${panel} transition hover:border-link`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <Box className="size-8 text-link" aria-hidden="true" />
                      <Status value={product.status} />
                    </div>
                    <p className="mt-5 font-mono text-xs break-all text-muted">
                      {product.sku || t("copy.no-sku-yet")}
                    </p>
                    <h2 className="mt-1 text-lg leading-7 font-semibold break-words">
                      {product.name || t("copy.untitled-draft")}
                    </h2>
                    <p className="mt-3 text-sm text-muted">
                      {t("copy.total-in-storage-units")}: {summary.quantity}{" "}
                      {product.unit}
                    </p>
                    <p className="mt-2 text-xs text-muted">
                      {summaryFormatText(summary, tr)}
                    </p>
                    <p className="mt-2 text-xs text-muted">
                      {summaryStatusText(summary, tr)}
                    </p>
                  </Link>
                );
              })
            : shownPallets.map((pallet) => {
                const product = {
                  name: pallet.productName,
                  unit: pallet.unit,
                  storageFormat: pallet.storageFormat,
                };
                const action = unitNextAction(pallet, canManage);
                return (
                  <article
                    key={pallet._id}
                    className={`${panel} flex flex-col`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <Link
                          href={palletPath(pallet._id)}
                          className="font-mono font-semibold hover:underline"
                        >
                          {pallet.code}
                        </Link>
                        <p className="mt-1 text-xs text-muted">
                          {unitNoun(
                            pallet.storageFormat ?? product?.storageFormat,
                            tr,
                          )}
                        </p>
                      </div>
                      <Status value={palletDisplayStatus(pallet)} />
                    </div>
                    <h2 className="mt-4 text-lg leading-7 font-semibold">
                      <Link
                        href={palletPath(pallet._id)}
                        className="hover:underline"
                      >
                        {product?.name ?? "—"}
                      </Link>
                    </h2>
                    <p className="mt-2 text-sm text-muted">
                      {pallet.quantity} {product?.unit ?? ""}
                      {pallet.lot ? ` · ${pallet.lot}` : ""}
                    </p>
                    <p className="mt-2 text-xs text-muted">
                      {pallet.lengthMm && pallet.widthMm && pallet.heightMm
                        ? `${pallet.lengthMm / 1000} × ${pallet.widthMm / 1000} × ${pallet.heightMm / 1000} m`
                        : t("copy.dimensions-not-complete")}
                    </p>
                    <div className="mt-auto pt-4">
                      <Button asChild variant="outline" className="w-full">
                        <Link
                          href={action.href}
                          aria-label={`${tr(...action.label)} ${pallet.code}`}
                        >
                          {tr(...action.label)}
                        </Link>
                      </Button>
                    </div>
                  </article>
                );
              })}
        </div>
      )}
      <CursorPagination
        onFirst={paging.reset}
        historyTruncated={paging.historyTruncated}
        page={paging.page}
        pageSize={paging.pageSize}
        onPageSizeChange={paging.setPageSize}
        onPrevious={paging.previous}
        onNext={() => {
          if (ready) paging.next(outcome.value.continueCursor);
        }}
        canPrevious={paging.canPrevious}
        canNext={!!ready && !outcome.value.isDone}
        loading={loading}
        locale={locale}
      />
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
            <Heading title={t("copy.create-finished-good")} />
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
        title={
          product
            ? t("copy.finished-good-details")
            : t("copy.create-finished-good")
        }
        description={t(
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
      <form onSubmit={submit} className="max-w-3xl space-y-6">
        <fieldset disabled={op.busy} className="min-w-0 space-y-6">
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
              <section className={panel}>
                <h2 className="mb-4 text-lg leading-7 font-semibold">
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
              <section className={panel}>
                <h2 className="mb-4 text-lg leading-7 font-semibold">
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
              <details className={panel}>
                <summary className="cursor-pointer font-medium">
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
            <aside className="rounded-xl border border-border bg-surface p-4">
              <h2 className="text-lg leading-7 font-semibold">
                {t("copy.product-information-only")}
              </h2>
              <p className="mt-3 text-sm text-muted">
                {t(
                  "copy.quantities-packaging-and-actual-outer-dimensions-belong-to-each-preparat",
                )}
              </p>
            </aside>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4">
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
