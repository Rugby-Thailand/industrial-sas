"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BarcodeCameraBox } from "./BarcodeCameraBox";
import { ticketBarcodeError, type TicketCodeField } from "./ticketDraft";

/** One field, one ticket, one result. Existing values require an explicit replacement. */
export function TicketFieldScanner({
  field,
  index,
  value,
  onApply,
  onClose,
}: {
  field: TicketCodeField;
  index: number;
  value: string;
  onApply: (code: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("JobScan");
  const [candidate, setCandidate] = useState<string>();
  const [error, setError] = useState<string>();
  // Decoder callbacks can arrive more than once before React renders the next state.
  const accepting = useRef(true);
  useEffect(() => {
    accepting.current = true;
    return () => {
      accepting.current = false;
    };
  }, []);
  function close() {
    accepting.current = false;
    onClose();
  }
  function read(raw: string) {
    if (!accepting.current) return;
    const code = raw.trim();
    const problem = ticketBarcodeError(field, code);
    if (problem) {
      setError(t(problem));
      return;
    }
    accepting.current = false;
    setError(undefined);
    if (value.trim() && value.trim() !== code) setCandidate(code);
    else onApply(code);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent size="sm" closeLabel={t("cancel")}>
        <DialogHeader>
          <DialogTitle>{t("scanField", { field: t(field) })}</DialogTitle>
          <DialogDescription>
            {t("scanTicketField", { index: index + 1, field: t(field) })}
          </DialogDescription>
        </DialogHeader>
        {candidate ? (
          <div className="space-y-3">
            <p className="text-sm">{t("replaceScanHint")}</p>
            <dl className="space-y-3 rounded-lg border border-border p-3">
              <div>
                <dt className="text-xs text-muted">{t("currentValue")}</dt>
                <dd className="font-mono break-all">{value}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t("scannedValue")}</dt>
                <dd className="font-mono font-semibold break-all">
                  {candidate}
                </dd>
              </div>
            </dl>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  accepting.current = true;
                  setCandidate(undefined);
                }}
              >
                {t("scanAgain")}
              </Button>
              <Button type="button" onClick={() => onApply(candidate)}>
                {t("replaceValue")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <BarcodeCameraBox
            mode="PACKAGES"
            onCode={read}
            onClose={close}
            videoLabel={t("scanField", { field: t(field) })}
          />
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
