"use client";

import type { PalletDetail } from "@/lib/convex/finishedGoodsApi";
import { Status, palletDisplayStatus, mmText, useUnitText } from "./shared";

export function Summary({
  detail,
  compact = false,
}: {
  detail: PalletDetail;
  compact?: boolean;
}) {
  const { tr } = useUnitText(
    detail.pallet.storageFormat ?? detail.product?.storageFormat,
  );
  const { pallet } = detail;
  const extraDetails = (
    <>
      {pallet.lengthMm && pallet.widthMm && pallet.heightMm ? (
        <span
          aria-label={tr(
            "Outer dimensions: length × width × height",
            "ขนาดภายนอก: ยาว × กว้าง × สูง",
          )}
        >
          {mmText(pallet.lengthMm)} × {mmText(pallet.widthMm)} ×{" "}
          {mmText(pallet.heightMm)}
        </span>
      ) : null}
      {pallet.lot ? (
        <span>
          {tr("Lot", "ล็อต")} {pallet.lot}
        </span>
      ) : null}
    </>
  );
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-border py-3 text-sm">
      <span className="font-mono font-semibold break-all">{pallet.code}</span>
      <span className="min-w-0 break-words">
        {detail.product?.sku} · {detail.product?.name}
      </span>
      <span>
        {pallet.quantity} {detail.product?.unit}
      </span>
      <Status
        value={palletDisplayStatus({
          ...pallet,
          ...(detail.activeMove
            ? { moveStatus: detail.activeMove.status }
            : {}),
        })}
      />
      {compact ? (
        <details className="text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center text-muted">
            {tr("Details", "รายละเอียด")}
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {extraDetails}
          </div>
        </details>
      ) : (
        extraDetails
      )}
    </div>
  );
}
