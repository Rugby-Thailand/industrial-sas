"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MapPin, Pencil, Eye } from "lucide-react";
import { SummaryPreparation } from "./SummaryPreparation";
import { CursorPagination } from "@/components/system/CursorPagination";
import { useCursorPagination } from "@/hooks/useCursorPagination";
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
  measurePath,
  palletPath,
  storagePath,
  palletDisplayStatus,
  panel,
  unitNoun,
  unitCountLabel,
  unitCorrectionPath,
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
  const { tr, locale } = useFGText();
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
  useEffect(() => {
    for (const [result, continuation, controller] of [
      [outcome, scan, paging],
      [legacyOutcome, legacyScan, legacyPaging],
    ] as const) {
      if (!result?.ok) continue;
      if (result.value.status === "scanning")
        continuation.advance(result.value.scanCursor);
      if (
        result.value.status === "reset" &&
        (controller.cursor || continuation.cursor)
      ) {
        continuation.advance();
        controller.reset();
      }
      if (
        result.value.status === "ready" &&
        result.value.isDone &&
        !result.value.page.length &&
        controller.canPrevious
      )
        controller.previous();
    }
  }, [outcome, legacyOutcome, scan, legacyScan, paging, legacyPaging]);
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
      router.push(storagePath(returnId));
    setManage(undefined);
    setCorrectionError(false);
    // Keep the consumed request until the search hook observes its removal.
    // A reactive query update may otherwise reopen the editor during this gap.
    const url = new URL(window.location.href);
    if (url.searchParams.has("editUnit")) {
      url.searchParams.delete("editUnit");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
  }
  if (!outcome || !legacyOutcome || !summaryOutcome)
    return (
      <div className="mt-6">
        <Loading />
      </div>
    );
  if (!outcome.ok || !legacyOutcome.ok || !summaryOutcome.ok)
    return (
      <div className="mt-6">
        <ErrorNotice
          message={tr(
            "Preparation batches could not be loaded. Refresh to try again.",
            "โหลดชุดจัดเตรียมไม่สำเร็จ กรุณารีเฟรชเพื่อลองอีกครั้ง",
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
  const unitLink = (unit: (typeof legacyUnits)[number], editable: boolean) => {
    if (!canManage || unit.status !== "AWAITING_MEASUREMENT")
      return palletPath(unit._id);
    if (!unit.preparationBatchId) return measurePath(unit._id);
    return editable
      ? unitCorrectionPath(product._id, unit._id)
      : palletPath(unit._id);
  };
  const renderUnit = (
    unit: (typeof legacyUnits)[number],
    legacy = false,
    editable = false,
  ) => (
    <li
      key={unit._id}
      className="flex flex-wrap items-center justify-between gap-3 py-3"
    >
      <Link href={unitLink(unit, editable)} className="min-w-0 hover:underline">
        <span className="font-medium">
          {unitNoun(unit.storageFormat ?? product.storageFormat, tr)} ·{" "}
          {unit.code}
        </span>
        <span className="mt-1 block text-sm text-muted">
          {unit.quantity} {product.unit} ·{" "}
          {unit.lengthMm && unit.widthMm && unit.heightMm
            ? `${unit.lengthMm / 1000} × ${unit.widthMm / 1000} × ${unit.heightMm / 1000} m`
            : tr("Awaiting measurement", "รอวัดขนาด")}
        </span>
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <Status value={palletDisplayStatus(unit)} />
        {canManage && editable && unit.preparationBatchId && (
          <Button
            variant="ghost"
            size="icon"
            title={tr("Edit packing and dimensions", "แก้การบรรจุและขนาด")}
            aria-label={`${tr("Edit packing and dimensions", "แก้การบรรจุและขนาด")} ${unit.code}`}
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
            title={tr("View storage", "ดูการจัดเก็บ")}
            aria-label={`${tr("View storage", "ดูการจัดเก็บ")} ${unit.code}`}
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
              {tr("Review cancellation", "ตรวจสอบการยกเลิก")}
            </Button>
          )}
      </div>
    </li>
  );
  return (
    <section
      className="mt-6 space-y-4"
      aria-label={tr("Preparation batches", "ชุดจัดเตรียมสินค้า")}
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
            {tr(
              "This unit was replaced. Choose an active replacement below to plan its storage. Previous reservations and coordinates are not transferred.",
              "หน่วยเดิมถูกแทนที่แล้ว เลือกหน่วยใหม่ด้านล่างเพื่อจัดเก็บ ระบบไม่โอนการจองและพิกัดเดิมไปยังหน่วยใหม่",
            )}
          </p>
        )}
      {correctionError && (
        <div ref={correctionNotice} tabIndex={-1} className="outline-none">
          <ErrorNotice
            message={tr(
              "This unit is no longer available for editing. Choose an available unit below.",
              "หน่วยนี้ไม่พร้อมให้แก้ไขแล้ว กรุณาเลือกหน่วยที่ยังแก้ไขได้ด้านล่าง",
            )}
          />
        </div>
      )}
      <div>
        <h2 className="text-xl font-semibold">
          {tr("Preparation batches", "ชุดจัดเตรียมสินค้า")}
        </h2>
        <p className="mt-2 text-sm text-muted">
          {tr("Total in storage units", "สินค้าที่บันทึกในหน่วยจัดเก็บ")}:{" "}
          {summary.quantity} {product.unit} · {summaryFormatText(summary, tr)}
        </p>
      </div>
      {outcome.value.status === "reset" ? (
        <ErrorNotice
          message={tr(
            "This page is no longer available. Return to the first page.",
            "หน้านี้ไม่พร้อมใช้งาน กรุณากลับไปหน้าแรก",
          )}
        />
      ) : outcome.value.status !== "ready" ? (
        <Loading />
      ) : (
        !batches.length && (
          <p className={`${panel} text-sm text-muted`}>
            {tr(
              "No preparation batches yet. Prepare more goods to start a new batch. Draft batches do not count as created units.",
              "ยังไม่มีชุดจัดเตรียม เลือกจัดเตรียมสินค้าเพิ่มเพื่อเริ่มชุดใหม่ ฉบับร่างไม่นับเป็นหน่วยที่สร้างแล้ว",
            )}
          </p>
        )
      )}
      {batches.map(({ batch, unitCount }) => (
        <article key={batch._id} className={`${panel} space-y-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">
                {tr("Batch", "ชุดจัดเตรียม")} · {batch._id.slice(-8)}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {batch.totalQuantity ?? "—"} {product.unit} ·{" "}
                {batch.status === "DRAFT"
                  ? tr(
                      "Draft — no units created",
                      "ฉบับร่าง — ยังไม่สร้างหน่วยจัดเก็บ",
                    )
                  : unitCountLabel(batch.storageFormat, unitCount, tr)}
                {batch.lot ? ` · ${tr("Lot", "ล็อต")} ${batch.lot}` : ""}
              </p>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                title={tr("View storage", "ดูการจัดเก็บ")}
                aria-label={`${tr("View storage", "ดูการจัดเก็บ")} ${batch._id.slice(-8)}`}
                onClick={() => openManager({ id: batch._id, mode: "view" })}
              >
                <MapPin className="size-4" />
              </Button>
              {canManage && batch.status === "CREATED" && (
                <Button
                  variant="ghost"
                  size="icon"
                  title={tr("Edit available units", "แก้หน่วยที่ยังไม่จัดเก็บ")}
                  aria-label={`${tr("Edit available units", "แก้หน่วยที่ยังไม่จัดเก็บ")} ${batch._id.slice(-8)}`}
                  onClick={() => openManager({ id: batch._id, mode: "edit" })}
                >
                  <Pencil className="size-4" />
                </Button>
              )}
              {canManage && batch.status === "DRAFT" && (
                <Button asChild variant="outline">
                  <Link href={`/finished-goods/batches/${batch._id}`}>
                    {batch.status === "DRAFT"
                      ? tr("Resume draft", "ทำฉบับร่างต่อ")
                      : tr("Edit packing", "แก้การแบ่งบรรจุ")}
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
          message={tr(
            "This page is no longer available. Return to the first page.",
            "หน้านี้ไม่พร้อมใช้งาน กรุณากลับไปหน้าแรก",
          )}
        />
      ) : (
        legacyOutcome.value.status !== "ready" && <Loading />
      )}
      {!!legacyUnits.length && (
        <article className={`${panel} space-y-4`}>
          <div>
            <h3 className="font-semibold">
              {tr(
                "Legacy units — no recorded batch",
                "รายการเดิม — ไม่มีข้อมูลชุด",
              )}
            </h3>
            <p className="mt-2 text-sm text-muted">
              {tr(
                "These records are shown individually. Matching SKUs do not establish that units were prepared together. Review an unused duplicate before cancelling it.",
                "แสดงรายการเดิมแยกกัน รหัสสินค้าเดียวกันไม่ได้แปลว่าจัดเตรียมพร้อมกัน ตรวจสอบรายการซ้ำที่ยังไม่ได้ใช้งานก่อนยกเลิก",
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
        <DialogContent closeLabel={tr("Close", "ปิด")}>
          <DialogHeader>
            <DialogTitle>
              {tr(
                "Review cancellation of legacy unit",
                "ตรวจสอบการยกเลิกรายการเดิม",
              )}
            </DialogTitle>
            <DialogDescription>
              {tr(
                "Cancel only an incorrect or duplicate record. The history is retained. This does not repack or reduce the contents of other units.",
                "ยกเลิกเฉพาะรายการผิดหรือซ้ำ โดยยังเก็บประวัติไว้ การยกเลิกนี้ไม่แบ่งบรรจุใหม่หรือเปลี่ยนจำนวนของหน่วยอื่น",
              )}
            </DialogDescription>
          </DialogHeader>
          {reviewUnit && (
            <>
              <p className="font-mono">{reviewUnit.code}</p>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt>{tr("Before", "ก่อนยกเลิก")}</dt>
                  <dd>
                    {summary.quantity} {product.unit} · {summary.count}{" "}
                    {tr("storage units", "หน่วยจัดเก็บ")}
                  </dd>
                </div>
                <div>
                  <dt>{tr("After", "หลังยกเลิก")}</dt>
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
                label={tr("Cancellation reason", "เหตุผลการยกเลิก")}
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
                  {tr("Keep record", "เก็บรายการไว้")}
                </Button>
                <Button
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
                  {tr("Confirm cancellation", "ยืนยันยกเลิกรายการ")}
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
  const { tr } = useFGText();
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
        {tr("Packing history", "ประวัติการแบ่งบรรจุ")}
      </summary>
      {open &&
        (!detail ? (
          <Loading />
        ) : !detail.ok || !detail.value ? (
          <ErrorNotice
            message={tr(
              "Packing history could not be loaded.",
              "โหลดประวัติการแบ่งบรรจุไม่สำเร็จ",
            )}
          />
        ) : detail.value.history.length ? (
          <ul className="mt-3 space-y-2">
            {detail.value.history.map((revision) => (
              <li
                key={revision._id}
                className="rounded-lg border border-border p-3"
              >
                {tr("Revision", "ครั้งที่")} {revision.revision} ·{" "}
                {revision.totalQuantity ?? "—"} {unit} ·{" "}
                {revision.status === "DRAFT"
                  ? tr("Draft", "ฉบับร่าง")
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
            {tr(
              "No packing revisions yet.",
              "ยังไม่มีประวัติแก้ไขการแบ่งบรรจุ",
            )}
          </p>
        ))}
    </details>
  );
}
