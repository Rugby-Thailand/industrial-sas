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
import { Input } from "@/components/ui/input";
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
  const [scanEpoch, setScanEpoch] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiEpoch, setAiEpoch] = useState(0);
  const scan = useRef<DialogCompletionHandle>(null);
  const ai = useRef<DialogCompletionHandle>(null);
  const { search, searchField, facets, exactCode, locationId } = criteria;
  const activeFacets = [
    searchField && t(searchField),
    facets?.building,
    facets?.floor !== undefined && t("floorNumber", { number: facets.floor }),
    facets?.storageFormat && t(`format.${facets.storageFormat}`),
  ].filter(Boolean);

  function retireScan() {
    setScanOpen(false);
    setScanEpoch((epoch) => epoch + 1);
  }

  function cancelScan() {
    if (!scan.current?.completeOwned?.(retireScan)) retireScan();
  }

  function retireAiSearch() {
    setAiOpen(false);
    setAiEpoch((epoch) => epoch + 1);
  }

  function cancelAiSearch() {
    if (!ai.current?.completeOwned?.(retireAiSearch)) retireAiSearch();
  }

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
              searchField || exactCode || locationId || facets
                ? {
                    search,
                    searchField: undefined,
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
                searchField: undefined,
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
      <Dialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        completionRef={scan}
        backRevocationEpoch={scanEpoch}
      >
        <DialogContent
          size="camera"
          showCloseButton={false}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            cancelScan();
          }}
        >
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
                  retireScan();
                  onChange({
                    filter: "ALL",
                    search: code,
                    searchField: undefined,
                    exactCode: locationId ? undefined : true,
                    locationId,
                    facets: undefined,
                  });
                });
              }}
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="fixed top-[max(.75rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] z-10 size-11 rounded-full border border-border bg-surface text-text"
            onClick={cancelScan}
          >
            <X aria-hidden="true" className="size-5" />
            <span className="sr-only">{t("cancel")}</span>
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        completionRef={ai}
        backRevocationEpoch={aiEpoch}
      >
        <DialogContent
          size="sm"
          showCloseButton={false}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            cancelAiSearch();
          }}
          onPointerDownOutside={(event) => {
            event.preventDefault();
            cancelAiSearch();
          }}
        >
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
              onApply={(intent) => {
                ai.current?.completeOwned?.(() => {
                  retireAiSearch();
                  onChange({
                    ...intent,
                    searchField: intent.searchField,
                    facets: intent.facets,
                    exactCode: undefined,
                    locationId: undefined,
                  });
                });
              }}
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute top-3 right-3"
            onClick={cancelAiSearch}
          >
            <X aria-hidden="true" className="size-4" />
            <span className="sr-only">{t("cancel")}</span>
          </Button>
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
    <BarcodeCameraBox
      mode="PACKAGES"
      onCode={(code) => void receive(code)}
      closeControl={false}
      presentation="fullscreen"
      disabled={!active || checking}
      progress={
        <>
          {checking && <p role="status">{t("checkingLocation")}</p>}
          {invalid && (
            <Notice
              tone="warning"
              role="alert"
              title={t("recordTools.invalidCode")}
            />
          )}
        </>
      }
    >
      {({ stopCamera }) => (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const code = new FormData(event.currentTarget).get("code");
            if (typeof code === "string") void receive(code);
          }}
        >
          <Input
            name="code"
            aria-label={t("recordTools.codeInput")}
            aria-invalid={invalid}
            placeholder={t("recordTools.codeInput")}
            className="flex-1 basis-32 font-mono"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            maxLength={500}
            required
            disabled={!active || checking}
            onFocus={stopCamera}
            onChange={() => setInvalid(false)}
          />
          <Button type="submit" disabled={!active || checking}>
            {t("recordTools.searchCode")}
          </Button>
        </form>
      )}
    </BarcodeCameraBox>
  );
}

function RecordSearchPrompt({
  active,
  interpret,
  onApply,
}: {
  active: boolean;
  interpret: (prompt: string) => Promise<JobScanSearchIntent | null>;
  onApply: (result: JobScanSearchIntent) => void;
}) {
  const t = useTranslations("JobScan");
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [intent, setIntent] = useState<JobScanSearchIntent>();
  const request = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => request.current?.abort(), [active]);

  async function submit() {
    if (!active || request.current || !prompt.trim()) return;
    if (intent) {
      onApply(intent);
      return;
    }
    const attempt = new AbortController();
    request.current = attempt;
    setPending(true);
    setError(false);
    try {
      const result = await interpret(prompt.trim());
      if (attempt.signal.aborted) return;
      if (result) setIntent(result);
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
          onChange={(event) => {
            setPrompt(event.target.value);
            setIntent(undefined);
            setError(false);
          }}
          maxLength={500}
          disabled={pending}
          required
        />
      </label>
      {intent && (
        <p
          role="status"
          className="rounded-lg border border-border px-3 py-2 text-sm break-words"
        >
          {[
            t(
              intent.filter === "MAPPED"
                ? "mapped"
                : intent.filter === "UNMAPPED"
                  ? "unmapped"
                  : "all",
            ),
            intent.searchField
              ? `${t(intent.searchField)} · ${intent.search}`
              : intent.search,
            intent.facets?.building,
            intent.facets?.floor !== undefined &&
              t("floorNumber", { number: intent.facets.floor }),
            intent.facets?.storageFormat &&
              t(`format.${intent.facets.storageFormat}`),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {error && (
        <Notice
          tone="warning"
          role="alert"
          title={t("recordTools.aiUnavailable")}
        />
      )}
      <DialogFooter>
        <Button type="submit" disabled={!active || pending || !prompt.trim()}>
          {t(
            pending
              ? "recordTools.requesting"
              : intent
                ? "recordTools.applySearch"
                : "recordTools.searchAction",
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}
