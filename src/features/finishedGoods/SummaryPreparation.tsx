"use client";

import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { ErrorNotice, useCanManage, useFGText } from "./shared";

export function SummaryPreparation({ warehouseId }: { warehouseId: string }) {
  const { tr } = useFGText();
  const canManage = useCanManage();
  const prepare = useMutation(fgRefs.prepareSummaries);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run() {
    setBusy(true);
    setError(false);
    try {
      while (mounted.current) {
        const result = await prepare({ warehouseId });
        if (!result.ok) throw new Error("PREPARATION_FAILED");
        if (result.value.ready) break;
      }
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="rounded-xl border border-border p-5">
      <p role="status" className="text-sm text-muted">
        {busy
          ? tr(
              "Preparing complete warehouse totals…",
              "กำลังเตรียมยอดรวมคลังสินค้า…",
            )
          : tr(
              "Warehouse totals need to be prepared before these records can be displayed.",
              "ต้องเตรียมยอดรวมคลังสินค้าก่อนแสดงรายการเหล่านี้",
            )}
      </p>
      {canManage && (
        <Button
          type="button"
          className="mt-3"
          variant="outline"
          disabled={busy}
          onClick={() => void run()}
        >
          {tr("Prepare warehouse totals", "เตรียมยอดรวมคลังสินค้า")}
        </Button>
      )}
      {error && (
        <ErrorNotice
          message={tr(
            "Preparation could not finish. Please try again.",
            "เตรียมข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง",
          )}
        />
      )}
    </div>
  );
}
