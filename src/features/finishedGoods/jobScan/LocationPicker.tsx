"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useConvex, useQuery } from "convex/react";
import { MapPin, Plus, Search, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { FormField } from "@/components/ui/FormField";
import { IconButton } from "@/components/ui/IconButton";
import { ScanCodeInput } from "@/components/ui/ScanCodeInput";
import { CursorPagination } from "@/components/system/CursorPagination";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { useScanContinuation } from "@/hooks/useScanContinuation";
import { useCatalogueSync } from "@/hooks/useCatalogueSync";
import { useDebouncedSearch } from "@/hooks/useScanContinuation";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { BarcodeCameraBox } from "../BarcodeCameraBox";
import type { BarcodeCrop } from "../barcodeDecoder";
import { Button } from "@/components/ui/button";
import { AddLocationForm } from "./AddLocationForm";
import type { PickedLocation } from "./ticketDraft";
import {
  LocationImageReader,
  locationPhoto,
  type LocationPhoto,
} from "./LocationImageReader";

/** Search or scan a known location; optionally accept free text as an unmapped location. */
interface LocationPickerProps {
  warehouseId: string;
  onPick: (location: PickedLocation) => void;
  allowUnmapped?: boolean;
  canReadImage?: boolean;
}

export function LocationPicker(props: LocationPickerProps) {
  return (
    <LocationPickerSession
      key={`${props.warehouseId}:${props.allowUnmapped ?? true}:${props.canReadImage ?? false}`}
      {...props}
    />
  );
}

function LocationPickerSession({
  warehouseId,
  onPick,
  allowUnmapped = true,
  canReadImage = false,
}: LocationPickerProps) {
  const t = useTranslations("JobScan");
  const locale = useLocale();
  const convex = useConvex();
  const inputId = useId();
  const [text, setText] = useState("");
  const [camera, setCamera] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [confirmedMissing, setConfirmedMissing] = useState<string>();

  const lookupVersion = useRef(0);
  const cameraOpen = useRef(false);
  const [checking, setChecking] = useState(false);
  const [ai, setAi] = useState<{ photo?: LocationPhoto }>();
  useEffect(
    () => () => {
      lookupVersion.current += 1;
    },
    [warehouseId, allowUnmapped],
  );
  const settledText = useDebouncedSearch(text);
  const criteria = { warehouseId, text: settledText };
  const paging = useCursorPagination({
    scope: `job-location-picker:${warehouseId}`,
    criteria,
  });
  const scan = useScanContinuation(
    JSON.stringify([criteria, paging.cursor, paging.pageSize]),
  );
  const outcome = useQuery(fgRefs.searchJobScanLocations, {
    ...criteria,
    pageSize: paging.pageSize,
    ...(paging.cursor ? { cursor: paging.cursor } : {}),
    ...(scan.cursor ? { scanCursor: scan.cursor } : {}),
  });
  useCatalogueSync({
    outcome,
    continuation: scan,
    paging,
    resetKey: JSON.stringify(criteria),
  });
  const result = outcome?.ok ? outcome.value : undefined;
  const zones = result?.items ?? [];
  const trimmed = text.trim();
  // Exact lookup is bounded by code indexes; catalogue search may need many
  // continuation requests. Reuse a scan's answer instead of waiting for search.
  const exact = useQuery(
    fgRefs.resolveJobScanLocation,
    trimmed && text === settledText && confirmedMissing !== trimmed
      ? { warehouseId, code: trimmed }
      : "skip",
  );
  const canCreate =
    !checking &&
    !camera &&
    Boolean(trimmed) &&
    (confirmedMissing === trimmed ||
      (text === settledText &&
        exact?.ok &&
        !exact.value.ok &&
        exact.value.error?.code === "LOCATION_NOT_FOUND"));

  function cancelScan() {
    lookupVersion.current += 1;
    cameraOpen.current = false;
    setCamera(false);
    setChecking(false);
    setAi(undefined);
  }
  function choose(location: PickedLocation) {
    cancelScan();
    onPick(location);
  }
  async function onScan(code: string, scannerVersion: number) {
    if (!cameraOpen.current || scannerVersion !== lookupVersion.current) return;
    const version = ++lookupVersion.current;
    cameraOpen.current = false;
    setCamera(false);
    setChecking(true);
    setConfirmedMissing(undefined);
    setNotice(undefined);
    try {
      const result = await convex.query(fgRefs.resolveJobScanLocation, {
        warehouseId,
        code,
      });
      // A cancelled picker or a newer scan must not apply a late lookup result.
      if (version !== lookupVersion.current) return;
      if (!result.ok) {
        setNotice(t("locationLookupDenied"));
        return;
      }
      const location = result.value.ok ? result.value.location : undefined;
      if (location) {
        choose({ ...location, text: location.code });
      } else if (
        !result.value.ok &&
        result.value.error.code === "LOCATION_NOT_FOUND" &&
        !/^ISAS:/i.test(code) &&
        code.length <= 200
      ) {
        setText(code);
        setConfirmedMissing(code.trim());
      } else {
        setNotice(t("locationScanNotFound"));
      }
    } catch {
      if (version === lookupVersion.current)
        setNotice(t("locationLookupFailed"));
    } finally {
      if (version === lookupVersion.current) setChecking(false);
    }
  }

  const scannerVersion = lookupVersion.current;

  return (
    <div className="space-y-3">
      <FormField id={inputId} label={t("searchLocation")} srOnlyLabel>
        {(control) => (
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            />
            <ScanCodeInput
              {...control}
              scanLabel={camera && !ai ? t("stopCamera") : t("scanLocationQr")}
              scanning={camera && !ai}
              trailingAction={
                canReadImage ? (
                  <IconButton
                    label={t("openLocationAiCamera")}
                    variant="ghost"
                    className="size-11 shrink-0"
                    aria-pressed={Boolean(ai)}
                    onClick={() => {
                      const opening = !ai;
                      cancelScan();
                      setAdding(false);
                      setNotice(undefined);
                      if (opening) {
                        cameraOpen.current = true;
                        setCamera(true);
                        setAi({});
                      }
                    }}
                  >
                    <Sparkles aria-hidden="true" className="size-5" />
                  </IconButton>
                ) : undefined
              }
              onScan={() => {
                cancelScan();
                setConfirmedMissing(undefined);
                setAdding(false);
                setNotice(undefined);
                if (!camera || ai) {
                  cameraOpen.current = true;
                  setCamera(true);
                }
              }}
              value={text}
              onChange={(event) => {
                cancelScan();
                setConfirmedMissing(undefined);
                setAdding(false);
                setText(event.target.value);

                setNotice(undefined);
              }}
              placeholder={t("searchPlaceholder")}
              className="min-h-12 pl-9"
              autoComplete="off"
              maxLength={200}
            />
          </div>
        )}
      </FormField>
      {camera &&
        (ai ? (
          <LocationImageReader
            {...(ai.photo ? { initialPhoto: ai.photo } : {})}
            extract={async (imageDataUrl) => {
              const result = await convex.action(fgRefs.extractLocationLabel, {
                warehouseId,
                imageDataUrl,
              });
              return result.ok
                ? result.value
                : { ok: false, error: { code: "AI_DENIED" } };
            }}
            onConfirm={(code) => void onScan(code, scannerVersion)}
            onClose={() => {
              lookupVersion.current++;
              setAi(undefined);
            }}
          />
        ) : (
          <BarcodeCameraBox
            mode="LOCATION"
            startOnMount
            onCode={(code) => void onScan(code, scannerVersion)}
            onClose={cancelScan}
            {...(canReadImage
              ? {
                  onReadWithAi: (file?: File, crop?: BarcodeCrop) => {
                    if (!cameraOpen.current) return;
                    lookupVersion.current++;
                    setAi(file ? { photo: locationPhoto(file, crop) } : {});
                  },
                }
              : {})}
          />
        ))}
      {checking && (
        <p role="status" className="text-sm text-muted">
          {t("checkingLocation")}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-warning">
          {notice}
        </p>
      )}
      {adding && (
        <AddLocationForm
          key={warehouseId}
          warehouseId={warehouseId}
          initialCode={trimmed}
          onPick={choose}
          onCancel={() => {
            setAdding(false);
            document.getElementById(inputId)?.focus();
          }}
        />
      )}
      {!adding && canCreate && (
        <div className="space-y-2">
          <p role="status" className="text-sm text-muted">
            {t("locationMissing", { code: trimmed })}
          </p>
          <Button
            type="button"
            onClick={() => {
              cancelScan();
              setAdding(true);
              setNotice(undefined);
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
            {t("addLocation")}
          </Button>
        </div>
      )}
      {!adding && (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {zones.map((zone) => (
            <li key={zone.locationId ?? zone.zoneId}>
              <button
                type="button"
                className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-raised focus-visible:bg-raised focus-visible:outline-none"
                onClick={() => choose({ ...zone, text: zone.code })}
              >
                <MapPin
                  className="size-4 shrink-0 text-muted"
                  aria-hidden="true"
                />
                <span className="min-w-0 shrink-0 font-mono font-semibold break-all sm:break-normal">
                  {zone.code}
                </span>
                <span className="min-w-0 truncate text-sm text-muted">
                  {zone.buildingName
                    ? [
                        zone.buildingName,
                        zone.floorNumber === undefined
                          ? undefined
                          : t("floorNumber", { number: zone.floorNumber }),
                        zone.name,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : zone.name}
                </span>
              </button>
            </li>
          ))}
          {outcome && !zones.length && (
            <li className="px-3 py-3 text-sm text-muted">
              {t("noLocationMatch")}
            </li>
          )}
          {allowUnmapped && canCreate && (
            <li>
              <button
                type="button"
                className="flex min-h-12 w-full flex-col items-start px-3 py-2 text-left hover:bg-raised focus-visible:bg-raised focus-visible:outline-none"
                onClick={() => choose({ text: trimmed })}
              >
                <span className="font-semibold text-warning">
                  {t("useUnmapped", { text: trimmed })}
                </span>
                <span className="text-xs text-muted">{t("unmappedHint")}</span>
              </button>
            </li>
          )}
        </ul>
      )}
      {!adding && !canCreate && result?.status === "scanning" && (
        <p role="status" className="text-sm text-muted">
          {t("checkingLocation")}
        </p>
      )}
      {!adding && outcome && !outcome.ok && (
        <p role="alert" className="text-sm text-danger">
          {t("locationLookupDenied")}
        </p>
      )}
      {!adding &&
        result?.status === "ready" &&
        (paging.canPrevious || !result.isDone) && (
          <CursorPagination
            locale={locale}
            page={paging.page}
            pageSize={paging.pageSize}
            onPageSizeChange={paging.setPageSize}
            onPrevious={paging.previous}
            onNext={() => paging.next(result.continueCursor)}
            canPrevious={paging.canPrevious}
            canNext={!result.isDone}
          />
        )}
    </div>
  );
}
