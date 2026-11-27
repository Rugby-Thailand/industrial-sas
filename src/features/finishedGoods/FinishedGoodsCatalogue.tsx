"use client";
import { packageScanPath } from "@/lib/navigation";

import { useQuery } from "convex/react";
import { Box, LayoutGrid, List, Plus } from "lucide-react";
import { SummaryPreparation } from "./SummaryPreparation";
import { CursorPagination } from "@/components/system/CursorPagination";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { useCatalogueSync } from "@/hooks/useCatalogueSync";
import {
  useDebouncedSearch,
  useScanContinuation,
} from "@/hooks/useScanContinuation";
import { QueryGate } from "@/components/system/QueryGate";
import { Button } from "@/components/ui/button";
import { StatusReason } from "@/components/ui/StatusReason";
import { IconButton } from "@/components/ui/IconButton";
import { ScanIcon } from "@/components/ui/ScanIcon";
import { Link } from "@/i18n/navigation";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { CatalogueFilterBar, CatalogueSort } from "./CatalogueFilterControls";
import { clearConditions, hasFilters } from "./catalogueFilters";
import { useCatalogueState } from "./useCatalogueState";
import { FinishedGoodsTable } from "./FinishedGoodsTable";
import { unitNextAction } from "./unitNextAction";
import { summaryFormatText, summaryStatusText } from "./productPalletSummary";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  ErrorNotice,
  FG_PATH,
  Heading,
  Loading,
  Status,
  palletPath,
  palletDisplayStatus,
  panel,
  productPath,
  unitNoun,
  useFGText,
  useDraftKey,
  useCanManage,
  ViewOnlyNotice,
} from "./shared";

/** Unit statuses each warehouse total counts (see convex/lib/finishedGoodsSummary). */
const totalStatuses = {
  awaitingMeasurement: ["AWAITING_MEASUREMENT"],
  awaitingStorage: ["AWAITING_PLACEMENT", "RESERVED"],
  // A stored unit with a reserved move still counts as stored.
  stored: ["STORED", "MOVE_RESERVED"],
} as const;
const sameStatuses = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && b.every((s) => a.includes(s));

