"use client";

import { useEffect, useRef, useState } from "react";
import { useConvex, useQuery } from "convex/react";
import { MapPin, ScanQrCode, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { PaginationFooter } from "@/components/system/PaginationFooter";
import { useDebouncedSearch } from "@/hooks/useScanContinuation";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { BarcodeCameraBox } from "./BarcodeCameraBox";
import type { PickedLocation } from "./ticketDraft";

/** Search or scan a known location; optionally accept free text as an unmapped location. */
export function LocationPicker({
  warehouseId,
  onPick,
  allowUnmapped = true,
}: {
  warehouseId: string;
  onPick: (location: PickedLocation) => void;
  allowUnmapped?: boolean;
}) {
  const t = useTranslations("JobScan");
  const tp = useTranslations("Pagination");
  const convex = useConvex();
  const [text, setText] = useState("");
  const [camera, setCamera] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [page, setPage] = useState(1);
  const lookupVersion = useRef(0);
  useEffect(
    () => () => {
      lookupVersion.current += 1;
    },
    [],
  );
  const settledText = useDebouncedSearch(text);
  const outcome = useQuery(fgRefs.searchJobScanLocations, {
    warehouseId,
    text: settledText,
    page,
  });
  const result = outcome?.ok ? outcome.value : undefined;
  const zones = result?.items ?? [];
  const trimmed = text.trim();

  async function onScan(code: string) {
    const version = ++lookupVersion.current;
    setCamera(false);
    const result = await convex.query(fgRefs.resolveLocationCode, {
      warehouseId,
      code,
    });
    // A cancelled picker or a newer scan must not apply a late lookup result.
    if (version !== lookupVersion.current) return;
    const location =
      result.ok && result.value.ok ? result.value.location : undefined;
    if (location) {
      onPick({
        text: location.code,
        zoneId: location.zoneId,
        ...(location.supportPositionId
          ? { supportPositionId: location.supportPositionId }
          : {}),
        code: location.code,
        name: location.name,
      });
    } else if (allowUnmapped) {
      setText(code);
      setNotice(t("notFoundUnmapped", { code }));
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <label className="block">
          <span className="sr-only">{t("searchLocation")}</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
          />
          <Input
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setPage(1);
              setNotice(undefined);
            }}
            placeholder={t("searchPlaceholder")}
            className="min-h-12 pr-12 pl-9"
            autoComplete="off"
            maxLength={200}
          />
        </label>
        <button
          type="button"
          className={`absolute top-1/2 right-1 flex size-11 -translate-y-1/2 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${camera ? "text-link" : "text-muted hover:text-text"}`}
          aria-label={camera ? t("stopCamera") : t("scanLocationQr")}
          title={t("scanLocationQr")}
          aria-pressed={camera}
          onClick={() => {
            setNotice(undefined);
            setCamera((open) => !open);
          }}
        >
          <ScanQrCode className="size-5" aria-hidden="true" />
        </button>
      </div>
      {camera && (
        <BarcodeCameraBox
          mode="LOCATION"
          onCode={(code) => void onScan(code)}
          onClose={() => setCamera(false)}
        />
      )}
      {notice && (
        <p role="status" className="text-sm text-warning">
          {notice}
        </p>
      )}
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {zones.map((zone) => (
          <li key={zone.zoneId}>
            <button
              type="button"
              className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-raised focus-visible:bg-raised focus-visible:outline-none"
              onClick={() =>
                onPick({
                  text: zone.code,
                  zoneId: zone.zoneId,
                  code: zone.code,
                  name: zone.name,
                })
              }
            >
              <MapPin
                className="size-4 shrink-0 text-muted"
                aria-hidden="true"
              />
              <span className="min-w-0 shrink-0 font-mono font-semibold break-all sm:break-normal">
                {zone.code}
              </span>
              <span className="min-w-0 truncate text-sm text-muted">
                {zone.name}
              </span>
            </button>
          </li>
        ))}
        {outcome && !zones.length && (
          <li className="px-3 py-3 text-sm text-muted">
            {t("noLocationMatch")}
          </li>
        )}
        {allowUnmapped && trimmed && (
          <li>
            <button
              type="button"
              className="flex min-h-12 w-full flex-col items-start px-3 py-2 text-left hover:bg-raised focus-visible:bg-raised focus-visible:outline-none"
              onClick={() => onPick({ text: trimmed })}
            >
              <span className="font-semibold text-warning">
                {t("useUnmapped", { text: trimmed })}
              </span>
              <span className="text-xs text-muted">{t("unmappedHint")}</span>
            </button>
          </li>
        )}
      </ul>
      {result && result.pages > 1 && (
        <PaginationFooter
          label={tp("pagination")}
          pageSizeControl={
            <span className="text-sm text-muted">
              {t("locationCount", { count: result.total })}
            </span>
          }
          status={t("pageOf", { page: result.page, pages: result.pages })}
          previousLabel={tp("previousPage")}
          nextLabel={tp("nextPage")}
          canPrevious={result.page > 1}
          canNext={result.page < result.pages}
          onPrevious={() => setPage(result.page - 1)}
          onNext={() => setPage(result.page + 1)}
        />
      )}
    </div>
  );
}
