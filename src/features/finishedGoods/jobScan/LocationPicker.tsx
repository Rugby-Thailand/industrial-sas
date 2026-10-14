"use client";

import { useBackDisclosure } from "@/hooks/useBackDisclosure";
import { useEffect, useId, useRef, useState } from "react";
import { useConvex, useQuery } from "convex/react";
import { Popover } from "radix-ui";
import { Building2, Camera, MapPin, Plus, Search, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { FormField } from "@/components/ui/FormField";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import { ScanCodeInput } from "@/components/ui/ScanCodeInput";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { CursorPagination } from "@/components/system/CursorPagination";
import { QueryErrorBoundary } from "@/components/system/QueryErrorBoundary";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { useScanRecovery } from "@/hooks/useScanRecovery";
import {
  useCatalogueSync,
  type CatalogueOutcome,
} from "@/hooks/useCatalogueSync";
import { useDebouncedSearch } from "@/hooks/useScanContinuation";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { cn } from "@/lib/utils";
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

/** Search, scan or photograph a known location; optionally accept free text as an unmapped location. */
interface LocationPickerProps {
  warehouseId: string;
  onPick: (location: PickedLocation) => void;
  allowUnmapped?: boolean;
  canReadImage?: boolean;
  /**
   * @deprecated Every picker now lists the first page without a search. Kept
   * so existing callers compile; it has no effect.
   */
  browseWithoutSearch?: boolean;
  /**
   * `jobScan` is the Scan job ticket location step, where finding the area
   * is the whole screen: a larger barcode preview, an icon image picker and
   * a retry centred on the AI photo. Other pickers keep the default.
   */
  presentation?: "default" | "jobScan";
}

type Choice = {
  locationId: string;
  zoneId?: string;
  supportPositionId?: string;
  buildingId?: string;
  buildingName?: string;
  buildingCode?: string;
  floorId?: string;
  floorNumber?: number;
  code: string;
  name: string;
  layoutPending?: boolean;
};
type SearchValue = {
  status: "ready" | "scanning" | "reset";
  items?: readonly Choice[];
  isDone: boolean;
  continueCursor: string;
  scanCursor?: string;
  phase?: string;
  buildingUnavailable?: boolean;
};
type BuildingChoice = { id: string; label: string };

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
  presentation = "default",
}: LocationPickerProps) {
  const t = useTranslations("JobScan");
  const convex = useConvex();
  const inputId = useId();
  const [text, setText] = useState("");
  const [camera, setCamera] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [mismatch, setMismatch] = useState<{
    code: string;
    building: string;
  }>();
  const [adding, setAdding] = useState(false);
  const [confirmedMissing, setConfirmedMissing] = useState<string>();
  const [building, setBuilding] = useState<BuildingChoice | null>(null);
  const [retry, setRetry] = useState(0);

  const lookupVersion = useRef(0);
  const acquisitionOpen = useRef(false);
  const [checking, setChecking] = useState(false);
  const [ai, setAi] = useState<{ photo?: LocationPhoto }>();
  const [qrBeforeAi, setQrBeforeAi] = useState(false);
  const lastCameraMode = useRef<"QR" | "AI">("QR");
  const lastAi = useRef<{ photo?: LocationPhoto }>({});
  const aiDisclosure = useBackDisclosure(Boolean(ai) && qrBeforeAi, (open) => {
    lookupVersion.current += 1;
    acquisitionOpen.current = true;
    setAi(open ? lastAi.current : undefined);
  });
  const cameraDisclosure = useBackDisclosure(camera, (open) => {
    if (!open) cancelScan();
    else {
      acquisitionOpen.current = true;
      setCamera(true);
      setAi(lastCameraMode.current === "AI" ? lastAi.current : undefined);
    }
  });
  const registrationDisclosure = useBackDisclosure(adding, setAdding);

  useEffect(
    () => () => {
      lookupVersion.current += 1;
    },
    [warehouseId, allowUnmapped],
  );
  const settledText = useDebouncedSearch(text);
  const trimmed = text.trim();
  const scannedMissing =
    !checking && !camera && Boolean(trimmed) && confirmedMissing === trimmed;

  function cancelScan() {
    lookupVersion.current += 1;
    acquisitionOpen.current = false;
    setCamera(false);
    setChecking(false);
    setAi(undefined);
  }
  function finishAcquisition(action: () => void) {
    // A manual choice or dismissal supersedes an earlier scan immediately,
    // including while the owned history entry is still being consumed.
    lookupVersion.current += 1;
    acquisitionOpen.current = false;
    const finish = () => {
      cancelScan();
      action();
    };
    if (camera && ai && qrBeforeAi)
      aiDisclosure.complete(() => cameraDisclosure.complete(finish));
    else if (camera) cameraDisclosure.complete(finish);
    else finish();
  }
  function choose(location: PickedLocation) {
    if (adding) {
      registrationDisclosure.complete(() => {
        setAdding(false);
        onPick(location);
      });
    } else finishAcquisition(() => onPick(location));
  }
  function changeBuilding(next: BuildingChoice | null) {
    // A building change invalidates any in-flight scan answer for the old scope.
    cancelScan();
    setMismatch(undefined);
    setNotice(undefined);
    setBuilding(next);
  }
  function startAdding() {
    cancelScan();
    setAdding(true);
    setNotice(undefined);
  }
  async function onScan(code: string, scannerVersion: number) {
    if (!acquisitionOpen.current || scannerVersion !== lookupVersion.current)
      return;
    const version = ++lookupVersion.current;
    acquisitionOpen.current = false;
    setChecking(true);
    setConfirmedMissing(undefined);
    setNotice(undefined);
    setMismatch(undefined);
    try {
      const result = await convex.query(fgRefs.resolveJobScanLocation, {
        warehouseId,
        code,
        ...(building ? { buildingId: building.id } : {}),
      });
      // A cancelled picker or a newer scan must not apply a late lookup result.
      if (version !== lookupVersion.current) return;
      if (!result.ok) {
        finishAcquisition(() => setNotice(t("locationLookupDenied")));
        return;
      }
      const location = result.value.ok ? result.value.location : undefined;
      if (location) {
        choose({ ...location, text: location.code });
      } else if (
        !result.value.ok &&
        result.value.error.code === "OUTSIDE_BUILDING_FILTER" &&
        "location" in result.value
      ) {
        // Never widen the filter silently: say where the label belongs.
        const found = result.value.location as Choice;
        finishAcquisition(() =>
          setMismatch({
            code: found.code,
            building: found.buildingName ?? found.buildingCode ?? "",
          }),
        );
      } else if (
        !result.value.ok &&
        result.value.error.code === "LOCATION_NOT_FOUND" &&
        !/^ISAS:/i.test(code) &&
        code.length <= 200
      ) {
        finishAcquisition(() => {
          setText(code);
          setConfirmedMissing(code.trim());
        });
      } else {
        finishAcquisition(() => setNotice(t("locationScanNotFound")));
      }
    } catch {
      if (version === lookupVersion.current)
        finishAcquisition(() => setNotice(t("locationLookupFailed")));
    } finally {
      if (version === lookupVersion.current) setChecking(false);
    }
  }

  const scannerVersion = lookupVersion.current;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <FormField
          id={inputId}
          label={t("searchLocation")}
          srOnlyLabel
          className="min-w-0 flex-1"
        >
          {(control) => (
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted"
              />
              <ScanCodeInput
                {...control}
                scanLabel={t("scanCode")}
                scanning={camera && !ai}
                onScan={() => {
                  const opening = !camera || Boolean(ai);
                  cancelScan();
                  setConfirmedMissing(undefined);
                  setAdding(false);
                  setNotice(undefined);
                  setMismatch(undefined);
                  if (opening) {
                    lastCameraMode.current = "QR";
                    acquisitionOpen.current = true;
                    setCamera(true);
                  }
                }}
                trailingAction={
                  canReadImage ? (
                    <IconButton
                      label={t("photoAi")}
                      variant="ghost"
                      aria-pressed={Boolean(ai)}
                      className="shrink-0"
                      onClick={() => {
                        const opening = !ai;
                        cancelScan();
                        setAdding(false);
                        setNotice(undefined);
                        setMismatch(undefined);
                        if (opening) {
                          lastCameraMode.current = "AI";
                          lastAi.current = {};
                          acquisitionOpen.current = true;
                          setCamera(true);
                          setQrBeforeAi(false);
                          setAi(lastAi.current);
                        }
                      }}
                    >
                      <Camera aria-hidden="true" className="size-5" />
                    </IconButton>
                  ) : undefined
                }
                value={text}
                onChange={(event) => {
                  cancelScan();
                  setConfirmedMissing(undefined);
                  setAdding(false);
                  setText(event.target.value);
                  setNotice(undefined);
                  setMismatch(undefined);
                }}
                placeholder={t("searchPlaceholder")}
                className="min-h-12 pl-9 dense:h-11"
                autoComplete="off"
                maxLength={200}
              />
            </div>
          )}
        </FormField>
        <BuildingFilter
          warehouseId={warehouseId}
          value={building}
          onChange={changeBuilding}
        />
      </div>
      {building && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md border border-border bg-raised py-1 pr-1 pl-2 text-sm">
            <Building2
              aria-hidden="true"
              className="size-4 shrink-0 text-muted"
            />
            <span className="min-w-0 truncate">
              {t("buildingFilterValue", { name: building.label })}
            </span>
            <IconButton
              label={t("clearBuildingFilter")}
              variant="ghost"
              className="shrink-0"
              onClick={() => changeBuilding(null)}
            >
              <X aria-hidden="true" />
            </IconButton>
          </span>
        </div>
      )}
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
              if (qrBeforeAi) aiDisclosure.onOpenChange(false);
              else cameraDisclosure.onOpenChange(false);
            }}
            retryOverPhoto={presentation === "jobScan"}
          />
        ) : (
          <BarcodeCameraBox
            mode="LOCATION"
            startOnMount
            presentation={presentation === "jobScan" ? "expanded" : "default"}
            onCode={(code) => void onScan(code, scannerVersion)}
            // The pressed scan action owns closing; a second frame close would repeat it.
            closeControl={false}
            {...(canReadImage
              ? {
                  onReadWithAi: (file?: File, crop?: BarcodeCrop) => {
                    if (!acquisitionOpen.current) return;
                    lookupVersion.current++;
                    lastAi.current = file
                      ? { photo: locationPhoto(file, crop) }
                      : {};
                    setQrBeforeAi(true);
                    setAi(lastAi.current);
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
      {mismatch && (
        <div className="space-y-2">
          <p role="status" className="text-sm text-warning">
            {t("locationOutsideBuilding", mismatch)}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const code = mismatch.code;
              changeBuilding(null);
              setText(code);
            }}
          >
            {t("showAllBuildings")}
          </Button>
        </div>
      )}
      {adding && (
        <AddLocationForm
          key={warehouseId}
          warehouseId={warehouseId}
          initialCode={trimmed}
          draftScope={registrationDisclosure.scope}
          onPick={choose}
          onCancel={() => {
            registrationDisclosure.onOpenChange(false);
            document.getElementById(inputId)?.focus();
          }}
        />
      )}
      {!adding && scannedMissing && (
        <MissingLocation code={trimmed} onAdd={startAdding} />
      )}
      {!adding && (
        <QueryErrorBoundary
          resetKey={`${warehouseId}:${settledText}:${building?.id ?? ""}:${retry}`}
          fallback={() => (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-danger">
                {t("locationListFailed")}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRetry((value) => value + 1)}
              >
                {t("retryLocations")}
              </Button>
            </div>
          )}
        >
          <LocationChoices
            warehouseId={warehouseId}
            text={text}
            settledText={settledText}
            building={building}
            onClearBuilding={() => changeBuilding(null)}
            allowUnmapped={allowUnmapped}
            scannedMissing={scannedMissing}
            confirmedMissing={confirmedMissing}
            acquiring={checking || camera}
            onChoose={choose}
            onAdd={startAdding}
          />
        </QueryErrorBoundary>
      )}
    </div>
  );
}