/** The header stays in place while the session and warehouse load. */
export function FinishedGoodsCatalogue() {
  const { t } = useFGText();
  const canManage = useCanManage();
  const viewScope = useDraftKey("fg-catalogue");
  const loadingLabel = t("copy.loading-finished-goods");
  return (
    <>
      <Heading
        backFallbackHref={null}
        title={t("copy.finished-goods")}
        helpText={t(
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
            <Link href={packageScanPath()}>
              <ScanIcon className="size-5" aria-hidden="true" />
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
      {viewScope ? (
        <QueryGate scope="WAREHOUSE" loadingLabel={loadingLabel}>
          {(warehouseId) => (
            <Catalogue
              key={`${viewScope}:${warehouseId}`}
              warehouseId={warehouseId}
              viewKey={`${viewScope}:${warehouseId}`}
              loadingLabel={loadingLabel}
            />
          )}
        </QueryGate>
      ) : (
        <Loading label={loadingLabel} />
      )}
    </>
  );
}
function Catalogue({
  warehouseId,
  viewKey,
  loadingLabel,
}: {
  warehouseId: string;
  viewKey: string;
  loadingLabel: string;
}) {
  const { t, tr, locale } = useFGText();
  const canManage = useCanManage();
  const { state, update: updateState } = useCatalogueState(viewKey);
  const { tab, search, layout } = state;
  const mobile = useIsMobile();
  const filters = state[tab];
  // Clearing filters keeps the search, sort, layout and the other tab.
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
  const listRecovery = useCatalogueSync({
    outcome,
    continuation: scan,
    paging,
    resetKey: JSON.stringify({
      viewKey,
      tab,
      search: settledSearch,
      filters,
      locale,
      pageSize: paging.pageSize,
    }),
    maxAutomaticResets: 3,
  });
  const summaryRecovery = useCatalogueSync({
    outcome: summaryOutcome,
    continuation: summaryScan,
    resetKey: viewKey,
    maxAutomaticResets: 3,
  });
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
  const searched = Boolean(search.trim());
  const conditioned = hasFilters(filters, tab);
  const filtered = searched || conditioned;
  return (
    <>
      {summaryOutcome?.ok &&
        summaryOutcome.value.status === "not_ready" &&
        !(outcome?.ok && outcome.value.status === "not_ready") && (
          <SummaryPreparation warehouseId={warehouseId} />
        )}
      {summaryOutcome &&
        (!summaryOutcome.ok || summaryOutcome.value.status === "reset") && (
          <div className="mb-4 space-y-2">
            <ErrorNotice
              message={t(
                "copy.warehouse-totals-could-not-be-loaded-refresh-to-try-again",
              )}
            />
            {summaryOutcome.ok && summaryScan.cursor && (
              <Button variant="outline" onClick={summaryRecovery.retry}>
                {t("copy.try-again")}
              </Button>
            )}
          </div>
        )}
      <div className="@container mb-4 border-b border-border pb-3">
        <div className="grid gap-x-4 gap-y-2 @min-[18rem]:grid-cols-2 lg:@min-[38rem]:grid-cols-4">
          {(
            [
              [t("copy.products"), summary?.products, null],
              [
                t("copy.awaiting-measurement"),
                summary?.awaitingMeasurement,
                totalStatuses.awaitingMeasurement,
              ],
              [
                t("copy.awaiting-storage"),
                summary?.awaitingStorage,
                totalStatuses.awaitingStorage,
              ],
              [t("copy.stored-units"), summary?.stored, totalStatuses.stored],
            ] as const
          ).map(([label, count, statuses], index) => (
            <div
              key={label}
              className={`relative flex min-h-11 min-w-0 items-center gap-x-2 border-border lg:border-r ${index === 0 ? "pr-10" : ""}`}
            >
              {statuses ? (
                // Opens the units the count describes; the filter chip undoes it.
                <button
                  type="button"
                  className="-mx-2 flex min-h-11 min-w-0 items-center gap-x-2 rounded-md px-2 text-left focus-ring transition-colors hover:bg-raised aria-pressed:bg-accent-surface"
                  // Pressed only while the list shows exactly what the total counts.
                  aria-pressed={
                    tab === "pallets" &&
                    !search.trim() &&
                    sameStatuses(state.pallets.statuses, statuses) &&
                    !hasFilters({ ...state.pallets, statuses: [] }, "pallets")
                  }
                  onClick={() =>
                    updateState({
                      tab: "pallets",
                      search: "",
                      pallets: {
                        ...clearConditions(state.pallets),
                        statuses: [...statuses],
                      },
                    })
                  }
                >
                  <span className="order-2 min-w-0 text-xs leading-4 text-muted">
                    {label}
                  </span>
                  <span className="shrink-0 text-lg font-semibold text-link tabular-nums">
                    {count ?? "…"}
                  </span>
                </button>
              ) : (
                <>
                  <p className="order-2 min-w-0 text-xs leading-4 text-muted">
                    {label}
                  </p>
                  <p className="shrink-0 text-lg font-semibold tabular-nums">
                    {count ?? "…"}
                  </p>
                </>
              )}
              {index === 0 ? (
                <div className="absolute top-0 right-0">
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
      </div>
      <div
        className="mb-4 flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t("copy.view-records")}
      >
        {(["products", "pallets"] as const).map((value) => (
          <Button
            key={value}
            variant={tab === value ? "active" : "ghost"}
            aria-pressed={tab === value}
            onClick={() => updateState({ tab: value })}
          >
            {value === "products"
              ? t("copy.products-f41f9c")
              : t("copy.storage-units-965913")}
          </Button>
        ))}
      </div>
      <CatalogueFilterBar
        {...filterControls}
        search={search}
        onSearchChange={(value) => updateState({ search: value })}
        actions={
          <>
            <CatalogueSort
              tab={tab}
              value={filters.sort}
              onChange={(sort) => updateState({ [tab]: { ...filters, sort } })}
            />
            <div
              className="hidden gap-1 lg:flex"
              role="group"
              aria-label={t("copy.display-layout")}
            >
              {(["cards", "table"] as const).map((value) => (
                <IconButton
                  key={value}
                  variant={layout === value ? "active" : "ghost"}
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
      {!canManage && (
        <div className="mb-3">
          <ViewOnlyNotice />
        </div>
      )}
      {!!summary?.moving && (
        <p role="status" className="mb-3 text-sm text-warning">
          {t("copy.moving-units")}: {summary?.moving}
        </p>
      )}
      {ready && (
        <p role="status" className="mb-3 text-xs text-muted">
          {t("copy.page-count", {
            count:
              tab === "products" ? shownProducts.length : shownPallets.length,
          })}
        </p>
      )}
      {outcome?.ok && outcome.value.status === "not_ready" ? (
        <SummaryPreparation warehouseId={warehouseId} />
      ) : loading ? (
        <Loading label={loadingLabel} />
      ) : outcome && (!outcome.ok || outcome.value.status === "reset") ? (
        <div className="space-y-2">
          <ErrorNotice
            message={t("copy.records-could-not-be-loaded-please-try-again")}
          />
          {outcome.ok && (paging.cursor || scan.cursor) && (
            <Button variant="outline" onClick={listRecovery.retry}>
              {t("copy.try-again")}
            </Button>
          )}
        </div>
      ) : (tab === "products" ? shownProducts.length : shownPallets.length) ===
        0 ? (
        <div className={`${panel} py-6 text-center`}>
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
              ? [
                  searched && t("copy.try-a-different-search-term"),
                  conditioned &&
                    t("copy.remove-a-condition-to-broaden-the-results"),
                ]
                  .filter(Boolean)
                  .join(" ")
              : canManage
                ? t(
                    "copy.create-a-product-then-prepare-a-batch-to-pack-scan-and-store",
                  )
                : t("copy.no-records-are-available-in-this-warehouse-yet")}
          </p>
          {!filtered && canManage && (
            <Button asChild className="mt-5">
              <Link href={`${FG_PATH}/new`}>
                {t("copy.create-finished-good")}
              </Link>
            </Button>
          )}
        </div>
      ) : mobile || layout === "table" ? (
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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
                      <Box className="size-5 text-link" aria-hidden="true" />
                      <Status value={product.status} />
                    </div>
                    <p className="mt-2 font-mono text-xs break-all text-muted">
                      {product.sku || t("copy.no-sku-yet")}
                    </p>
                    <h2 className="mt-1 text-lg leading-7 font-semibold break-words">
                      {product.name || t("copy.untitled-draft")}
                    </h2>
                    <p className="mt-3 text-right text-sm text-muted tabular-nums">
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
                    <p className="mt-2 text-right text-sm text-muted tabular-nums">
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
