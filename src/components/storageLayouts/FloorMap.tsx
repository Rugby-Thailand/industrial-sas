"use client";
import { preferences } from "@/lib/browser/storage";
import { SceneBox, SceneLegendMark } from "@/components/storageScene/SceneBox";
import { sceneColors } from "@/components/storageScene/sceneColors";
import { SceneToolbar } from "@/components/storageScene/SceneToolbar";
import {
  locationInventory,
  matchingStorageLocations as matchingFloorZones,
} from "@/lib/storageLayouts/locationSelectors";
import { FloorLocationTable } from "./FloorLocationTable";
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
import { useId, useState, useSyncExternalStore, type ReactNode } from "react";

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
const iconStyle =
  "size-10 bg-transparent p-0 hover:border-accent hover:bg-transparent";

// Presentation-only preference shared by every floor and retained across visits.
const labelsStorageKey = "storage-planner:floor-map:show-location-labels";
const labelsChangedEvent = "storage-planner:floor-map-labels-changed";
let labelsFallback = true;
let labelsStorageUnavailable = false;

function readLocationLabels() {
  if (labelsStorageUnavailable) return labelsFallback;
  return preferences.read(
    labelsStorageKey,
    (value) => (typeof value === "boolean" ? value : true),
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
    () => true,
  );
  const [view, setView] = useState<"3d" | "plan">("3d");
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
  const [rotation, setRotation] = useState(0);
  const [reference, setReference] = useState(false);
  const [offsetEditing, setOffsetEditing] = useState(false);
  const [qr, setQr] = useState(false);
  const matches = matchingFloorZones(props.zones, search);
  const selected = props.zones.find((z) => z.zoneId === selectedId);
  const select = (id: string, palletId?: string) => {
    setSelectedId(id);
    setUnitId(palletId);
    setQr(false);
  };
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
        if (event.key === "Escape") {
          setSelectedId(undefined);
          setUnitId(undefined);
          setQr(false);
        }
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
              onChange={setView}
              label={t("viewMode")}
              planLabel={t("planView")}
              threeDLabel={t("threeDView")}
            />{" "}
            {action(
              t("mapZoomOut"),
              <ZoomOut />,
              () => setZoom(Math.max(1, zoom - 0.25)),
              zoom <= 1,
            )}
            {action(
              t("mapZoomIn"),
              <ZoomIn />,
              () => setZoom(Math.min(2.5, zoom + 0.25)),
              zoom >= 2.5,
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
              false,
              showLocationLabels,
            )}
            {action(t("mapFit"), <Maximize />, () => setZoom(1))}
            {action(
              t("mapRotate"),
              <RotateCw />,
              () => setRotation((rotation + 1) % 4),
              view === "plan",
            )}
            {action(
              props.baseLabel,
              <Layers3 />,
              () => setReference(!reference),
              false,
              reference,
            )}
          </>
        }
      />
      <div className="mt-4 grid min-w-0 grid-cols-1 items-start gap-4 @min-[900px]:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0">
          <MapDrawing
            {...props}
            view={view}
            rotation={rotation}
            zoom={zoom}
            reference={reference}
            showLocationLabels={showLocationLabels}
            selectedId={selected?.zoneId}
            selectedUnit={unitId}
            matchIds={matches.map((z) => z.zoneId)}
            searching={!!search.trim()}
            onSelect={select}
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
          <ReservedAreaLegend areas={props.blocks} />
          {props.zones.length === 0 && (
            <p className="mt-3 text-sm text-muted">{t("noStorageSpots")}</p>
          )}
        </div>
        <aside
          id={inspectorId}
          tabIndex={-1}
          aria-label={t("mapSelected")}
          className="min-w-0 py-2 @min-[900px]:pl-2"
        >
          {!selected ? (
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
                {action(t("mapClearSelection"), <X />, () => {
                  setSelectedId(undefined);
                  setUnitId(undefined);
                })}
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
          {props.locationInspector}
        </aside>
      </div>
      <div className="mt-4 min-w-0">
        <FloorLocationTable
          zones={matches}
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            const found = matchingFloorZones(props.zones, value);
            if (!found.some((zone) => zone.zoneId === selectedId)) {
              setSelectedId(undefined);
              setUnitId(undefined);
            }
          }}
          onClearSelection={() => {
            setSelectedId(undefined);
            setUnitId(undefined);
          }}
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
  reference: boolean;
  showLocationLabels: boolean;
  selectedId: string | undefined;
  selectedUnit: string | undefined;
  matchIds: string[];
  searching: boolean;
  onSelect: (id: string, palletId?: string) => void;
}) {
  const t = useTranslations("StorageLayouts");
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
    710 / Math.max(maxX - minX, 1),
    440 / Math.max(maxY - minY, 1),
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
  const zoneOrder = (showLocationLabels ? [...props.zones] : []).sort(
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
  const callouts = (showLocationLabels ? zoneOrder : []).map((zone) => {
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
  const center =
    selected && zoom > 1
      ? point(
          selected.xMm + selected.widthMm / 2,
          selected.yMm + selected.depthMm / 2,
        )
      : { x: 460, y: 330 };
  return (
    <svg
      role="group"
      aria-label={t("mapTitle")}
      viewBox="0 0 920 660"
      className="aspect-[1.4] max-h-[40rem] w-full rounded-xl border border-border bg-background"
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.focus();
      }}
      tabIndex={-1}
    >
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
        {props.blocks.map((b, i) => (
          <g key={i} data-unavailable-area="true">
            <ReservedAreaShape
              color={b.color}
              label={b.label}
              mode={view}
              fontSize={17}
              points={rect(b.xMm, b.yMm, b.widthMm, b.depthMm)}
            />
          </g>
        ))}
        {props.zones.map((zone) => {
          const active = zone.zoneId === selectedId;
          const base = rect(zone.xMm, zone.yMm, zone.widthMm, zone.depthMm);
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
              tabIndex={0}
              aria-label={t("mapSelectLocation", { name: zone.label })}
              aria-pressed={active}
              onClick={() => onSelect(zone.zoneId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(zone.zoneId);
                }
              }}
              className="group cursor-pointer outline-none"
              opacity={searching && !matchIds.includes(zone.zoneId) ? 0.3 : 1}
            >
              <title>{`${zone.label} · ${zone.code}`}</title>
              <g
                data-zone-id={zone.zoneId}
                data-height-envelope={view === "3d" ? "true" : undefined}
              >
                <SceneBox
                  points={[...base, ...top]}
                  mode={view}
                  kind="location"
                  selected={active}
                />
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
                tabIndex={0}
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