/**
 * Whether a `reset` answer needs the user. Mirrors `useCatalogueSync`, which
 * restarts once per scope when there is a cursor to drop and re-arms only
 * after a ready answer. A reset with nothing to drop, or any later reset
 * before a ready answer, cannot recover by itself. `answerKey` identifies the
 * request, so re-rendering the same answer is not counted again.
 */
function useResetEscalation(
  scope: string,
  answerKey: string,
  status: string | undefined,
  hasCursor: boolean,
) {
  const [seen, setSeen] = useState<{
    scope: string;
    spent: boolean;
    pending?: string | undefined;
  }>({ scope, spent: false });
  const state = seen.scope === scope ? seen : { scope, spent: false };
  let stuck = false;
  if (status === "reset") {
    if (!state.spent) {
      if (hasCursor) setSeen({ scope, spent: true, pending: answerKey });
    } else if (state.pending !== answerKey) stuck = true;
  } else if (status === "ready" && state.spent)
    setSeen({ scope, spent: false });
  else if (status === "scanning" && state.pending !== undefined)
    setSeen({ scope, spent: state.spent });
  return status === "reset" && (!hasCursor || stuck);
}

function MissingLocation({ code, onAdd }: { code: string; onAdd: () => void }) {
  const t = useTranslations("JobScan");
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">{t("locationMissing", { code })}</p>
      <Button type="button" onClick={onAdd}>
        <Plus aria-hidden="true" className="size-4" />
        {t("addLocation")}
      </Button>
    </div>
  );
}

