"use client";

import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { ErrorNotice, useCanManage, useFGText } from "./shared";

export function SummaryPreparation({ warehouseId }: { warehouseId: string }) {
  const { t } = useFGText();
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
          ? t("copy.preparing-complete-warehouse-totals")
          : t(
              "copy.warehouse-totals-need-to-be-prepared-before-these-records-can-be-display",
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
          {t("copy.prepare-warehouse-totals")}
        </Button>
      )}
      {error && (
        <ErrorNotice
          message={t("copy.preparation-could-not-finish-please-try-again")}
        />
      )}
    </div>
  );
}
