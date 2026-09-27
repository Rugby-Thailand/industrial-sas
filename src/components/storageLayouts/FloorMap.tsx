"use client";
import { preferences } from "@/lib/browser/storage";
import { SceneBox, SceneLegendMark } from "@/components/storageScene/SceneBox";
import { sceneColors } from "@/components/storageScene/sceneColors";
import { SceneToolbar } from "@/components/storageScene/SceneToolbar";
import { resolveAreaColor } from "@/lib/storageLayouts/areaColors";
import {
  locationInventory,
  matchingStorageLocations as matchingFloorZones,
} from "@/lib/storageLayouts/locationSelectors";
import { FloorLocationTable } from "./FloorLocationTable";
import { floorPositions, positionAisles } from "./floorPositionGeometry";
import {
  ReservedAreaLegend,
  ReservedAreaShape,
  StorageViewModeToggle,
} from "./StorageZoneVisualizer";

import { Button } from "@/components/ui/button";
import { useCanManage } from "@/hooks/useCanManage";
import { Link } from "@/i18n/navigation";
import type { StorageZoneRow } from "@/lib/convex/storageLayoutApi";
import { palletPath } from "@/lib/navigation";
import {
  occupiedStorageFootprintAreaSqMm,
  storagePlacementBoxes,
  storagePlacementCorners,
} from "@/lib/storageLayouts/storagePlacementGeometry";
import { placementStatusKey } from "@/lib/storageLayouts/storageKit";
import { PlacementStatusBadge } from "@/features/storageKit/PlacementStatusBadge";
import {
  ArrowRightLeft,
  Eye,
  Layers3,
  Maximize,
  PencilLine,
  QrCode,
  RotateCw,
  Tags,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { QrCode as LocationQrCode } from "@/features/storageKit/QrCode";
import {
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

interface Area {
  readonly color?: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly label: string;
}
export interface FloorMapProps {
  readonly widthMm: number;
  readonly depthMm: number;
  readonly heightMm: number;
  readonly baseWidthMm: number;
  readonly baseDepthMm: number;
  readonly offsetXMm: number;
  readonly offsetYMm: number;
  readonly baseLabel: string;
  readonly floorNumber: number;
  readonly zones: readonly StorageZoneRow[];
  readonly blocks: readonly Area[];
  readonly onEditZone?: ((zoneId: string) => void) | undefined;
  readonly offsetEditor?: ReactNode;
  readonly locationActions?: ReactNode;
  readonly locationInspector?: ReactNode;
  readonly previewOnly?: boolean;
  readonly selectedZoneId?: string | undefined;
  readonly onSelectionChange?: ((id: string | undefined) => void) | undefined;
}
const m = (value: number) => Number((value / 1000).toFixed(3));
// Compatibility export for existing consumers; matching is feature-independent.
export { matchingStorageLocations as matchingFloorZones } from "@/lib/storageLayouts/locationSelectors";
const floorZoneUnitCount = (zone: StorageZoneRow) =>
  locationInventory(zone).units;
const hasUnmeasuredInventory = (zone: StorageZoneRow) =>
  locationInventory(zone).measuredAreaPartial;
// Zoom level from which storage positions show their labels when they fit.
const labelZoom = 2;
// Pointer travel, in screen pixels, before a press becomes a map drag.
const dragThreshold = 4;
const iconStyle =
  "size-10 bg-transparent p-0 hover:border-accent hover:bg-transparent";
const pdGroupCode = (code: string) =>
  code.match(/^((?:PD|F1|F2|SB)-L\d+)-\d+$/)?.[1];
const pdCells = (zones: readonly StorageZoneRow[]) =>
  zones.filter((zone) => pdGroupCode(zone.code) !== undefined);
const isAisleBlock = (block: Area) =>
  /^(?:พื้นที่ทางเดิน|ทางเดิน|(?:main\s+)?aisle|walkway)/i.test(
    block.label.trim(),
  );
function areaCategory(label: string) {
  const head = label.split(/[·:]/)[0]!.trim();
  return (
    head
      .replace(/\s+(?:PD|F1|F2|SB)-L[\d.]+.*$/i, "")
      .replace(/\s+\d+(?:\.\d+)?(?:\s*(?:m|ม\.?))?.*$/i, "")
      .trim() || head
  );
}
function groupedAreas(areas: readonly Area[]) {
  const groups = new Map<
    string,
    { label: string; color: string | undefined; count: number }
  >();
  for (const area of areas) {
    const label = areaCategory(area.label);
    const key = `${resolveAreaColor(area.color)}:${label}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { label, color: area.color, count: 1 });
  }
  return [...groups.values()];
}
function adjacentZone(
  zones: readonly StorageZoneRow[],
  current: StorageZoneRow,
  key: string,
) {
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const sign = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
  const centerX = current.xMm + current.widthMm / 2;
  const centerY = current.yMm + current.depthMm / 2;
  return zones
    .filter((zone) => zone.zoneId !== current.zoneId)
    .map((zone) => {
      const dx = zone.xMm + zone.widthMm / 2 - centerX;
      const dy = zone.yMm + zone.depthMm / 2 - centerY;
      const along = (horizontal ? dx : dy) * sign;
      const across = Math.abs(horizontal ? dy : dx);
      return { zone, along, score: along + across * 4 };
    })
    .filter(({ along }) => along > 0)
    .sort((a, b) => a.score - b.score)[0]?.zone;
}
function groupBounds(zones: readonly StorageZoneRow[]) {
  return {
    xMm: Math.min(...zones.map((zone) => zone.xMm)),
    yMm: Math.min(...zones.map((zone) => zone.yMm)),
    widthMm:
      Math.max(...zones.map((zone) => zone.xMm + zone.widthMm)) -
      Math.min(...zones.map((zone) => zone.xMm)),
    depthMm:
      Math.max(...zones.map((zone) => zone.yMm + zone.depthMm)) -
      Math.min(...zones.map((zone) => zone.yMm)),
  };
}

// Presentation-only preference shared by every floor and retained across visits.
const labelsStorageKey = "storage-planner:floor-map:show-location-labels";
const labelsChangedEvent = "storage-planner:floor-map-labels-changed";
let labelsFallback = false;
let labelsStorageUnavailable = false;

function readLocationLabels() {
  if (labelsStorageUnavailable) return labelsFallback;
  return preferences.read(
    labelsStorageKey,
    (value) => (typeof value === "boolean" ? value : false),
    labelsFallback,
  );
}
function subscribeLocationLabels(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === labelsStorageKey || event.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(labelsChangedEvent, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(labelsChangedEvent, onChange);
  };
}
function saveLocationLabels(value: boolean) {
  labelsFallback = value;
  labelsStorageUnavailable = !preferences.write(labelsStorageKey, value);
  window.dispatchEvent(new Event(labelsChangedEvent));
}

export function FloorMap(props: FloorMapProps) {
  const t = useTranslations("StorageLayouts");
  const inspectorId = useId();
  const canManage = useCanManage();
  const showLocationLabels = useSyncExternalStore(
    subscribeLocationLabels,
    readLocationLabels,
    () => false,
  );
  const [preferredView, setPreferredView] = useState<"3d" | "plan">();
  const view =
    preferredView ??
    (props.zones.length > 8 ||
    props.blocks.length > 8 ||
    props.zones.some(
      (zone) => floorPositions(zone).length > 0 || pdGroupCode(zone.code),
    )
      ? "plan"
      : "3d");
  const [search, setSearch] = useState("");
  const [localSelectedId, setLocalSelectedId] = useState<string>();
  const selectedId = props.onSelectionChange
    ? props.selectedZoneId
    : localSelectedId;
  const setSelectedId = (id: string | undefined) => {
    setLocalSelectedId(id);
    props.onSelectionChange?.(id);
  };
  const [unitId, setUnitId] = useState<string>();
  const [zoom, setZoom] = useState(1);
  // Map point kept at the frame centre after a drag; undefined follows the selection.
  const [focus, setFocus] = useState<{ x: number; y: number }>();
  const [areaIndex, setAreaIndex] = useState<number>();
  const [rotation, setRotation] = useState(0);
  const [reference, setReference] = useState(false);
  const [offsetEditing, setOffsetEditing] = useState(false);
  const [qr, setQr] = useState(false);
  const matches = matchingFloorZones(props.zones, search);
  const selected = props.zones.find((z) => z.zoneId === selectedId);
  const legacyPositionCount = props.zones.reduce(
    (count, zone) => count + floorPositions(zone).length,
    0,
  );
  const pdZoneCount = pdCells(props.zones).length;
  const aisleBlocks = props.blocks.filter(isAisleBlock);
  const legendAreas =
    pdZoneCount > 0
      ? props.blocks.filter((block) => !isAisleBlock(block))
      : props.blocks;
  const areaGroups = groupedAreas(legendAreas);
  const positionCount = legacyPositionCount + pdZoneCount;
  const groupCount = new Set([
    ...props.zones
      .filter((zone) => floorPositions(zone).length > 0)
      .map((zone) => zone.code),
    ...pdCells(props.zones).map((zone) => pdGroupCode(zone.code)!),
  ]).size;
  const clearSelection = () => {
    setSelectedId(undefined);
    setUnitId(undefined);
    setAreaIndex(undefined);
    setQr(false);
    setFocus(undefined);
  };
  const fit = () => {
    setZoom(1);
    setFocus(undefined);
  };
  const select = (id: string, palletId?: string) => {
    setSelectedId(id);
    setUnitId(palletId);
    setAreaIndex(undefined);
    setQr(false);
    setFocus(undefined);
    if (
      view === "plan" &&
      pdGroupCode(props.zones.find((zone) => zone.zoneId === id)?.code ?? "")
    )
      setZoom((current) => Math.max(current, 4));
  };
  const selectMapLocation = (id: string, palletId?: string) => {
    if (id === selectedId && palletId === undefined) {
      clearSelection();
      fit();
    } else {
      select(id, palletId);
    }
  };
  const selectArea = (index: number) => {
    clearSelection();
    if (index === areaIndex) fit();
    else setAreaIndex(index);
  };
  const selectedArea =
    areaIndex === undefined ? undefined : props.blocks[areaIndex];
  const action = (
    name: string,
    icon: ReactNode,
    onClick: () => void,
    disabled = false,
    pressed?: boolean,
  ) => (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={iconStyle}
      title={name}
      aria-label={name}
      onClick={onClick}
      disabled={disabled}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
    >
      {icon}
    </Button>
  );
  if (offsetEditing && props.offsetEditor)
    return (
      <section className="space-y-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => setOffsetEditing(false)}
        >
          {t("mapReturn")}
        </Button>
        {props.offsetEditor}
      </section>
    );
  return (
    <section
      aria-label={t("mapTitle")}
      className="@container min-w-0 rounded-2xl border border-border bg-surface p-4 sm:p-5"
      onKeyDown={(event) => {
        if (event.key === "Escape") clearSelection();
      }}
    >
      <SceneToolbar
        title={
          <>
            <h2 className="truncate text-sm font-semibold">
              {t("floor", { floor: props.floorNumber })} · {t("floorSpace")}
            </h2>
            <p className="text-xs font-normal text-muted">
              {m(props.widthMm)} × {m(props.depthMm)} × {m(props.heightMm)} m
            </p>
          </>
        }
        moreLabel={t("viewMode")}
        primary={
          <>
            <StorageViewModeToggle
              value={view}
              onChange={(next) => {
                setPreferredView(next);
                setFocus(undefined);
              }}
              label={t("viewMode")}
              planLabel={t("planView")}
              threeDLabel={t("threeDView")}
            />{" "}
            {action(
              t("mapZoomOut"),
              <ZoomOut />,
              () => {
                const next = Math.max(1, zoom - (zoom > 3 ? 1 : 0.25));
                setZoom(next);
                if (next === 1) setFocus(undefined);
              },
              zoom <= 1,
            )}
            {action(
              t("mapZoomIn"),
              <ZoomIn />,
              () => setZoom(Math.min(8, zoom + (zoom >= 3 ? 1 : 0.25))),
              zoom >= 8,
            )}
          </>
        }
        secondary={
          <>
            {" "}
            {action(
              t("mapShowLocationLabels"),
              <Tags />,
              () => saveLocationLabels(!showLocationLabels),
              view === "3d" && pdZoneCount > 0,
              showLocationLabels,
            )}
            {action(t("mapFit"), <Maximize />, fit)}
            {action(
              t("mapRotate"),
              <RotateCw />,
              () => {
                setRotation((rotation + 1) % 4);
                setFocus(undefined);
              },
              view === "plan",
            )}
            {action(
              props.baseLabel,
              <Layers3 />,
              () => {
                setReference(!reference);
                setFocus(undefined);
              },
              false,
              reference,
            )}
          </>
        }
      />
      <div className="mt-4 grid min-w-0 grid-cols-1 items-start gap-4 @min-[1200px]:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0">
          <MapDrawing
            {...props}
            view={view}
            rotation={rotation}
            zoom={zoom}
            focus={focus}
            onFocusChange={setFocus}
            selectedAreaIndex={areaIndex}
            onSelectArea={selectArea}
            reference={reference}
            showLocationLabels={showLocationLabels}
            selectedId={selected?.zoneId}
            selectedUnit={unitId}
            matchIds={matches.map((z) => z.zoneId)}
            searching={!!search.trim()}
            onSelect={selectMapLocation}
          />

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted">
            <span>
              <SceneLegendMark kind="location" />
              {t("storageZones")}
            </span>
            <span>
              <SceneLegendMark kind="package" />
              {t("placementStored")}
            </span>
            <span>
              <SceneLegendMark kind="package" held />
              {t("placementReserved")}
            </span>
            <span>
              <SceneLegendMark kind="location" selected />
              {t("mapSelected")}
            </span>
          </div>
          {legendAreas.length > 6 ? (
            <details className="mt-3 rounded-lg border border-border bg-background">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium marker:text-muted">
                {t("floorMapAreas", { count: legendAreas.length })}
              </summary>
              <div className="border-t border-border px-2 py-1">
                <ReservedAreaLegend
                  areas={areaGroups.map((group) => ({
                    color: group.color,
                    label: t("floorAreaCount", {
                      name: group.label,
                      count: group.count,
                    }),
                  }))}
                />
                <details className="border-t border-border text-xs text-muted">
                  <summary className="cursor-pointer px-3 py-2">
                    {t("floorAllAreaNames", { count: legendAreas.length })}
                  </summary>
                  <div className="max-h-40 overflow-y-auto">
                    <ReservedAreaLegend areas={legendAreas} />
                  </div>
                </details>
              </div>
            </details>
          ) : (
            <ReservedAreaLegend areas={legendAreas} />
          )}
          {pdZoneCount > 0 && aisleBlocks.length > 0 && (
            <p className="mt-2 text-xs text-muted">
              {t("floorAisleLegend", {
                widths: [
                  ...new Set(
                    aisleBlocks.map((block) =>
                      m(Math.min(block.widthMm, block.depthMm)),
                    ),
                  ),
                ]
                  .sort((a, b) => a - b)
                  .map((width) => width.toFixed(2))
                  .join(", "),
              })}
            </p>
          )}
          {pdZoneCount > 0 && zoom < labelZoom && (
            <p className="mt-2 text-xs text-muted">{t("floorZoomForLabels")}</p>
          )}
          {positionCount > 0 && (
            <p className="mt-3 text-sm font-medium" role="status">
              {t("floorPositionSummary", {
                positions: positionCount,
                zones: groupCount,
              })}
            </p>
          )}
          {props.zones.length === 0 && (
            <p className="mt-3 text-sm text-muted">{t("noStorageSpots")}</p>
          )}
        </div>
        <aside
          id={inspectorId}
          tabIndex={-1}
          aria-label={t("mapSelected")}
          className="min-w-0 py-2 @min-[1200px]:pl-2"
        >
          {!selected && selectedArea ? (
            <div data-selected-area="true">
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 text-lg font-semibold break-words">
                  {selectedArea.label}
                </h3>
                {action(t("mapClearSelection"), <X />, clearSelection)}
              </div>
              <p className="mt-3 flex items-center gap-2 text-sm">
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-sm border border-border"
                  style={{
                    backgroundColor: resolveAreaColor(selectedArea.color),
                  }}
                />
                {m(selectedArea.widthMm)} × {m(selectedArea.depthMm)} m
              </p>
              <p className="mt-2 text-sm text-muted">{t("mapAreaNoStorage")}</p>
            </div>
          ) : !selected ? (
            <div className="py-6">
              <QrCode className="mb-3 size-6 text-muted" />
              <p className="font-medium">{t("mapChoose")}</p>
              <p className="mt-2 text-sm text-muted">{t("mapInspectHint")}</p>
            </div>
          ) : props.locationInspector ? null : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold break-words">
                    {selected.label}
                  </h3>
                  <p className="mt-1 font-mono text-[13px] break-all text-muted">
                    {selected.code}
                  </p>
                </div>
                {action(t("mapClearSelection"), <X />, clearSelection)}
              </div>
              <p className="mt-3 text-sm">
                {m(selected.widthMm)} × {m(selected.depthMm)} ×{" "}
                {m(selected.maxStackHeightMm)} m
              </p>
              <p className="mt-1 text-[13px] text-muted">
                {t("mapHeightLimit", { height: m(selected.maxStackHeightMm) })}
              </p>
              <p className="mt-2 text-[13px] text-muted">
                {t(
                  hasUnmeasuredInventory(selected)
                    ? "mapPartialFootprint"
                    : "mapFootprint",
                  {
                    percent: Math.round(
                      (100 *
                        occupiedStorageFootprintAreaSqMm(selected.placements)) /
                        Math.max(1, selected.widthMm * selected.depthMm),
                    ),
                  },
                )}
              </p>
              <div className="mt-3 flex gap-2">
                {props.onEditZone &&
                  canManage &&
                  action(
                    t("editStorageZone", { label: selected.label }),
                    <PencilLine />,
                    () => props.onEditZone?.(selected.zoneId),
                  )}
                {action(
                  t("mapShowQR"),
                  <QrCode />,
                  () => setQr(!qr),
                  false,
                  qr,
                )}
              </div>
              {qr && (
                <div className="mt-3">
                  <LocationQrCode
                    value={selected.qrValue}
                    size={112}
                    padding={12}
                    label={t("qrForZone", { code: selected.code })}
                  />
                </div>
              )}
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-[13px] font-semibold text-muted">
                  {t("mapUnitCount", {
                    count: floorZoneUnitCount(selected),
                  })}
                </p>
                {floorZoneUnitCount(selected) === 0 &&
                  !hasUnmeasuredInventory(selected) && (
                    <p className="mt-2 text-sm text-muted">
                      {t("noPalletsAtSpot")}
                    </p>
                  )}
                {hasUnmeasuredInventory(selected) && (
                  <p className="mt-2 text-sm text-muted">
                    {t("mapUnmeasuredInventory")}
                  </p>
                )}
                <ul className="mt-2 max-h-96 space-y-3 overflow-auto">
                  {[...selected.placements]
                    .sort(
                      (a, b) =>
                        Number(b.placementId === unitId) -
                        Number(a.placementId === unitId),
                    )
                    .map((p) => (
                      <li
                        key={p.placementId}
                        className={`rounded-lg border p-3 ${unitId === p.placementId ? "border-accent" : "border-border"}`}
                      >
                        <div className="flex flex-wrap justify-between gap-2">
                          {props.previewOnly ? (
                            <span className="font-mono text-sm font-semibold text-accent">
                              {p.lpn}
                            </span>
                          ) : (
                            <Link
                              href={palletPath(p.handlingUnitId)}
                              className="font-mono text-sm font-semibold text-accent"
                            >
                              {p.lpn}
                            </Link>
                          )}
                          <PlacementStatusBadge
                            placement={p}
                            label={t(placementStatusKey(p))}
                          />
                        </div>
                        <p className="mt-1 text-[13px] text-muted">
                          {m(p.widthMm)} × {m(p.depthMm)} × {m(p.heightMm)} m
                        </p>
                        <p className="mt-2 font-mono text-[13px] break-all">
                          {p.positionCode}
                        </p>
                        <p className="mt-1 text-[13px] text-muted">
                          X {m(p.xMm ?? 0)} · Y {m(p.yMm ?? 0)} · Z{" "}
                          {m(p.zMm ?? 0)} m
                        </p>
                        {!props.previewOnly && (
                          <div className="mt-2 flex gap-2">
                            <Button
                              asChild
                              size="sm"
                              variant="outline"
                              className={iconStyle}
                            >
                              <Link
                                href={palletPath(p.handlingUnitId)}
                                aria-label={t("openSpotPallet", { lpn: p.lpn })}
                                title={t("openSpotPallet", { lpn: p.lpn })}
                              >
                                <Eye />
                              </Link>
                            </Button>
                            {canManage &&
                              (p.status === "STORED" || p.moveState) && (
                                <Button
                                  asChild
                                  size="sm"
                                  variant="outline"
                                  className={iconStyle}
                                >
                                  <Link
                                    href={`${palletPath(p.handlingUnitId)}/move`}
                                    aria-label={t(
                                      p.moveState
                                        ? "continueSpotPalletMove"
                                        : "moveSpotPallet",
                                      { lpn: p.lpn },
                                    )}
                                    title={t(
                                      p.moveState
                                        ? "continueSpotPalletMove"
                                        : "moveSpotPallet",
                                      { lpn: p.lpn },
                                    )}
                                  >
                                    <ArrowRightLeft />
                                  </Link>
                                </Button>
                              )}
                          </div>
                        )}
                      </li>
                    ))}
                </ul>
                {selected.placements.length > 0 && (
                  <p className="mt-3 text-[13px] text-muted">
                    {t("mapLocalCoordinates")}
                  </p>
                )}
              </div>
            </>
          )}
          {selected?.importNote && (
            <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              {selected.importNote}
            </p>
          )}
          {props.locationInspector}
        </aside>
      </div>
      {selected &&
        (floorPositions(selected).length > 0 || pdGroupCode(selected.code)) && (
          <FloorPositionDetail
            zone={selected}
            zones={props.zones}
            blocks={props.blocks}
            onSelect={select}
          />
        )}
      <div className="mt-4 min-w-0">
        <FloorLocationTable
          zones={matches}
          groupedPositions={legacyPositionCount > 0}
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            const found = matchingFloorZones(props.zones, value);
            if (!found.some((zone) => zone.zoneId === selectedId))
              clearSelection();
          }}
          onClearSelection={clearSelection}
          actions={
            <>
              {selected ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const panel = document.getElementById(inspectorId);
                    panel?.scrollIntoView({ block: "nearest" });
                    panel?.focus({ preventScroll: true });
                  }}
                >
                  {t("mapSelected")}
                </Button>
              ) : null}
              {props.locationActions}
            </>
          }
          selectedId={selected?.zoneId}
          onSelect={select}
        />
      </div>
      {props.offsetEditor && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-4 text-muted"
          onClick={() => setOffsetEditing(true)}
        >
          <PencilLine className="size-4" />
          {t("mapEditFloorOffset")}
        </Button>
      )}
    </section>
  );
}
function MapDrawing({
  view,
  rotation,
  zoom,
  focus,
  onFocusChange,
  selectedAreaIndex,
  onSelectArea,
  reference,
  showLocationLabels,
  selectedId,
  selectedUnit,
  matchIds,
  searching,
  onSelect,
  ...props
}: FloorMapProps & {
  view: "3d" | "plan";
  rotation: number;
  zoom: number;
  focus: { x: number; y: number } | undefined;
  onFocusChange: (focus: { x: number; y: number }) => void;
  selectedAreaIndex: number | undefined;
  onSelectArea: (index: number) => void;
  reference: boolean;
  showLocationLabels: boolean;
  selectedId: string | undefined;
  selectedUnit: string | undefined;
  matchIds: string[];
  searching: boolean;
  onSelect: (id: string, palletId?: string) => void;
}) {
  const t = useTranslations("StorageLayouts");
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    focus: { x: number; y: number };
    moved: boolean;
  }>(null);
  const [dragging, setDragging] = useState(false);
  const rawPoint = (x: number, y: number, z = 0) => {
    const dx = x - props.widthMm / 2,
      dy = y - props.depthMm / 2;
    const angle = (rotation * Math.PI) / 2;
    const rx = dx * Math.cos(angle) - dy * Math.sin(angle),
      ry = dx * Math.sin(angle) + dy * Math.cos(angle);
    return view === "plan"
      ? { x: dx, y: dy }
      : { x: (rx - ry) * 0.866, y: (rx + ry) * 0.5 - z };
  };
  const corners = (x: number, y: number, w: number, d: number, z = 0) =>
    [
      [x, y],
      [x + w, y],
      [x + w, y + d],
      [x, y + d],
    ].map(([a, b]) => rawPoint(a!, b!, z));
  const boxes = props.zones.flatMap((zone) =>
    storagePlacementBoxes(zone.placements, zone).map((box) => ({ zone, box })),
  );
  const pdGroups = [
    ...new Set(pdCells(props.zones).map((zone) => pdGroupCode(zone.code)!)),
  ].map((code) => ({
    code,
    bounds: groupBounds(
      props.zones.filter((zone) => pdGroupCode(zone.code) === code),
    ),
  }));
  const pdGroupBounds = new Map(
    pdGroups.map(({ code, bounds }) => [code, bounds]),
  );
  const hasPdCells = pdGroups.length > 0;
  const detailedPlan =
    hasPdCells ||
    (view === "plan" &&
      props.zones.some((zone) => floorPositions(zone).length > 0));
  const compactPlan = view === "plan" && detailedPlan;
  const extents = [
    ...corners(0, 0, props.widthMm, props.depthMm),
    ...corners(0, 0, props.widthMm, props.depthMm, props.heightMm),
    ...boxes.flatMap(({ box }) =>
      storagePlacementCorners(box).map((p) => rawPoint(p.x, p.y, p.z)),
    ),
  ];
  if (reference)
    extents.push(
      ...corners(
        -props.offsetXMm,
        -props.offsetYMm,
        props.baseWidthMm,
        props.baseDepthMm,
      ),
    );
  const xs = extents.map((p) => p.x),
    ys = extents.map((p) => p.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const scale = Math.min(
    (compactPlan ? 800 : 710) / Math.max(maxX - minX, 1),
    (compactPlan ? 375 : 440) / Math.max(maxY - minY, 1),
  );
  const point = (x: number, y: number, z = 0) => {
    const p = rawPoint(x, y, z);
    return {
      x: 460 + (p.x - (minX + maxX) / 2) * scale,
      y: 320 + (p.y - (minY + maxY) / 2) * scale,
    };
  };
  const rect = (x: number, y: number, w: number, d: number, z = 0) =>
    [
      [x, y],
      [x + w, y],
      [x + w, y + d],
      [x, y + d],
    ].map(([a, b]) => point(a!, b!, z));
  const pts = (points: readonly { x: number; y: number }[]) =>
    points.map((p) => `${p.x},${p.y}`).join(" ");
  const floor = rect(0, 0, props.widthMm, props.depthMm);
  const guide = point(props.widthMm, props.depthMm),
    guideTop = point(props.widthMm, props.depthMm, props.heightMm);
  const step = Math.max(
    1000,
    Math.ceil(Math.max(props.widthMm, props.depthMm) / 25000) * 1000,
  );
  const labels: { x: number; y: number }[] = [];
  const zoneOrder = (
    detailedPlan || !showLocationLabels ? [] : [...props.zones]
  ).sort(
    (a, b) => Number(b.zoneId === selectedId) - Number(a.zoneId === selectedId),
  );
  const palletBounds = (showLocationLabels ? boxes : []).map(({ box }) => {
    const points = storagePlacementCorners(box).map((p) =>
      point(p.x, p.y, view === "3d" ? p.z : 0),
    );
    return {
      left: Math.min(...points.map((p) => p.x)) - 6,
      right: Math.max(...points.map((p) => p.x)) + 6,
      top: Math.min(...points.map((p) => p.y)) - 6,
      bottom: Math.max(...points.map((p) => p.y)) + 6,
    };
  });
  const aisleBounds = (showLocationLabels ? props.blocks : []).map((block) => {
    const points = rect(block.xMm, block.yMm, block.widthMm, block.depthMm);
    return {
      left: Math.min(...points.map((p) => p.x)) - 4,
      right: Math.max(...points.map((p) => p.x)) + 4,
      top: Math.min(...points.map((p) => p.y)) - 4,
      bottom: Math.max(...points.map((p) => p.y)) + 4,
    };
  });
  const labelCollides = (x: number, y: number) =>
    labels.some((p) => Math.abs(p.x - x) < 228 && Math.abs(p.y - y) < 66) ||
    [...palletBounds, ...aisleBounds].some(
      (p) => x < p.right && x + 220 > p.left && y < p.bottom && y + 58 > p.top,
    );
  const callouts = zoneOrder.map((zone) => {
    const anchor = point(
      zone.xMm + zone.widthMm / 2,
      zone.yMm + zone.depthMm / 2,
    );
    let x = Math.max(12, Math.min(688, anchor.x - 110));
    const labelHeight =
      view === "3d"
        ? Math.max(
            zone.zoneId === selectedId ? zone.maxStackHeightMm : 0,
            ...storagePlacementBoxes(zone.placements).map(
              (box) => box.zMm + box.heightMm,
            ),
          )
        : 0;
    let y = Math.max(
      10,
      point(
        zone.xMm + zone.widthMm / 2,
        zone.yMm + zone.depthMm / 2,
        labelHeight,
      ).y - 78,
    );
    if (labelCollides(x, y)) {
      // Find the nearest clear label position instead of wrapping labels across
      // the floor, which makes leader lines confusing in fully occupied scenes.
      const candidates = Array.from(
        { length: 18 },
        (_, col) => 12 + col * 39,
      ).flatMap((cx) =>
        Array.from({ length: 19 }, (_, row) => ({ x: cx, y: 10 + row * 31 })),
      );
      const candidate = candidates
        .filter((p) => !labelCollides(p.x, p.y))
        .sort(
          (a, b) =>
            Math.hypot(a.x + 110 - anchor.x, a.y + 29 - anchor.y) -
            Math.hypot(b.x + 110 - anchor.x, b.y + 29 - anchor.y),
        )[0];
      if (candidate) {
        x = candidate.x;
        y = candidate.y;
      }
    }
    const fits = !labelCollides(x, y);
    if (!fits) return null;
    labels.push({ x, y });
    const unitCount = floorZoneUnitCount(zone);
    return { zone, anchor, x, y, unitCount };
  });
  const selected = props.zones.find((z) => z.zoneId === selectedId);
  const selectedArea =
    selectedAreaIndex === undefined
      ? undefined
      : props.blocks[selectedAreaIndex];
  const target = selected ?? selectedArea;
  const frame = compactPlan
    ? { x: 0, y: 80, width: 920, height: 500 }
    : { x: 0, y: 0, width: 920, height: 660 };
  const pannable = zoom > 1;
  // Keep the floor covering the frame (or fully inside it when smaller).
  const clampAxis = (value: number, min: number, max: number, half: number) => {
    const a = min + half / zoom,
      b = max - half / zoom;
    return Math.min(Math.max(value, Math.min(a, b)), Math.max(a, b));
  };
  const clampFocus = (p: { x: number; y: number }) => ({
    x: clampAxis(
      p.x,
      460 - ((maxX - minX) / 2) * scale,
      460 + ((maxX - minX) / 2) * scale,
      frame.width / 2,
    ),
    y: clampAxis(
      p.y,
      320 - ((maxY - minY) / 2) * scale,
      320 + ((maxY - minY) / 2) * scale,
      frame.height / 2,
    ),
  });
  const center = !pannable
    ? { x: 460, y: 330 }
    : clampFocus(
        focus ??
          (target
            ? point(
                target.xMm + target.widthMm / 2,
                target.yMm + target.depthMm / 2,
              )
            : { x: 460, y: 330 }),
      );
  const endDrag = (e: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    if (!drag.current.moved) drag.current = null;
    setDragging(false);
  };
  return (
    <svg
      role="group"
      aria-label={t("mapTitle")}
      viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
      className={`w-full rounded-xl border border-border bg-background ${compactPlan ? "aspect-[1.84] max-h-[40rem] min-h-[18rem]" : "aspect-[1.4] max-h-[40rem]"} ${pannable ? (dragging ? "cursor-grabbing select-none [&_*]:cursor-grabbing" : "cursor-grab") : ""}`}
      style={pannable ? { touchAction: "none" } : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.focus();
      }}
      onPointerDown={(e) => {
        drag.current = null;
        if (!pannable || e.button !== 0) return;
        drag.current = {
          pointerId: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          focus: center,
          moved: false,
        };
      }}
      onPointerMove={(e) => {
        const current = drag.current;
        if (!current || current.pointerId !== e.pointerId) return;
        const dx = e.clientX - current.x,
          dy = e.clientY - current.y;
        if (!current.moved) {
          if (Math.hypot(dx, dy) < dragThreshold) return;
          current.moved = true;
          setDragging(true);
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }
        // Screen pixels → viewBox units (uniform "meet" scaling) → map units.
        const box = e.currentTarget.getBoundingClientRect();
        const unit =
          box.width > 0 && box.height > 0
            ? Math.max(frame.width / box.width, frame.height / box.height)
            : 1;
        onFocusChange(
          clampFocus({
            x: current.focus.x - (dx * unit) / zoom,
            y: current.focus.y - (dy * unit) / zoom,
          }),
        );
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={(e) => {
        // A drag that ends over a location must not also select it.
        if (drag.current?.moved) e.stopPropagation();
        drag.current = null;
      }}
      tabIndex={-1}
    >
      <desc>{t("mapKeyboardHint")}</desc>
      <g
        transform={`translate(${460 - center.x * zoom} ${330 - center.y * zoom}) scale(${zoom})`}
      >
        {reference && (
          <polygon
            data-reference-floor="true"
            points={pts(
              rect(
                -props.offsetXMm,
                -props.offsetYMm,
                props.baseWidthMm,
                props.baseDepthMm,
              ),
            )}
            fill="none"
            stroke={sceneColors.source}
            strokeDasharray="8 6"
          >
            <title>{props.baseLabel}</title>
          </polygon>
        )}
        {view === "3d" && (
          <polygon
            data-floor-slab="true"
            points={pts([
              ...floor,
              ...[...floor].reverse().map((p) => ({ x: p.x, y: p.y + 8 })),
            ])}
            fill={sceneColors.floorSide}
            stroke={sceneColors.boundary}
          />
        )}
        <polygon
          points={pts(floor)}
          fill={sceneColors.floor}
          stroke={sceneColors.boundary}
          strokeWidth="1.5"
        />
        {Array.from(
          { length: Math.max(0, Math.ceil(props.widthMm / step) - 1) },
          (_, i) => {
            const a = point((i + 1) * step, 0),
              b = point((i + 1) * step, props.depthMm);
            return (
              <line
                key={`x${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={sceneColors.grid}
                opacity=".6"
              />
            );
          },
        )}
        {Array.from(
          { length: Math.max(0, Math.ceil(props.depthMm / step) - 1) },
          (_, i) => {
            const a = point(0, (i + 1) * step),
              b = point(props.widthMm, (i + 1) * step);
            return (
              <line
                key={`y${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={sceneColors.grid}
                opacity=".6"
              />
            );
          },
        )}
        {props.blocks.map((b, i) => {
          const selectable = !isAisleBlock(b);
          const active = i === selectedAreaIndex;
          return (
            <g
              key={i}
              data-unavailable-area="true"
              {...(selectable
                ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-label": t("mapSelectArea", { name: b.label }),
                    "aria-pressed": active,
                    className:
                      "group cursor-pointer outline-none focus-visible:outline-none",
                    onClick: () => onSelectArea(i),
                    onKeyDown: (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectArea(i);
                      }
                    },
                  }
                : { "aria-hidden": true })}
            >
              {hasPdCells && view === "plan" ? (
                <polygon
                  points={pts(rect(b.xMm, b.yMm, b.widthMm, b.depthMm))}
                  fill={b.color ?? "#ffb68e"}
                  stroke={active ? sceneColors.selected : undefined}
                  strokeWidth={active ? 3 : undefined}
                  vectorEffect="non-scaling-stroke"
                  className="group-focus-visible:stroke-text"
                >
                  <title>{b.label}</title>
                </polygon>
              ) : (
                <ReservedAreaShape
                  color={b.color}
                  tooltip={b.label}
                  mode={view}
                  fontSize={17}
                  selected={active}
                  points={rect(b.xMm, b.yMm, b.widthMm, b.depthMm)}
                />
              )}
            </g>
          );
        })}
        {props.zones.map((zone) => {
          const active = zone.zoneId === selectedId;
          const cellLabel = zone.label.trim() || zone.code;
          const base = rect(zone.xMm, zone.yMm, zone.widthMm, zone.depthMm);
          const cellWidth = Math.abs(base[1]!.x - base[0]!.x) * zoom;
          const cellHeight = Math.abs(base[3]!.y - base[0]!.y) * zoom;
          const group = pdGroupBounds.get(pdGroupCode(zone.code) ?? "");
          const markerInFirstRow =
            group &&
            !(group.xMm <= 1500 && group.widthMm >= 6000) &&
            zone.yMm === group.yMm;
          const estimatedLabelWidth = [...cellLabel].reduce(
            (width, character) =>
              width + (character.charCodeAt(0) > 127 ? 1 : 0.62),
            0,
          );
          const labelFontSizePx = Math.min(
            13,
            (cellWidth - 8) / Math.max(estimatedLabelWidth, 1),
          );
          const labelFits =
            labelFontSizePx >= 8 && cellHeight >= (markerInFirstRow ? 38 : 20);
          const top = rect(
            zone.xMm,
            zone.yMm,
            zone.widthMm,
            zone.depthMm,
            zone.maxStackHeightMm,
          );
          return (
            <g
              key={zone.zoneId}
              role="button"
              data-map-zone-id={zone.zoneId}
              tabIndex={
                zone.zoneId === (selectedId ?? props.zones[0]?.zoneId) ? 0 : -1
              }
              aria-label={t("mapSelectLocation", { name: zone.label })}
              aria-pressed={active}
              onClick={() => onSelect(zone.zoneId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(zone.zoneId);
                } else if (
                  ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    e.key,
                  )
                ) {
                  e.preventDefault();
                  const next = adjacentZone(props.zones, zone, e.key);
                  if (!next) return;
                  onSelect(next.zoneId);
                  const controls = e.currentTarget
                    .closest("svg")
                    ?.querySelectorAll<SVGGElement>("[data-map-zone-id]");
                  [...(controls ?? [])]
                    .find(
                      (control) =>
                        control.getAttribute("data-map-zone-id") ===
                        next.zoneId,
                    )
                    ?.focus();
                }
              }}
              className="group cursor-pointer outline-none focus-visible:outline-none"
              opacity={searching && !matchIds.includes(zone.zoneId) ? 0.3 : 1}
            >
              <title>
                {zone.label === zone.code
                  ? zone.code
                  : `${zone.label} · ${zone.code}`}
              </title>
              <g
                data-zone-id={zone.zoneId}
                data-height-envelope={view === "3d" ? "true" : undefined}
              >
                {!(view === "plan" && pdGroupCode(zone.code)) && (
                  <SceneBox
                    points={[...base, ...top]}
                    mode={view}
                    kind="location"
                    selected={active}
                  />
                )}
                {view === "plan" && pdGroupCode(zone.code) && (
                  <>
                    <polygon
                      data-pd-cell-code={zone.code}
                      points={pts(base)}
                      fill="#83a8b1"
                      stroke={active ? sceneColors.selected : "#48646b"}
                      strokeWidth={active ? 3 : 0.75}
                      vectorEffect="non-scaling-stroke"
                      className={
                        active ? undefined : "group-focus-visible:stroke-text"
                      }
                    />
                    {(active || showLocationLabels || zoom >= labelZoom) &&
                      labelFits && (
                        <text
                          x={
                            point(
                              zone.xMm + zone.widthMm / 2,
                              zone.yMm + zone.depthMm / 2,
                            ).x
                          }
                          y={
                            point(
                              zone.xMm + zone.widthMm / 2,
                              zone.yMm + zone.depthMm / 2,
                            ).y
                          }
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="#172329"
                          fontSize={labelFontSizePx / zoom}
                          fontWeight="700"
                          className="pointer-events-none"
                        >
                          {cellLabel}
                        </text>
                      )}
                  </>
                )}
                {view === "plan" && floorPositions(zone).length > 0 && (
                  <>
                    <polygon points={pts(base)} fill="#ffb68e" />
                    {floorPositions(zone).map((position) => (
                      <polygon
                        key={position.code}
                        data-position-code={position.code}
                        points={pts(
                          rect(
                            position.xMm!,
                            position.yMm!,
                            position.widthMm!,
                            position.depthMm!,
                          ),
                        )}
                        fill="#83a8b1"
                        stroke="#263640"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                        vectorEffect="non-scaling-stroke"
                      >
                        <title>{position.code}</title>
                      </polygon>
                    ))}
                    {positionAisles(zone).map((aisle, index) => (
                      <polygon
                        key={`aisle-${index}`}
                        data-aisle-width-mm={Math.min(
                          aisle.widthMm,
                          aisle.depthMm,
                        )}
                        points={pts(
                          rect(
                            aisle.xMm,
                            aisle.yMm,
                            aisle.widthMm,
                            aisle.depthMm,
                          ),
                        )}
                        fill="#ffb68e"
                      >
                        <title>
                          {t("floorAisleWidth", {
                            width: m(Math.min(aisle.widthMm, aisle.depthMm)),
                          })}
                        </title>
                      </polygon>
                    ))}
                    <polygon
                      points={pts(base)}
                      fill="none"
                      stroke={active ? sceneColors.selected : "#263640"}
                      strokeWidth={active ? 3 : 1}
                      vectorEffect="non-scaling-stroke"
                    />
                    {showLocationLabels && (
                      <text
                        x={
                          point(
                            zone.xMm + zone.widthMm / 2,
                            zone.yMm + zone.depthMm / 2,
                          ).x
                        }
                        y={
                          point(
                            zone.xMm + zone.widthMm / 2,
                            zone.yMm + zone.depthMm / 2,
                          ).y
                        }
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="#172329"
                        stroke="#c7dcdf"
                        strokeWidth={3 / zoom}
                        paintOrder="stroke"
                        fontSize={13 / zoom}
                        fontWeight="700"
                        className="pointer-events-none"
                      >
                        {zone.code}
                      </text>
                    )}
                  </>
                )}
              </g>
            </g>
          );
        })}
        {[...boxes]
          .sort(
            (a, b) =>
              Number(a.box.placement.placementId === selectedUnit) -
                Number(b.box.placement.placementId === selectedUnit) ||
              rawPoint(a.box.xMm, a.box.yMm).y -
                rawPoint(b.box.xMm, b.box.yMm).y ||
              a.box.zMm - b.box.zMm,
          )
          .map(({ zone, box }) => {
            const p = box.placement,
              held = p.status === "RESERVED" || p.moveState === "IN_TRANSIT";
            const projected = storagePlacementCorners(box).map((c) =>
              point(c.x, c.y, view === "3d" ? c.z : 0),
            );
            return (
              <g
                key={`${zone.zoneId}:${p.placementId}`}
                data-placement-id={p.placementId}
                data-placement-x-mm={box.xMm}
                data-placement-y-mm={box.yMm}
                data-placement-z-mm={box.zMm}
                data-placement-status={p.status ?? "STORED"}
                role="button"
                tabIndex={
                  zone.zoneId === selectedId &&
                  p.placementId ===
                    (selectedUnit ?? zone.placements[0]?.placementId)
                    ? 0
                    : -1
                }
                aria-label={`${p.lpn} · ${t(placementStatusKey(p))}`}
                onClick={() => onSelect(zone.zoneId, p.placementId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(zone.zoneId, p.placementId);
                  }
                }}
                className="group cursor-pointer outline-none"
                opacity={
                  searching && !matchIds.includes(zone.zoneId) ? 0.45 : 1
                }
              >
                <title>{`${p.lpn} · ${p.positionCode} · ${t(placementStatusKey(p))}`}</title>
                <SceneBox
                  points={projected}
                  mode={view}
                  kind="package"
                  selected={selectedUnit === p.placementId}
                  held={held}
                  source={p.moveRole === "SOURCE"}
                />
              </g>
            );
          })}
        {view === "plan" &&
          pdGroups.map(({ code, bounds }) => {
            const labelWidth = Math.abs(
              point(bounds.xMm + bounds.widthMm, bounds.yMm).x -
                point(bounds.xMm, bounds.yMm).x,
            );
            const hasLeftGutter = bounds.xMm <= 1500 && bounds.widthMm >= 6000;
            const groupNumber = code.match(/-L(\d+)$/i)?.[1];
            const abbreviated = groupNumber ? `L${groupNumber}` : code;
            const candidates = [code, abbreviated, groupNumber].filter(
              (label): label is string => Boolean(label),
            );
            const label = hasLeftGutter
              ? code
              : candidates.find(
                  (candidate) => labelWidth * zoom >= candidate.length * 6 + 4,
                );
            if (!label) return null;
            const chipWidth = (label.length * 6 + 4) / zoom;
            const anchor = point(
              hasLeftGutter ? 0 : bounds.xMm + bounds.widthMm / 2,
              hasLeftGutter ? bounds.yMm + bounds.depthMm / 2 : bounds.yMm,
            );
            return (
              <g key={code} className="pointer-events-none">
                {!hasLeftGutter && (
                  <rect
                    x={anchor.x - chipWidth / 2}
                    y={anchor.y}
                    width={chipWidth}
                    height={11 / zoom}
                    rx={3 / zoom}
                    fill="#172329"
                  />
                )}
                <text
                  data-group-code={code}
                  x={hasLeftGutter ? anchor.x - 8 / zoom : anchor.x}
                  y={hasLeftGutter ? anchor.y : anchor.y + 5.5 / zoom}
                  textAnchor={hasLeftGutter ? "end" : "middle"}
                  dominantBaseline="middle"
                  fill={hasLeftGutter ? "#172329" : "#fff"}
                  stroke={hasLeftGutter ? "#c7dcdf" : "none"}
                  strokeWidth={hasLeftGutter ? 3 / zoom : undefined}
                  paintOrder="stroke"
                  fontSize={(hasLeftGutter ? 13 : 10) / zoom}
                  fontWeight="700"
                >
                  {label}
                </text>
              </g>
            );
          })}
        {view === "3d" && (
          <g stroke={sceneColors.dimension} fill={sceneColors.dimension}>
            <line
              x1={guide.x + 26}
              y1={guide.y}
              x2={guideTop.x + 26}
              y2={guideTop.y}
            />
            <text
              x={guideTop.x + 34}
              y={guideTop.y + 14}
              fontSize="13"
              stroke="none"
            >
              {m(props.heightMm)} m
            </text>
          </g>
        )}
        <text
          x={point(props.widthMm / 2, props.depthMm).x}
          y={point(props.widthMm / 2, props.depthMm).y + 28}
          textAnchor="middle"
          fill={sceneColors.dimension}
          fontSize="14"
        >
          {m(props.widthMm)} m
        </text>
        <text
          x={point(props.widthMm, props.depthMm / 2).x + 30}
          y={point(props.widthMm, props.depthMm / 2).y + 22}
          textAnchor="middle"
          fill={sceneColors.dimension}
          fontSize="14"
        >
          {m(props.depthMm)} m
        </text>
        {callouts
          .filter((c) => c !== null)
          .reverse()
          .map(({ zone, anchor, x, y, unitCount }) => (
            <g
              key={zone.zoneId}
              aria-hidden="true"
              onClick={() => onSelect(zone.zoneId)}
              className="cursor-pointer"
              opacity={searching && !matchIds.includes(zone.zoneId) ? 0.35 : 1}
            >
              <line
                x1={anchor.x}
                y1={anchor.y}
                x2={x + 110}
                y2={y + 58}
                stroke={
                  zone.zoneId === selectedId
                    ? sceneColors.selected
                    : sceneColors.free
                }
              />
              <rect
                x={x}
                y={y}
                data-floor-callout="true"
                width="220"
                height="58"
                rx="6"
                fill={sceneColors.labelSurface}
                stroke={
                  zone.zoneId === selectedId
                    ? sceneColors.selected
                    : sceneColors.free
                }
              />
              <text
                x={x + 10}
                y={y + 24}
                fill={sceneColors.label}
                fontSize="20"
                fontWeight="600"
              >
                {zone.label.length > 20
                  ? `${zone.label.slice(0, 19)}…`
                  : zone.label}
              </text>
              <text
                x={x + 10}
                y={y + 46}
                fill={sceneColors.secondaryLabel}
                fontSize="15"
              >
                {zone.code.split("-").at(-1)} ·{" "}
                {unitCount
                  ? t("mapUnitCount", { count: unitCount })
                  : t("mapEmpty")}
              </text>
            </g>
          ))}
      </g>
    </svg>
  );
}

function FloorPositionDetail({
  zone,
  zones,
  blocks,
  onSelect,
}: {
  readonly zone: StorageZoneRow;
  readonly zones: readonly StorageZoneRow[];
  readonly blocks: readonly Area[];
  readonly onSelect: (id: string) => void;
}) {
  const t = useTranslations("StorageLayouts");
  const groupCode = pdGroupCode(zone.code);
  const groupZones = groupCode
    ? zones.filter((candidate) => pdGroupCode(candidate.code) === groupCode)
    : [];
  const bounds = groupCode ? groupBounds(groupZones) : zone;
  const cells = groupCode
    ? groupZones.map((candidate) => ({ ...candidate, id: candidate.zoneId }))
    : floorPositions(zone).map((position) => ({
        ...position,
        id: undefined,
        xMm: position.xMm!,
        yMm: position.yMm!,
        widthMm: position.widthMm!,
        depthMm: position.depthMm!,
      }));
  const aisles = groupCode
    ? blocks.filter(isAisleBlock).flatMap((block) => {
        const xMm = Math.max(block.xMm, bounds.xMm);
        const yMm = Math.max(block.yMm, bounds.yMm);
        const right = Math.min(
          block.xMm + block.widthMm,
          bounds.xMm + bounds.widthMm,
        );
        const bottom = Math.min(
          block.yMm + block.depthMm,
          bounds.yMm + bounds.depthMm,
        );
        return right > xMm && bottom > yMm
          ? [{ xMm, yMm, widthMm: right - xMm, depthMm: bottom - yMm }]
          : [];
      })
    : positionAisles(zone);
  const titleCode = groupCode ?? zone.code;
  return (
    <section
      className="mt-5 min-w-0 rounded-xl border border-border p-3 sm:p-4"
      aria-label={t("floorPositionDetail", { code: titleCode })}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">
          {t("floorPositionDetail", { code: titleCode })}
        </h3>
        <p className="text-sm text-muted">
          {t("floorPositionCount", { count: cells.length })}
        </p>
      </div>
      <div className="overflow-x-auto">
        <svg
          role="group"
          aria-label={t("floorPositionDetail", { code: titleCode })}
          viewBox={`0 0 ${bounds.widthMm} ${bounds.depthMm}`}
          className="w-full min-w-[640px] border border-border bg-[#ffb68e]"
        >
          <desc>{t("mapKeyboardHint")}</desc>
          {cells.map((position) => {
            const x = position.xMm - bounds.xMm;
            const y = position.yMm - bounds.yMm;
            return (
              <g
                key={position.code}
                data-detail-position-code={position.code}
                {...(position.id === undefined
                  ? {}
                  : {
                      role: "button",
                      tabIndex: position.id === zone.zoneId ? 0 : -1,
                      "aria-label": t("mapSelectLocation", {
                        name: position.code,
                      }),
                      "aria-pressed": position.id === zone.zoneId,
                      onClick: () => onSelect(position.id!),
                      onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelect(position.id!);
                        } else if (
                          [
                            "ArrowLeft",
                            "ArrowRight",
                            "ArrowUp",
                            "ArrowDown",
                          ].includes(event.key)
                        ) {
                          event.preventDefault();
                          const current = groupZones.find(
                            (candidate) => candidate.zoneId === position.id,
                          );
                          const next =
                            current &&
                            adjacentZone(groupZones, current, event.key);
                          if (!next) return;
                          onSelect(next.zoneId);
                          const controls = event.currentTarget
                            .closest("svg")
                            ?.querySelectorAll<SVGGElement>(
                              "[data-detail-position-code]",
                            );
                          [...(controls ?? [])]
                            .find(
                              (control) =>
                                control.getAttribute(
                                  "data-detail-position-code",
                                ) === next.code,
                            )
                            ?.focus();
                        }
                      },
                    })}
              >
                <rect
                  x={x}
                  y={y}
                  width={position.widthMm}
                  height={position.depthMm}
                  fill="#83a8b1"
                  stroke={position.id === zone.zoneId ? "#4d57c3" : "#263640"}
                  strokeWidth="14"
                  strokeDasharray="40 35"
                />
                <text
                  x={x + position.widthMm / 2}
                  y={y + position.depthMm / 2}
                  dominantBaseline="middle"
                  textAnchor="middle"
                  fill="#172329"
                  fontSize="140"
                  fontWeight="700"
                >
                  {position.code}
                </text>
              </g>
            );
          })}
          {aisles.map((aisle, index) => {
            const width = Math.min(aisle.widthMm, aisle.depthMm);
            return (
              <g key={index} data-detail-aisle-width-mm={width}>
                <text
                  x={aisle.xMm - bounds.xMm + aisle.widthMm / 2}
                  y={aisle.yMm - bounds.yMm + aisle.depthMm / 2}
                  dominantBaseline="middle"
                  textAnchor="middle"
                  fill="#172329"
                  fontSize={Math.min(180, width * 0.55)}
                  fontWeight="700"
                >
                  {t("floorAisleWidth", { width: m(width) })}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