/** Choice list, exact match and pager for the current criteria. */
function LocationChoices({
  warehouseId,
  text,
  settledText,
  building,
  onClearBuilding,
  allowUnmapped,
  scannedMissing,
  confirmedMissing,
  acquiring,
  onChoose,
  onAdd,
}: {
  warehouseId: string;
  text: string;
  settledText: string;
  building: BuildingChoice | null;
  onClearBuilding: () => void;
  allowUnmapped: boolean;
  scannedMissing: boolean;
  confirmedMissing: string | undefined;
  acquiring: boolean;
  onChoose: (location: PickedLocation) => void;
  onAdd: () => void;
}) {
  const t = useTranslations("JobScan");
  const locale = useLocale();
  const trimmed = text.trim();
  const typing = text !== settledText;
  const criteria = {
    warehouseId,
    text: settledText,
    ...(building ? { buildingId: building.id } : {}),
  };
  const criteriaKey = JSON.stringify(criteria);
  const paging = useCursorPagination({
    scope: `job-location-picker:${warehouseId}`,
    criteria,
  });
  const pageKey = JSON.stringify([criteria, paging.cursor, paging.pageSize]);
  const recovery = useScanRecovery(pageKey);
  const outcome = useQuery(fgRefs.searchJobScanLocations, {
    ...criteria,
    pageSize: paging.pageSize,
    ...(paging.cursor ? { cursor: paging.cursor } : {}),
    ...(recovery.cursor ? { scanCursor: recovery.cursor } : {}),
    ...(recovery.attempt ? { attempt: recovery.attempt } : {}),
  });
  const tracked = recovery.track(outcome);
  useCatalogueSync({
    outcome: tracked.outcome,
    continuation: tracked.continuation,
    paging,
    resetKey: `${criteriaKey}:${recovery.attempt}`,
  });
  const denied = outcome !== undefined && !outcome.ok;
  // Exact identity lookup runs once per settled text and scope, independently
  // of the list. Its arguments carry every criterion, so an answer for older
  // text, warehouse or building can never be shown.
  const exact = useQuery(
    fgRefs.resolveJobScanLocation,
    trimmed && !typing && confirmedMissing !== trimmed
      ? {
          warehouseId,
          code: trimmed,
          ...(building ? { buildingId: building.id } : {}),
        }
      : "skip",
  );

  // Continuation steps change the query arguments, and Convex answers
  // `undefined` until each step returns. Keep the last authorized answer for
  // the same criteria so rows found so far stay visible while the search
  // continues. A denial discards it: nothing previously read stays usable.
  const fresh = outcome?.ok ? (outcome.value as SearchValue) : undefined;
  const signature = fresh
    ? [
        fresh.status,
        fresh.isDone,
        fresh.continueCursor,
        fresh.scanCursor ?? "",
        (fresh.items ?? []).map((row) => row.locationId).join(","),
      ].join("|")
    : "";
  const [held, setHeld] = useState<{
    key: string;
    criteria: string;
    signature: string;
    value: SearchValue;
  }>();
  if (denied && held) setHeld(undefined);
  if (fresh && (held?.key !== pageKey || held.signature !== signature))
    setHeld({ key: pageKey, criteria: criteriaKey, signature, value: fresh });
  const kept = denied ? undefined : held;
  const current = fresh ?? (kept?.key === pageKey ? kept.value : undefined);
  // Another page of the same criteria may keep its footprint, but disabled.
  const previous =
    !current && kept?.criteria === criteriaKey ? kept.value : undefined;
  const shown = current ?? previous;
  const ready = current?.status === "ready";
  const complete = ready && !typing;
  // `ready` completes this page only; `isDone` on a ready page means no later
  // row matches. Only that may establish that typed text is absent.
  const exhausted = complete && Boolean(current?.isDone);
  const interactive = Boolean(current) && !typing && !denied;

  const resetStuck =
    useResetEscalation(
      criteriaKey,
      JSON.stringify([pageKey, recovery.cursor ?? "", recovery.attempt]),
      fresh?.status,
      Boolean(paging.cursor || recovery.cursor),
    ) && !typing;
  const stalled = tracked.stalled && !typing;
  const paused = tracked.paused && !typing;
  const retry = () => {
    if (resetStuck) paging.reset();
    recovery.retry();
  };

  const exactValue = exact?.ok && !denied ? exact.value : undefined;
  const exactChoice =
    !typing && exactValue?.ok && paging.page === 1
      ? (exactValue.location as Choice)
      : undefined;
  const outside =
    !typing &&
    exactValue &&
    !exactValue.ok &&
    exactValue.error?.code === "OUTSIDE_BUILDING_FILTER" &&
    "location" in exactValue
      ? (exactValue.location as Choice)
      : undefined;
  const rows = (shown?.items ?? []).filter(
    (row) => !exactChoice || row.locationId !== exactChoice.locationId,
  );
  const typedMissing =
    !acquiring &&
    Boolean(trimmed) &&
    !typing &&
    exactValue !== undefined &&
    !exactValue.ok &&
    exactValue.error?.code === "LOCATION_NOT_FOUND";
  // A typed code is not "unregistered" until the whole search is exhausted;
  // a barcode-confirmed miss (`scannedMissing`) is offered immediately.
  const typedCanCreate = typedMissing && exhausted && !scannedMissing;
  const offerUnmapped =
    allowUnmapped && (scannedMissing || (typedMissing && exhausted));
  const searching = Boolean(settledText.trim()) || typing;
  const status = typing
    ? t("searchingLocations")
    : denied || resetStuck || stalled
      ? ""
      : paused
        ? t("locationSearchPaused")
        : !current
          ? searching
            ? t("searchingLocations")
            : t("loadingLocations")
          : current.status === "scanning" || current.status === "reset"
            ? rows.length || exactChoice
              ? t("searchingMoreLocations")
              : t("searchingLocations")
            : "";
  const settledCount =
    complete && current ? rows.length + (exactChoice ? 1 : 0) : undefined;
  const noMatch = exhausted && !rows.length && !exactChoice;
  const choiceButton =
    "flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-raised focus-visible:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:hover:bg-transparent";

  return (
    <div className="space-y-3">
      <p
        role="status"
        className={status ? "text-sm text-muted" : "sr-only"}
        data-testid="location-search-status"
      >
        {status ||
          (settledCount === undefined
            ? ""
            : t("locationCount", { count: settledCount }))}
      </p>
      {denied && (
        <p role="alert" className="text-sm text-danger">
          {t("locationLookupDenied")}
        </p>
      )}
      {!denied && (resetStuck || stalled) && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-danger">
            {t(resetStuck ? "locationListFailed" : "locationSearchStalled")}
          </p>
          <Button type="button" variant="outline" onClick={retry}>
            {t("retryLocations")}
          </Button>
        </div>
      )}
      {!denied && paused && (
        <Button type="button" variant="outline" onClick={recovery.resume}>
          {t("keepSearching")}
        </Button>
      )}
      {current?.buildingUnavailable && (
        <div className="space-y-2">
          <p role="status" className="text-sm text-warning">
            {t("buildingUnavailable")}
          </p>
          <Button type="button" variant="outline" onClick={onClearBuilding}>
            {t("showAllBuildings")}
          </Button>
        </div>
      )}
      {outside && (
        <div className="space-y-2">
          <p role="status" className="text-sm text-warning">
            {t("locationOutsideBuilding", {
              code: outside.code,
              building: outside.buildingName ?? outside.buildingCode ?? "",
            })}
          </p>
          <Button type="button" variant="outline" onClick={onClearBuilding}>
            {t("showAllBuildings")}
          </Button>
        </div>
      )}
      <ul
        aria-label={t("locationResults")}
        aria-busy={
          (!complete && !denied && !resetStuck && !stalled && !paused) ||
          undefined
        }
        className={cn(
          "divide-y divide-border overflow-hidden rounded-lg border border-border transition-opacity",
          !interactive && rows.length > 0 && "opacity-60",
        )}
      >
        {exactChoice && (
          <li>
            <button
              type="button"
              className={choiceButton}
              onClick={() =>
                onChoose({ ...exactChoice, text: exactChoice.code })
              }
            >
              <ChoiceText choice={exactChoice} />
              <StatusBadge tone="accent" label={t("exactLocationMatch")} />
            </button>
          </li>
        )}
        {rows.map((zone) => (
          <li key={zone.locationId ?? zone.zoneId}>
            <button
              type="button"
              className={choiceButton}
              disabled={!interactive}
              onClick={() => onChoose({ ...zone, text: zone.code })}
            >
              <ChoiceText choice={zone} />
            </button>
          </li>
        ))}
        {!shown &&
          !exactChoice &&
          !denied &&
          !resetStuck &&
          !stalled &&
          [0, 1, 2].map((row) => (
            <li key={row} aria-hidden="true" className="px-3 py-3">
              <Skeleton className="h-6 w-2/3" />
            </li>
          ))}
        {noMatch && (
          <li className="px-3 py-3 text-sm text-muted">
            {settledText.trim() || building
              ? t("noLocationMatch")
              : t("noLocationsAvailable")}
          </li>
        )}
        {offerUnmapped && (
          <li>
            <button
              type="button"
              className="flex min-h-12 w-full flex-col items-start px-3 py-2 text-left hover:bg-raised focus-visible:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
              onClick={() => onChoose({ text: trimmed })}
            >
              <span className="font-semibold text-warning">
                {t("useUnmapped", { text: trimmed })}
              </span>
              <span className="text-xs text-muted">{t("unmappedHint")}</span>
            </button>
          </li>
        )}
      </ul>
      {typedCanCreate && <MissingLocation code={trimmed} onAdd={onAdd} />}
      {shown && (
        <CursorPagination
          locale={locale}
          page={paging.page}
          pageSize={paging.pageSize}
          onPageSizeChange={paging.setPageSize}
          onPrevious={paging.previous}
          onNext={() => {
            if (ready && current) paging.next(current.continueCursor);
          }}
          canPrevious={paging.canPrevious}
          canNext={Boolean(ready && current && !current.isDone)}
          loading={!ready || typing}
        />
      )}
    </div>
  );
}

