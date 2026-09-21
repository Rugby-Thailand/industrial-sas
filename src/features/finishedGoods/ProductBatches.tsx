"use client";
import { updateBrowserQuery } from "@/lib/browser/history";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MapPin, Pencil, Eye } from "lucide-react";
import { SummaryPreparation } from "./SummaryPreparation";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { CursorPagination } from "@/components/system/CursorPagination";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { useCatalogueSync } from "@/hooks/useCatalogueSync";
import { useScanContinuation } from "@/hooks/useScanContinuation";
import { BatchManager } from "./BatchManager";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
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
import {
  ErrorNotice,
  Field,
  Loading,
  Status,
  palletPath,
  storagePath,
  palletDisplayStatus,
  panel,
  unitNoun,
  unitCountLabel,
  useFGText,
  useDraftKey,
  useCanManage,
  useOperation,
  written,
} from "./shared";
import { summaryFormatText } from "./productPalletSummary";

export function ProductBatches({
  warehouseId,
  product,
}: {
  warehouseId: string;
  product: Product;
}) {
  const { t, tr, locale } = useFGText();
  const canManage = useCanManage();
  const searchParams = useSearchParams();
  const router = useRouter();
  const followedCorrection = useRef("");
  const [correctionError, setCorrectionError] = useState(false);
  const correctionNotice = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!correctionError) return;
    const frame = window.requestAnimationFrame(() => {
      correctionNotice.current?.focus({ preventScroll: true });
      correctionNotice.current?.scrollIntoView?.({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [correctionError]);
  const actor = useDraftKey("batches");
  const scope = `${actor}:${warehouseId}:${product._id}`;
  const paging = useCursorPagination({ scope, criteria: {} });
  const legacyPaging = useCursorPagination({
    scope: `${scope}:legacy`,
    criteria: {},
  });
  const scan = useScanContinuation(
    JSON.stringify([scope, paging.cursor, paging.pageSize]),
  );
  const legacyScan = useScanContinuation(
    JSON.stringify([scope, legacyPaging.cursor, legacyPaging.pageSize]),
  );
  const outcome = useQuery(
    fgRefs.pageProductBatches,
    actor
      ? {
          warehouseId,
          productId: product._id,
          pageSize: paging.pageSize,
          ...(paging.cursor ? { cursor: paging.cursor } : {}),
          ...(scan.cursor ? { scanCursor: scan.cursor } : {}),
        }
      : "skip",
  );
  const legacyOutcome = useQuery(
    fgRefs.pageLegacyUnits,
    actor
      ? {
          warehouseId,
          productId: product._id,
          pageSize: legacyPaging.pageSize,
          ...(legacyPaging.cursor ? { cursor: legacyPaging.cursor } : {}),
          ...(legacyScan.cursor ? { scanCursor: legacyScan.cursor } : {}),
        }
      : "skip",
  );
  const summaryOutcome = useQuery(fgRefs.productSummary, {
    warehouseId,
    productId: product._id,
  });
  const requestedUnit = (
    searchParams ?? new URLSearchParams(window.location.search)
  ).get("editUnit");
  const returnUnit = searchParams?.get("returnToUnit");
  const correction = useQuery(
    fgRefs.resolveUnitBatch,
    requestedUnit
      ? { warehouseId, productId: product._id, palletId: requestedUnit }
      : "skip",
  );
  const returning = useQuery(
    fgRefs.resolveUnitBatch,
    returnUnit
      ? { warehouseId, productId: product._id, palletId: returnUnit }
      : "skip",
  );
  useCatalogueSync({
    outcome,
    continuation: scan,
    paging,
    resetKey: `${scope}:batches`,
  });
  useCatalogueSync({
    outcome: legacyOutcome,
    continuation: legacyScan,
    paging: legacyPaging,
    resetKey: `${scope}:legacy`,
  });
  const cancelUnit = useMutation(fgRefs.cancelLegacyUnit);
  const op = useOperation(`legacy-unit:${warehouseId}:${product._id}`);
  const [reviewId, setReviewId] = useState<string>();
  const [reason, setReason] = useState("");
  const [manage, setManage] = useState<{
    id: string;
    mode: "view" | "edit";
    unitId?: string;
  }>();
  useEffect(() => {
    const requested = (
      searchParams ?? new URLSearchParams(window.location.search)
    ).get("editUnit");
    if (!canManage || !requested) {
      if (followedCorrection.current) {
        followedCorrection.current = "";
        setManage(undefined);
        setCorrectionError(false);
      }
      return;
    }
    // History updates can precede Next's search-parameter hook. Never replay
    // a correction request that has already been removed from the live URL.
    if (
      new URLSearchParams(window.location.search).get("editUnit") !== requested
    )
      return;
    if (!correction?.ok) return;
    const key = `${warehouseId}:${product._id}:${requested}`;
    if (followedCorrection.current === key) return;
    followedCorrection.current = key;
    const target = correction.value;
    const editable = target?.editable && target.batchId;
    setCorrectionError(!editable);
    setManage(
      editable
        ? { id: target.batchId!, mode: "edit", unitId: requested }
        : undefined,
    );
  }, [canManage, correction, product._id, searchParams, warehouseId]);

  function openManager(next: NonNullable<typeof manage>) {
    setCorrectionError(false);
    setManage(next);
  }

  function closeManager() {
    const returnId = searchParams?.get("returnToUnit");
    if (
      returnId &&
      returning?.ok &&
      returning.value &&
      returning.value.unit.retiredAt === undefined &&
      !["REPLACED", "CANCELLED"].includes(returning.value.unit.status)
    )
      router.push(
        returning.value.unit.status === "AWAITING_MEASUREMENT"
          ? "/finished-goods/scan"
          : storagePath(returnId),
      );
    setManage(undefined);
    setCorrectionError(false);
    // Keep the consumed request until the search hook observes its removal.
    // A reactive query update may otherwise reopen the editor during this gap.
    const url = new URL(window.location.href);
    if (url.searchParams.has("editUnit")) {
      updateBrowserQuery((query) => query.delete("editUnit"));
    }
  }
  if (!outcome || !legacyOutcome || !summaryOutcome)
    return (
      <div className="mt-6">
        <Loading />
      </div>
    );
  const denied = !outcome.ok && outcome.denial?.kind === "AUTHORIZATION_DENIED";
  const legacyDenied =
    !legacyOutcome.ok && legacyOutcome.denial?.kind === "AUTHORIZATION_DENIED";
  const summaryDenied =
    !summaryOutcome.ok && summaryOutcome.denial?.kind === "AUTHORIZATION_DENIED";
  if (denied || legacyDenied || summaryDenied)
    return denied ? (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    ) : legacyDenied ? (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: legacyOutcome.requestId }}
      />
    ) : (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: summaryOutcome.requestId }}
      />
    );
  if (!outcome.ok || !legacyOutcome.ok || !summaryOutcome.ok)
    return (
      <div className="mt-6">
        <ErrorNotice
          message={t(
            "copy.preparation-batches-could-not-be-loaded-refresh-to-try-again",
          )}
        />
      </div>
    );
  const batches = outcome.value.status === "ready" ? outcome.value.page : [];
  const legacyUnits =
    legacyOutcome.value.status === "ready" ? legacyOutcome.value.page : [];
  const summary = summaryOutcome.value;
  if (!summary) return <SummaryPreparation warehouseId={warehouseId} />;
  const reviewUnit = legacyUnits.find((unit) => unit._id === reviewId);
  const unitLink = (unit: (typeof legacyUnits)[number]) =>
    canManage && unit.status === "AWAITING_MEASUREMENT"
      ? "/finished-goods/scan"
      : palletPath(unit._id);
  const renderUnit = (
    unit: (typeof legacyUnits)[number],
    legacy = false,
    editable = false,
  ) => (
    <li
      key={unit._id}
      className="flex flex-wrap items-center justify-between gap-3 py-3"
    >
      <Link href={unitLink(unit)} className="min-w-0 hover:underline">
        <span className="font-medium">
          {unitNoun(unit.storageFormat ?? product.storageFormat, tr)} ·{" "}
          {unit.code}
        </span>
        <span className="mt-1 block text-sm text-muted">
          {unit.quantity} {product.unit} ·{" "}
          {unit.lengthMm && unit.widthMm && unit.heightMm
            ? `${unit.lengthMm / 1000} × ${unit.widthMm / 1000} × ${unit.heightMm / 1000} m`
            : t("copy.measurements-not-recorded")}
        </span>
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <Status value={palletDisplayStatus(unit)} />
        {canManage && editable && unit.preparationBatchId && (
          <Button
            variant="ghost"
            size="icon"
            title={t("copy.edit-packing-and-dimensions")}
            aria-label={`${t("copy.edit-packing-and-dimensions")} ${unit.code}`}
            onClick={() =>
              openManager({
                id: unit.preparationBatchId!,
                mode: "edit",
                unitId: unit._id,
              })
            }
          >
            <Pencil className="size-4" />
          </Button>
        )}
        {unit.preparationBatchId && (
          <Button
            variant="ghost"
            size="icon"
            title={t("copy.view-storage")}
            aria-label={`${t("copy.view-storage")} ${unit.code}`}
            onClick={() =>
              openManager({
                id: unit.preparationBatchId!,
                mode: "view",
                unitId: unit._id,
              })
            }
          >
            <Eye className="size-4" />
          </Button>
        )}
        {legacy &&
          canManage &&
          ["AWAITING_MEASUREMENT", "AWAITING_PLACEMENT"].includes(
            unit.status,
          ) &&
          !unit.moveStatus && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setReviewId(unit._id);
                setReason("");
                op.setError("");
              }}
            >
              {t("copy.review-cancellation")}
            </Button>
          )}
      </div>
    </li>
  );
  return (
    <section
      className="mt-8 max-w-7xl space-y-6"
      aria-label={t("copy.preparation-batches")}
    >
      {searchParams?.get("returnToUnit") &&
        !manage &&
        returning?.ok &&
        (!returning.value ||
          returning.value.unit.retiredAt !== undefined ||
          ["REPLACED", "CANCELLED"].includes(returning.value.unit.status)) && (
          <p
            role="status"
            className="rounded-lg border border-border p-3 text-sm text-muted"
          >
            {t(
              "copy.this-unit-was-replaced-choose-an-active-replacement-below-to-plan-its-st",
            )}
          </p>
        )}
      {correctionError && (
        <div ref={correctionNotice} tabIndex={-1} className="outline-none">
          <ErrorNotice
            message={t(
              "copy.this-unit-is-no-longer-available-for-editing-choose-an-available-unit-be",
            )}
          />
        </div>
      )}
      <div>
        <h2 className="text-lg leading-7 font-semibold">
          {t("copy.preparation-batches")}
        </h2>
        <p className="mt-2 text-sm text-muted">
          {t("copy.total-in-storage-units")}: {summary.quantity} {product.unit}{" "}
          · {summaryFormatText(summary, tr)}
        </p>
      </div>
      {outcome.value.status === "reset" ? (
        <ErrorNotice
          message={t(
            "copy.this-page-is-no-longer-available-return-to-the-first-page",
          )}
        />
      ) : outcome.value.status !== "ready" ? (
        <Loading />
      ) : (
        !batches.length && (
          <p className={`${panel} text-sm text-muted`}>
            {t(
              "copy.no-preparation-batches-yet-prepare-more-goods-to-start-a-new-batch-draft",
            )}
          </p>
        )
      )}
      {batches.map(({ batch, unitCount }) => (
        <article key={batch._id} className={`${panel} space-y-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">
                {t("copy.batch")} · {batch._id.slice(-8)}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {batch.totalQuantity ?? "—"} {product.unit} ·{" "}
                {batch.status === "DRAFT"
                  ? t("copy.draft-no-units-created")
                  : unitCountLabel(batch.storageFormat, unitCount, tr)}
                {batch.lot ? ` · ${t("copy.lot")} ${batch.lot}` : ""}
              </p>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                title={t("copy.view-storage")}
                aria-label={`${t("copy.view-storage")} ${batch._id.slice(-8)}`}
                onClick={() => openManager({ id: batch._id, mode: "view" })}
              >
                <MapPin className="size-4" />
              </Button>
              {canManage && batch.status === "CREATED" && (
                <Button
                  variant="ghost"
                  size="icon"
                  title={t("copy.edit-available-units")}
                  aria-label={`${t("copy.edit-available-units")} ${batch._id.slice(-8)}`}
                  onClick={() => openManager({ id: batch._id, mode: "edit" })}
                >
                  <Pencil className="size-4" />
                </Button>
              )}
              {canManage && batch.status === "DRAFT" && (
                <Button asChild variant="outline">
                  <Link href={`/finished-goods/batches/${batch._id}`}>
                    {batch.status === "DRAFT"
                      ? t("copy.resume-draft")
                      : t("copy.edit-packing")}
                  </Link>
                </Button>
              )}
            </div>
          </div>
          <BatchHistory
            warehouseId={warehouseId}
            batchId={batch._id}
            unit={product.unit}
          />
        </article>
      ))}
      <CursorPagination
        page={paging.page}
        pageSize={paging.pageSize}
        onPageSizeChange={paging.setPageSize}
        onPrevious={paging.previous}
        onNext={() => paging.next(outcome.value.continueCursor)}
        canPrevious={paging.canPrevious}
        canNext={outcome.value.status === "ready" && !outcome.value.isDone}
        loading={outcome.value.status !== "ready"}
        locale={locale}
        onFirst={paging.reset}
        historyTruncated={
          paging.historyTruncated || outcome.value.status === "reset"
        }
      />
      {legacyOutcome.value.status === "reset" ? (
        <ErrorNotice
          message={t(
            "copy.this-page-is-no-longer-available-return-to-the-first-page",
          )}
        />
      ) : (
        legacyOutcome.value.status !== "ready" && <Loading />
      )}
      {!!legacyUnits.length && (
        <article className={`${panel} space-y-4`}>
          <div>
            <h3 className="font-semibold">
              {t("copy.legacy-units-no-recorded-batch")}
            </h3>
            <p className="mt-2 text-sm text-muted">
              {t(
                "copy.these-records-are-shown-individually-matching-skus-do-not-establish-that",
              )}
            </p>
          </div>
          <ul className="divide-y divide-border">
            {legacyUnits.map((unit) => renderUnit(unit, true))}
          </ul>
        </article>
      )}
      {(legacyUnits.length > 0 ||
        legacyPaging.page > 1 ||
        legacyOutcome.value.status === "reset") && (
        <CursorPagination
          page={legacyPaging.page}
          pageSize={legacyPaging.pageSize}
          onPageSizeChange={legacyPaging.setPageSize}
          onPrevious={legacyPaging.previous}
          onNext={() => legacyPaging.next(legacyOutcome.value.continueCursor)}
          canPrevious={legacyPaging.canPrevious}
          canNext={
            legacyOutcome.value.status === "ready" &&
            !legacyOutcome.value.isDone
          }
          loading={legacyOutcome.value.status !== "ready"}
          locale={locale}
          onFirst={legacyPaging.reset}
          historyTruncated={
            legacyPaging.historyTruncated ||
            legacyOutcome.value.status === "reset"
          }
        />
      )}
      {manage && (
        <BatchManager
          key={`${warehouseId}:${product._id}:${manage.id}:${manage.unitId ?? "batch"}:${manage.mode}`}
          warehouseId={warehouseId}
          batchId={manage.id}
          mode={manage.mode}
          unitId={manage.unitId}
          onClose={closeManager}
        />
      )}
      <Dialog
        open={!!reviewUnit}
        onOpenChange={(open) => {
          if (!open && !op.busy) setReviewId(undefined);
        }}
      >
        <DialogContent closeLabel={t("copy.close")}>
          <DialogHeader>
            <DialogTitle>
              {t("copy.review-cancellation-of-legacy-unit")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "copy.cancel-only-an-incorrect-or-duplicate-record-the-history-is-retained-thi",
              )}
            </DialogDescription>
          </DialogHeader>
          {reviewUnit && (
            <>
              <p className="font-mono">{reviewUnit.code}</p>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt>{t("copy.before-8f819c")}</dt>
                  <dd>
                    {summary.quantity} {product.unit} · {summary.count}{" "}
                    {t("copy.storage-units")}
                  </dd>
                </div>
                <div>
                  <dt>{t("copy.after-41c591")}</dt>
                  <dd>
                    {Math.round(
                      (summary.quantity - reviewUnit.quantity) * 1000,
                    ) / 1000}{" "}
                    {product.unit} ·{" "}
                    {unitCountLabel("OTHER", summary.count - 1, tr)}
                  </dd>
                </div>
              </dl>
              <Field
                label={t("copy.cancellation-reason")}
                value={reason}
                onChange={setReason}
                required
                maxLength={500}
              />
              <ErrorNotice message={op.error} />
              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={op.busy}
                  onClick={() => setReviewId(undefined)}
                >
                  {t("copy.keep-record")}
                </Button>
                <Button
                  variant="destructive"
                  disabled={op.busy || !reason.trim()}
                  onClick={() =>
                    void op.run(async () => {
                      const payload = {
                        warehouseId,
                        palletId: reviewUnit._id,
                        reason: reason.trim(),
                        expectedUpdatedAt: reviewUnit.updatedAt,
                      };
                      written(
                        await cancelUnit({
                          ...payload,
                          requestId: op.request(JSON.stringify(payload)),
                        }),
                      );
                      op.clearRequests();
                      setReviewId(undefined);
                    })
                  }
                >
                  {t("copy.confirm-cancellation")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function BatchHistory({
  warehouseId,
  batchId,
  unit,
}: {
  warehouseId: string;
  batchId: string;
  unit: string;
}) {
  const { t, tr } = useFGText();
  const [open, setOpen] = useState(false);
  const detail = useQuery(
    fgRefs.getBatch,
    open ? { warehouseId, batchId } : "skip",
  );
  return (
    <details
      className="text-sm"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-muted">
        {t("copy.packing-history")}
      </summary>
      {open &&
        (!detail ? (
          <Loading />
        ) : !detail.ok || !detail.value ? (
          <ErrorNotice
            message={t("copy.packing-history-could-not-be-loaded")}
          />
        ) : detail.value.history.length ? (
          <ul className="mt-3 space-y-2">
            {detail.value.history.map((revision) => (
              <li
                key={revision._id}
                className="rounded-lg border border-border p-3"
              >
                {t("copy.revision")} {revision.revision} ·{" "}
                {revision.totalQuantity ?? "—"} {unit} ·{" "}
                {revision.status === "DRAFT"
                  ? t("copy.draft")
                  : unitCountLabel(
                      revision.storageFormat,
                      revision.palletIds.length,
                      tr,
                    )}
                <span className="mt-1 block text-xs text-muted">
                  {revision.packages
                    .map((row) => `${row.quantity ?? "—"} ${unit}`)
                    .join(" + ")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-muted">
            {t("copy.no-packing-revisions-yet")}
          </p>
        ))}
    </details>
  );
}
