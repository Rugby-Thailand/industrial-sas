"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
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
import { BarcodeCameraBox } from "../BarcodeCameraBox";
import { ticketBarcodeError, type TicketCodeField } from "./ticketDraft";

type FieldTarget = {
  key: string;
  field: TicketCodeField;
  index: number;
  value: string;
};

/** One field, one ticket, one result. Existing values require an explicit replacement. */
export function TicketFieldScanner({
  target,
  onApply,
  onClose,
  onRestore,
  revocationEpoch,
  openerRef,
}: {
  target: FieldTarget | null;
  onApply: (target: FieldTarget, code: string) => void;
  onClose: () => void;
  onRestore?: () => void;
  revocationEpoch?: number;
  openerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations("JobScan");
  return (
    <Dialog
      open={target !== null}
      {...(revocationEpoch === undefined
        ? {}
        : { backRevocationEpoch: revocationEpoch })}
      onOpenChange={(open) => {
        if (open) onRestore?.();
        else onClose();
      }}
    >
      <DialogContent
        size="camera"
        closeLabel={t("cancel")}
        onCloseAutoFocus={(event) => {
          const opener = openerRef?.current;
          if (opener?.isConnected && !opener.disabled) {
            event.preventDefault();
            opener.focus();
          }
        }}
      >
        {target && (
          <TicketFieldScanSession
            key={`${target.key}:${target.field}`}
            target={target}
            onApply={(code) => onApply(target, code)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TicketFieldScanSession({
  target: { field, index, value },
  onApply,
}: {
  target: FieldTarget;
  onApply: (code: string) => void;
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
    <>
      <DialogHeader>
        <DialogTitle>{t("scanField", { field: t(field) })}</DialogTitle>
        <DialogDescription>
          {t("scanTicketField", { index: index + 1, field: t(field) })}
        </DialogDescription>
      </DialogHeader>
      {candidate ? (
        <div className="mx-auto my-auto w-full max-w-xl space-y-3 rounded-lg border border-border bg-surface p-4">
          <p className="text-sm">{t("replaceScanHint")}</p>
          <dl className="space-y-3 rounded-lg border border-border p-3">
            <div>
              <dt className="text-xs text-muted">{t("currentValue")}</dt>
              <dd className="font-mono break-all">{value}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t("scannedValue")}</dt>
              <dd className="font-mono font-semibold break-all">{candidate}</dd>
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
          imageTarget={field}
          onCode={read}
          closeControl={false}
          presentation="fullscreen"
          videoLabel={t("scanField", { field: t(field) })}
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}
