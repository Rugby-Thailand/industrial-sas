"use client";

import { useQuery } from "convex/react";
import { CursorPagination } from "@/components/system/CursorPagination";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { useCatalogueSync } from "@/hooks/useCatalogueSync";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { useScanRecovery } from "@/hooks/useScanRecovery";
import { fgRefs, type PalletDetail } from "@/lib/convex/finishedGoodsApi";
import { Loading, mmText, panel, useFGText, useUnitText } from "./shared";

const hasRows = (value: object) =>
  "items" in value && Array.isArray(value.items) && value.items.length > 0;

/** Movement history in cursor pages, independent of the unit detail query. */
export function MoveHistory({ detail }: { detail: PalletDetail }) {
  const { t } = useFGText();
  const { tr, locale } = useUnitText(
    detail.pallet.storageFormat ?? detail.product?.storageFormat,
  );
  const warehouseId = detail.pallet.warehouseId;
  const palletId = detail.pallet._id;
  const paging = useCursorPagination({
    scope: `pallet-moves:${warehouseId}:${palletId}`,
    criteria: {},
  });
  const requestKey = JSON.stringify([
    warehouseId,
    palletId,
    paging.cursor,
    paging.pageSize,
  ]);
  const recovery = useScanRecovery(requestKey);
  const outcome = useQuery(fgRefs.palletMoveHistory, {
    warehouseId,
    palletId,
    cursor: paging.cursor,
    pageSize: paging.pageSize,
    ...(recovery.cursor ? { scanCursor: recovery.cursor } : {}),
    ...(recovery.attempt ? { attempt: recovery.attempt } : {}),
  });
  const value = outcome?.ok ? outcome.value : undefined;
  const tracked = recovery.track(
    outcome === undefined
      ? undefined
      : outcome.ok && outcome.value
        ? { ok: true, value: outcome.value }
        : { ok: false },
  );
  useCatalogueSync({
    outcome: tracked.outcome,
    continuation: tracked.continuation,
    paging,
    resetKey: recovery.key,
    hasRows,
  });
  const ready = value?.status === "ready" ? value : undefined;
  // History only scans across native read splits. A stalled scan is offered
  // the same retry as a failed read; a paused one can continue.
  const failed =
    (outcome && (!outcome.ok || outcome.value === null)) ||
    value?.status === "reset" ||
    tracked.stalled;
  const retry = () => {
    paging.reset();
    // A same-page retry needs new arguments, hence a fresh subscription.
    recovery.retry();
  };
  // A unit that has never moved keeps its detail page free of an empty panel.
  if (ready && ready.isDone && !ready.items.length && !paging.canPrevious)
    return null;
  // Keep the panel (and the focused control) while a retry loads.
  if (!outcome && !paging.canPrevious && !recovery.attempt) return null;
  return (
    <section
      className={`${panel} mt-5 space-y-3`}
      aria-labelledby={`move-history-${palletId}`}
      aria-busy={!ready && !failed}
    >
      <h2
        id={`move-history-${palletId}`}
        className="text-lg leading-7 font-semibold"
      >
        {tr("Movement history", "ประวัติการย้าย")}
      </h2>
      {failed ? (
        <Notice tone="danger" role="alert" title={t("paging.historyFailed")}>
          <Button variant="outline" className="mt-3" onClick={retry}>
            {t("paging.retry")}
          </Button>
        </Notice>
      ) : tracked.paused ? (
        <Button variant="outline" onClick={recovery.resume}>
          {t("paging.continue")}
        </Button>
      ) : !ready ? (
        <Loading />
      ) : (
        <ul className="space-y-3">
          {ready.items.map((move) => (
            <li key={move._id} className="border-t border-border pt-3 text-sm">
              <p className="font-medium">
                {move.sourceDestination
                  ? `${move.sourceDestination.buildingCode} · ${tr("Floor", "ชั้น")} ${move.sourceDestination.floorNumber} · ${move.sourceDestination.locationName}`
                  : "—"}{" "}
                →{" "}
                {move.targetDestination
                  ? `${move.targetDestination.buildingCode} · ${tr("Floor", "ชั้น")} ${move.targetDestination.floorNumber} · ${move.targetDestination.locationName}`
                  : "—"}
              </p>
              <p className="mt-1 text-muted">
                {move.status === "COMPLETED"
                  ? tr("Completed", "เสร็จสิ้น")
                  : move.status === "RETURNED"
                    ? tr("Returned to source", "คืนต้นทางแล้ว")
                    : move.status === "CANCELLED"
                      ? tr("Cancelled", "ยกเลิกแล้ว")
                      : move.status === "IN_TRANSIT"
                        ? tr("In transit", "อยู่ระหว่างย้าย")
                        : tr("Prepared", "เตรียมย้ายแล้ว")}{" "}
                · {new Date(move.createdAt).toLocaleString(locale)}
              </p>
              {move.sourcePlacement?.mode === "GEOMETRIC" &&
              move.targetPlacement?.mode === "GEOMETRIC" ? (
                <p className="mt-1 font-mono text-xs break-words text-muted">
                  {move.sourcePlacement.positionCode}: X{" "}
                  {mmText(move.sourcePlacement.xMm ?? 0)} · Y{" "}
                  {mmText(move.sourcePlacement.yMm ?? 0)} · Z{" "}
                  {mmText(move.sourcePlacement.zMm ?? 0)} ·{" "}
                  {move.sourcePlacement.rotation}° →{" "}
                  {move.targetPlacement.positionCode}: X{" "}
                  {mmText(move.targetPlacement.xMm ?? 0)} · Y{" "}
                  {mmText(move.targetPlacement.yMm ?? 0)} · Z{" "}
                  {mmText(move.targetPlacement.zMm ?? 0)} ·{" "}
                  {move.targetPlacement.rotation}°
                </p>
              ) : null}
              {move.reason ? <p className="mt-1">{move.reason}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {(paging.canPrevious || (ready && !ready.isDone)) && (
        <CursorPagination
          label={t("paging.historyPages")}
          onFirst={paging.reset}
          historyTruncated={paging.historyTruncated}
          page={paging.page}
          pageSize={paging.pageSize}
          onPageSizeChange={paging.setPageSize}
          onPrevious={paging.previous}
          onNext={() => {
            if (ready && !ready.isDone) paging.next(ready.continueCursor);
          }}
          canPrevious={paging.canPrevious}
          canNext={Boolean(ready && !ready.isDone)}
          loading={!ready}
          locale={locale}
        />
      )}
    </section>
  );
}