function ChoiceText({ choice }: { choice: Choice }) {
  const t = useTranslations("JobScan");
  // The code is always shown; an equal name would only repeat it.
  const name = choice.name === choice.code ? undefined : choice.name;
  const detail = [
    choice.buildingName,
    choice.buildingName && choice.floorNumber !== undefined
      ? t("floorNumber", { number: choice.floorNumber })
      : undefined,
    name,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <MapPin className="size-4 shrink-0 text-muted" aria-hidden="true" />
      <span className="grid min-w-0 flex-1 gap-y-1 sm:flex sm:items-center sm:gap-3">
        <span className="min-w-0 font-mono font-semibold break-all sm:shrink-0 sm:break-normal">
          {choice.code}
        </span>
        {detail && (
          <span className="line-clamp-2 min-w-0 text-sm leading-6 break-words text-muted">
            {detail}
          </span>
        )}
      </span>
    </>
  );
}

type BuildingOption = { buildingId: string; code: string; name: string };
type BuildingPage = {
  status: "ready" | "scanning" | "reset";
  page: readonly BuildingOption[];
  isDone: boolean;
  continueCursor: string;
  scanCursor?: string;
};

/** Icon-only building filter; options come from their own paged query. */
function BuildingFilter({
  warehouseId,
  value,
  onChange,
}: {
  warehouseId: string;
  value: BuildingChoice | null;
  onChange: (value: BuildingChoice | null) => void;
}) {
  const t = useTranslations("JobScan");
  const [open, setOpen] = useState(false);
  const [failures, setFailures] = useState(0);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <IconButton
          label={t("filterByBuilding")}
          variant={value ? "secondary" : "outline"}
          aria-pressed={Boolean(value)}
          // A fixed 48px box (44px on dense pointers) overrides the shared
          // icon size's smaller dense minimum, so it is never below 44px.
          className="relative size-12 shrink-0 dense:size-11"
        >
          <Building2 aria-hidden="true" className="size-5" />
          {value && (
            <span
              aria-hidden="true"
              className="absolute top-2 right-2 size-2 rounded-full bg-link"
            />
          )}
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-2 shadow-lg"
        >
          {open && (
            <QueryErrorBoundary
              resetKey={`${warehouseId}:${failures}`}
              fallback={() => (
                <div className="space-y-2 p-2">
                  <p role="alert" className="text-sm text-danger">
                    {t("buildingsFailed")}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => setFailures((value) => value + 1)}
                  >
                    {t("retryLocations")}
                  </Button>
                </div>
              )}
            >
              <BuildingOptions
                warehouseId={warehouseId}
                value={value}
                onChange={(next) => {
                  onChange(next);
                  setOpen(false);
                }}
              />
            </QueryErrorBoundary>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function BuildingOptions({
  warehouseId,
  value,
  onChange,
}: {
  warehouseId: string;
  value: BuildingChoice | null;
  onChange: (value: BuildingChoice | null) => void;
}) {
  const t = useTranslations("JobScan");
  const searchId = useId();
  const [search, setSearch] = useState("");
  const settled = useDebouncedSearch(search).trim();
  const [pages, setPages] = useState<{
    search: string;
    cursor?: string;
    loaded: readonly BuildingOption[];
  }>({ search: "", loaded: [] });
  const view =
    pages.search === settled ? pages : { search: settled, loaded: [] };
  const restart = () => setPages({ search: settled, loaded: [] });
  const recovery = useScanRecovery(JSON.stringify([settled, view.cursor]));
  const outcome = useQuery(fgRefs.jobScanBuildingOptions, {
    warehouseId,
    ...(settled ? { search: settled } : {}),
    ...(view.cursor ? { cursor: view.cursor } : {}),
    ...(recovery.cursor ? { scanCursor: recovery.cursor } : {}),
    ...(recovery.attempt ? { attempt: recovery.attempt } : {}),
  });
  const tracked = recovery.track(outcome);
  // A reset restarts the list once from its first page (accumulated pages may
  // no longer join up); a second reset needs the user.
  useCatalogueSync({
    outcome: tracked.outcome as CatalogueOutcome | undefined,
    continuation: tracked.continuation,
    paging: {
      cursor: view.cursor,
      canPrevious: false,
      reset: restart,
      previous: () => {},
    },
    resetKey: `${settled}:${recovery.attempt}`,
  });
  const denied = outcome !== undefined && !outcome.ok;
  const result = outcome?.ok ? (outcome.value as BuildingPage) : undefined;
  const resetStuck = useResetEscalation(
    settled,
    JSON.stringify([settled, view.cursor, recovery.cursor, recovery.attempt]),
    result?.status,
    Boolean(view.cursor || recovery.cursor),
  );
  const failed = !denied && (resetStuck || tracked.stalled);
  const retry = () => {
    restart();
    recovery.retry();
  };
  // Denied answers hide every option read earlier; accumulated pages are
  // de-duplicated by ID, so a renamed building is listed once.
  const options = denied
    ? []
    : [
        ...new Map(
          [...view.loaded, ...(result?.page ?? [])].map((row) => [
            row.buildingId,
            row,
          ]),
        ).values(),
      ];
  const ready = result?.status === "ready";
  const loading = !ready && !denied && !failed && !tracked.paused;
  const searchable =
    Boolean(settled || search) ||
    options.length > 8 ||
    (ready && !result.isDone);
  const option = (selected: boolean) =>
    cn("min-h-11 w-full justify-start text-left", selected && "font-semibold");
  return (
    <div className="flex flex-col gap-1">
      {searchable && (
        <div className="p-1">
          <label htmlFor={searchId} className="sr-only">
            {t("searchBuildings")}
          </label>
          <Input
            id={searchId}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("searchBuildings")}
            autoComplete="off"
            maxLength={100}
          />
        </div>
      )}
      <div
        role="group"
        aria-label={t("filterByBuilding")}
        aria-busy={loading || undefined}
        className="flex max-h-72 flex-col gap-1 overflow-y-auto"
      >
        <Button
          type="button"
          variant={value ? "ghost" : "secondary"}
          aria-pressed={!value}
          className={option(!value)}
          onClick={() => onChange(null)}
        >
          {t("allBuildings")}
        </Button>
        {options.map((row) => {
          const selected = value?.id === row.buildingId;
          return (
            <Button
              key={row.buildingId}
              type="button"
              variant={selected ? "secondary" : "ghost"}
              aria-pressed={selected}
              className={option(selected)}
              onClick={() =>
                onChange({
                  id: row.buildingId,
                  label: `${row.code} · ${row.name}`,
                })
              }
            >
              <span className="min-w-0 truncate">
                <span className="font-mono">{row.code}</span>
                <span className="text-muted"> · {row.name}</span>
              </span>
            </Button>
          );
        })}
      </div>
      {loading && (
        <p role="status" className="px-3 py-2 text-sm text-muted">
          {t("loadingBuildings")}
        </p>
      )}
      {failed && (
        <div className="space-y-2 px-1 py-2">
          <p role="alert" className="px-2 text-sm text-danger">
            {t(tracked.stalled ? "locationSearchStalled" : "buildingsFailed")}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full"
            onClick={retry}
          >
            {t("retryLocations")}
          </Button>
        </div>
      )}
      {tracked.paused && !denied && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={recovery.resume}
        >
          {t("keepSearching")}
        </Button>
      )}
      {ready && !options.length && (
        <p className="px-3 py-2 text-sm text-muted">{t("noBuildingMatch")}</p>
      )}
      {ready && !result.isDone && (
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          onClick={() =>
            setPages({
              search: settled,
              cursor: result.continueCursor,
              loaded: options,
            })
          }
        >
          {t("moreBuildings")}
        </Button>
      )}
      {denied && (
        <p role="alert" className="px-3 py-2 text-sm text-danger">
          {t("locationLookupDenied")}
        </p>
      )}
    </div>
  );
}
