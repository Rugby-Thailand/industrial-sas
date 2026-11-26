"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { Search, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  type DialogCompletionHandle,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/IconButton";
import { Notice } from "@/components/ui/Notice";
import { ScanCodeInput } from "@/components/ui/ScanCodeInput";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import type { JobScanSearchIntent } from "../../../../convex/model/finishedGoods/jobScans";
import { BarcodeCameraBox } from "../BarcodeCameraBox";
import type { JobScanRecordState } from "./useJobScanRecordState";

export function JobScanRecordSearch({
  warehouseId,
  criteria,
  disabled,
  onChange,
  interpret,
}: {
  warehouseId: string;
  criteria: JobScanRecordState;
  disabled: boolean;
  onChange: (next: Partial<JobScanRecordState>) => void;
  interpret: (prompt: string) => Promise<JobScanSearchIntent | null>;
}) {
  const t = useTranslations("JobScan");
  const [scanOpen, setScanOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const scan = useRef<DialogCompletionHandle>(null);
  const ai = useRef<DialogCompletionHandle>(null);
  const { search, facets, exactCode, locationId } = criteria;
  const activeFacets = [
    facets?.building,
    facets?.floor !== undefined && t("floorNumber", { number: facets.floor }),
    facets?.storageFormat && t(`format.${facets.storageFormat}`),
  ].filter(Boolean);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-4 z-10 size-5 -translate-y-1/2 text-muted"
        />
        <ScanCodeInput
          aria-label={t("search")}
          placeholder={t("recordTools.searchPlaceholder")}
          value={search}
          maxLength={200}
          className="pl-12"
          disabled={disabled}
          scanDialog
          scanLabel={t("recordTools.scanSearch")}
          onScan={() => setScanOpen(true)}
          trailingAction={
            <IconButton
              aria-haspopup="dialog"
              label={t("recordTools.aiSearch")}
              variant="ghost"
              disabled={disabled}
              className="text-accent"
              onClick={() => setAiOpen(true)}
            >
              <Sparkles className="size-5" aria-hidden="true" />
            </IconButton>
          }
          onChange={(event) => {
            const search = event.target.value;
            onChange(
              exactCode || locationId || facets
                ? {
                    search,
                    exactCode: undefined,
                    locationId: undefined,
                    facets: undefined,
                  }
                : { search },
            );
          }}
        />
      </div>
      {(exactCode || locationId || activeFacets.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span role="status">
            {exactCode || locationId
              ? t("recordTools.exactMatch")
              : activeFacets.join(" · ")}
          </span>
          <IconButton
            label={t("recordList.clearSearch")}
            variant="ghost"
            disabled={disabled}
            onClick={() =>
              onChange({
                search: "",
                exactCode: undefined,
                locationId: undefined,
                facets: undefined,
              })
            }
          >
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
      )}
      <Dialog open={scanOpen} onOpenChange={setScanOpen} completionRef={scan}>
        <DialogContent size="sm" closeLabel={t("cancel")}>
          <DialogHeader>
            <DialogTitle>{t("recordTools.scanSearch")}</DialogTitle>
            <DialogDescription>{t("recordTools.scanHint")}</DialogDescription>
          </DialogHeader>
          {scanOpen && (
            <RecordCodeCapture
              warehouseId={warehouseId}
              active={scanOpen && !disabled}
              onCode={(code, locationId) => {
                scan.current?.completeOwned?.(() => {
                  setScanOpen(false);
                  onChange({
                    filter: "ALL",
                    search: code,
                    exactCode: locationId ? undefined : true,
                    locationId,
                    facets: undefined,
                  });
                });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={aiOpen} onOpenChange={setAiOpen} completionRef={ai}>
        <DialogContent size="sm" closeLabel={t("cancel")}>
          <DialogHeader>
            <DialogTitle>{t("recordTools.aiSearch")}</DialogTitle>
            <DialogDescription>
              {t("recordTools.aiSearchHint")}
            </DialogDescription>
          </DialogHeader>
          {aiOpen && (
            <RecordSearchPrompt
              active={aiOpen && !disabled}
              interpret={interpret}
              onResult={(intent) => {
                ai.current?.completeOwned?.(() => {
                  setAiOpen(false);
                  onChange({
                    ...intent,
                    facets: intent.facets,
                    exactCode: undefined,
                    locationId: undefined,
                  });
                });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RecordCodeCapture({
  warehouseId,
  active,
  onCode,
}: {
  warehouseId: string;
  active: boolean;
  onCode: (code: string, locationId?: string) => void;
}) {
  const t = useTranslations("JobScan");
  const convex = useConvex();
  const capture = useRef<AbortController | null>(null);
  const [checking, setChecking] = useState(false);
  const [invalid, setInvalid] = useState(false);
  useLayoutEffect(() => {
    const lifetime = new AbortController();
    if (active) capture.current = lifetime;
    return () => {
      lifetime.abort();
      capture.current = null;
    };
  }, [active, warehouseId]);

  async function receive(raw: string) {
    const lifetime = capture.current;
    if (!lifetime || lifetime.signal.aborted) return;
    const code = raw.trim();
    if (!code || code.length > 500 || /\p{C}/u.test(code)) {
      setInvalid(true);
      return;
    }
    const reserved = /^ISAS:/iu.test(code);
    if (reserved && !/^ISAS:LOCATION:1:/u.test(code)) {
      setInvalid(true);
      return;
    }
    capture.current = null;
    setInvalid(false);
    setChecking(true);
    try {
      const result = await convex.query(fgRefs.resolveJobScanLocation, {
        warehouseId,
        code,
        qrOnly: true,
      });
      if (lifetime.signal.aborted) return;
      if (result.ok && result.value.ok) {
        const { code, locationId } = result.value.location;
        onCode(code, locationId);
        return;
      }
      if (
        !reserved &&
        code.length <= 200 &&
        result.ok &&
        !result.value.ok &&
        result.value.error.code === "LOCATION_NOT_FOUND"
      ) {
        onCode(code);
        return;
      }
      setInvalid(true);
    } catch {
      if (!lifetime.signal.aborted) setInvalid(true);
    } finally {
      if (!lifetime.signal.aborted) {
        capture.current = lifetime;
        setChecking(false);
      }
    }
  }

  return (
    <div className="space-y-3">
      <BarcodeCameraBox
        mode="PACKAGES"
        onCode={(code) => void receive(code)}
        closeControl={false}
        disabled={!active || checking}
      />
      {checking && <p role="status">{t("checkingLocation")}</p>}
      {invalid && (
        <Notice
          tone="warning"
          role="alert"
          title={t("recordTools.invalidCode")}
        />
      )}
    </div>
  );
}

function RecordSearchPrompt({
  active,
  interpret,
  onResult,
}: {
  active: boolean;
  interpret: (prompt: string) => Promise<JobScanSearchIntent | null>;
  onResult: (result: JobScanSearchIntent) => void;
}) {
  const t = useTranslations("JobScan");
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => request.current?.abort(), [active]);

  async function submit() {
    if (!active || request.current || !prompt.trim()) return;
    const attempt = new AbortController();
    request.current = attempt;
    setPending(true);
    setError(false);
    try {
      const result = await interpret(prompt.trim());
      if (attempt.signal.aborted) return;
      if (result) onResult(result);
      else setError(true);
    } catch {
      if (!attempt.signal.aborted) setError(true);
    } finally {
      if (request.current === attempt) {
        request.current = null;
        if (!attempt.signal.aborted) setPending(false);
      }
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="grid gap-2 text-sm font-medium">
        {t("recordTools.searchPrompt")}
        <textarea
          autoComplete="off"
          className="min-h-20 w-full rounded-lg border border-border-strong bg-background px-3 py-2 text-base outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          placeholder={t("recordTools.searchExample")}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          maxLength={500}
          disabled={pending}
          required
        />
      </label>
      {error && (
        <Notice
          tone="warning"
          role="alert"
          title={t("recordTools.aiUnavailable")}
        />
      )}
      <DialogFooter>
        <Button type="submit" disabled={!active || pending || !prompt.trim()}>
          {t(pending ? "recordTools.requesting" : "recordTools.searchAction")}
        </Button>
      </DialogFooter>
    </form>
  );
}
