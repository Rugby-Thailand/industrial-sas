"use client";
import { FloorMapDrawing } from "./FloorMapDrawing";
import {
  type Area,
  floorZoneUnitCount,
  floorPlanBounds,
  hasUnmeasuredInventory,
  adjacentZone,
  groupBounds,
  groupedAreas,
  isAisleBlock,
  m,
  pdCells,
  pdGroupCode,
} from "./floorMapGeometry";
import {
  FloorWorkspaceToolbar,
  type LocationFilter,
} from "./FloorWorkspaceToolbar";
import { useFloorWorkspaceView } from "./useFloorWorkspaceView";
import { IconButton } from "@/components/ui/IconButton";
import styles from "./FloorMap.module.css";
import { Popover } from "radix-ui";
import { LocationDetailsHost } from "./LocationDetailsHost";
import { useStorageLayoutMobile } from "./useStorageLayoutMobile";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { preferences } from "@/lib/browser/storage";
import { resolveAreaColor } from "@/lib/storageLayouts/areaColors";
import {
  locationInventory,
  matchingStorageLocations as matchingFloorZones,
} from "@/lib/storageLayouts/locationSelectors";
import { FloorLocationTable } from "./FloorLocationTable";
import { floorPositions, positionAisles } from "./floorPositionGeometry";
import { ReservedAreaLegend } from "./StorageZoneVisualizer";
import { FloorMapCameraControls } from "./FloorMapCameraControls";
import { useFloorMapCamera } from "./useFloorMapCamera";

import { Button } from "@/components/ui/button";
import { useCanManage } from "@/hooks/useCanManage";
import { Link } from "@/i18n/navigation";
import type { StorageZoneRow } from "@/lib/convex/storageLayoutApi";
import { palletPath } from "@/lib/navigation";
import { occupiedStorageFootprintAreaSqMm } from "@/lib/storageLayouts/storagePlacementGeometry";
import { placementStatusKey } from "@/lib/storageLayouts/storageKit";
import { PlacementStatusBadge } from "@/features/storageKit/PlacementStatusBadge";
import {
  ArrowRightLeft,
  ChevronDown,
  Eye,
  PencilLine,
  QrCode,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { QrCode as LocationQrCode } from "@/features/storageKit/QrCode";
import {
  useCallback,
  useMemo,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
  type CSSProperties,
} from "react";

export interface FloorMapProps {
  readonly initialView?: "3d" | "plan";
  readonly widthMm: number;
  readonly depthMm: number;
  readonly heightMm: number;
  readonly baseWidthMm: number;
  readonly baseDepthMm: number;
  readonly offsetXMm: number;
  readonly offsetYMm: number;
  readonly baseLabel: string;
  readonly buildingCode?: string;
  readonly floorNumber: number;
  readonly zones: readonly StorageZoneRow[];
  readonly blocks: readonly Area[];
  readonly onEditZone?: ((zoneId: string) => void) | undefined;
  readonly offsetEditor?: ReactNode;
  readonly locationActions?: ReactNode;
  readonly locationInspector?: ReactNode;
  readonly floorSelector?: ReactNode;
  readonly previewOnly?: boolean;
  readonly selectedZoneId?: string | undefined;
  readonly onSelectionChange?: ((id: string | undefined) => void) | undefined;
}
// Compatibility export for existing consumers.
export { matchingStorageLocations as matchingFloorZones } from "@/lib/storageLayouts/locationSelectors";
const iconStyle =
  "size-10 bg-transparent p-0 hover:border-accent hover:bg-transparent";
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
  const mobile = useStorageLayoutMobile();
  const {
    view: workspaceView,
    setView: setWorkspaceView,
    canSplit,
    workspaceRef,
    compactInspector,
  } = useFloorWorkspaceView();
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [floorsOpen, setFloorsOpen] = useState(false);
  const [filters, setFilters] = useState<readonly LocationFilter[]>([]);
  const [sheetSelection, setSheetSelection] = useState<string>();
  const [desktopTarget, setDesktopTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const [inlineTarget, setInlineTarget] = useState<HTMLDivElement | null>(null);
  const [sheetTarget, setSheetTarget] = useState<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(null);
  const interaction = useRef<Element | null>(null);
  const pendingAction = useRef<(() => void) | undefined>(undefined);
  const canManage = useCanManage();
  const showLocationLabels = useSyncExternalStore(
    subscribeLocationLabels,
    readLocationLabels,
    () => false,
  );
  const camera = useFloorMapCamera(props.initialView);
  const {
    view,
    zoom,
    focus,
    rotation,
    reference,
    showPackages,
    setFocus,
    setZoom,
    fit,
  } = camera;
  const [search, setSearch] = useState("");
  const [localSelectedId, setLocalSelectedId] = useState<string>();
  const selectedId = props.onSelectionChange
    ? props.selectedZoneId
    : localSelectedId;
  const { onSelectionChange } = props;
  const setSelectedId = useCallback(
    (id: string | undefined) => {
      setLocalSelectedId(id);
      onSelectionChange?.(id);
    },
    [onSelectionChange],
  );
  const [unitId, setUnitId] = useState<string>();
  const [areaIndex, setAreaIndex] = useState<number>();
  const [offsetEditing, setOffsetEditing] = useState(false);
  const [qr, setQr] = useState(false);
  const matches = useMemo(
    () =>
      matchingFloorZones(props.zones, search).filter((zone) => {
        if (!filters.length) return true;
        const counts = locationInventory(zone);
        return filters.some((filter) =>
          filter === "empty"
            ? counts.units === 0 && !counts.incomplete
            : counts[filter] > 0,
        );
      }),
    [props.zones, search, filters],
  );
  const matchIds = useMemo(() => matches.map((zone) => zone.zoneId), [matches]);
  const selected = props.zones.find((z) => z.zoneId === selectedId);
  const selectedArea =
    areaIndex === undefined ? undefined : props.blocks[areaIndex];
  const detailKey =
    selected?.zoneId ?? (selectedArea ? `area:${areaIndex}` : undefined);
  const sheetOpen =
    workspaceView !== "list" &&
    compactInspector &&
    !!detailKey &&
    sheetSelection === detailKey;
  if (sheetSelection && (!compactInspector || sheetSelection !== detailKey))
    setSheetSelection(undefined);
  function openDetails() {
    opener.current = interaction.current ?? document.activeElement;
    if (detailKey) setSheetSelection(detailKey);
  }
  const runDetailAction = useCallback(
    (action: () => void) => {
      if (sheetOpen) {
        pendingAction.current = action;
        setSheetSelection(undefined);
      } else action();
    },
    [sheetOpen],
  );
  const {
    legacyPositionCount,
    pdZoneCount,
    aisleBlocks,
    legendAreas,
    areaGroups,
    positionCount,
    groupCount,
  } = useMemo(() => {
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
    return {
      legacyPositionCount,
      pdZoneCount,
      aisleBlocks,
      legendAreas,
      areaGroups,
      positionCount,
      groupCount,
    };
  }, [props.zones, props.blocks]);
  const clearSelection = useCallback(() => {
    setSelectedId(undefined);
    setUnitId(undefined);
    setAreaIndex(undefined);
    setQr(false);
    setFocus(undefined);
  }, [setSelectedId, setFocus]);
  const select = useCallback(
    (id: string, palletId?: string) => {
      setSelectedId(id);
      setInspectorVisible(true);
      if (compactInspector && workspaceView !== "list") {
        opener.current = interaction.current ?? document.activeElement;
        setSheetSelection(id);
      }
      setUnitId(palletId);
      setAreaIndex(undefined);
      setQr(false);
      setFocus(undefined);
      if (
        view === "plan" &&
        pdGroupCode(props.zones.find((zone) => zone.zoneId === id)?.code ?? "")
      )
        setZoom((current) => Math.max(current, 4));
    },
    [
      setSelectedId,
      compactInspector,
      props.zones,
      view,
      workspaceView,
      setFocus,
      setZoom,
    ],
  );
  const selectMapLocation = useCallback(
    (id: string, palletId?: string) => {
      if (!mobile && id === selectedId && palletId === undefined) {
        clearSelection();
        fit();
      } else {
        select(id, palletId);
      }
    },
    [mobile, selectedId, clearSelection, fit, select],
  );
  const selectArea = useCallback(
    (index: number) => {
      clearSelection();
      if (index === areaIndex) fit();
      else {
        setAreaIndex(index);
        setInspectorVisible(true);
        if (compactInspector) {
          opener.current = interaction.current ?? document.activeElement;
          setSheetSelection(`area:${index}`);
        }
      }
    },
    [clearSelection, areaIndex, fit, compactInspector],
  );
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
  const inspectorDetails = (
    <>
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
              style={{ backgroundColor: resolveAreaColor(selectedArea.color) }}
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
            {action(t("mapClearSelection"), <X />, () => {
              clearSelection();
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
            {props.onEditZone && canManage && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={iconStyle}
                aria-label={t("editStorageZone", { label: selected.label })}
                onClick={() =>
                  runDetailAction(() => props.onEditZone?.(selected.zoneId))
                }
              >
                <PencilLine />
              </Button>
            )}
            {action(t("mapShowQR"), <QrCode />, () => setQr(!qr), false, qr)}
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
                      X {m(p.xMm ?? 0)} · Y {m(p.yMm ?? 0)} · Z {m(p.zMm ?? 0)}{" "}
                      m
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
    </>
  );
  const floorControls = props.floorSelector ? (
    <Popover.Root open={floorsOpen} onOpenChange={setFloorsOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={styles.floorChip}
          aria-label={t("floorSelector")}
        >
          {t("floor", { floor: props.floorNumber })}
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className={`${styles.theme} ${styles.floorPopover}`}
          onClick={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest("button")
            )
              setFloorsOpen(false);
          }}
        >
          {props.floorSelector}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  ) : null;
  const cameraControls = (
    <FloorMapCameraControls
      camera={camera}
      hasPdCells={pdZoneCount > 0}
      baseLabel={props.baseLabel}
      showLocationLabels={showLocationLabels}
      onLocationLabelsChange={saveLocationLabels}
    >
      {legendAreas.length > 6 ? (
        <details className="mt-3 rounded-lg border border-border bg-background">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium marker:text-muted">
            {t("floorMapAreas", {
              count: legendAreas.length,
            })}
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
                {t("floorAllAreaNames", {
                  count: legendAreas.length,
                })}
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
    </FloorMapCameraControls>
  );
  const canvasFooter = useMemo(
    () => (
      <>
        <div className={styles.mapKey}>
          <div className={styles.legend}>
            <span>
              <i className={styles.swatch} />
              {t("mapEmpty")}
            </span>
            <span>
              <i className={`${styles.swatch} ${styles.occupied}`} />
              {t("locationTable.stored")}
            </span>
            <span>
              <i className={`${styles.swatch} ${styles.reserved}`} />
              {t("placementReserved")}
            </span>
          </div>
          {positionCount > 0 && (
            <p className={styles.positionSummary} role="status">
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
        <div className={styles.stamp}>
          <span className={styles.floorStamp}>
            {props.buildingCode && `${props.buildingCode} / `}
            {t("canvasFloor", {
              floor: String(props.floorNumber).padStart(2, "0"),
            })}
          </span>
          <p>
            {t(view === "plan" ? "planView" : "threeDView")} ·{" "}
            {Math.round(zoom * 100)}%
          </p>
        </div>
      </>
    ),
    [
      t,
      positionCount,
      groupCount,
      props.zones.length,
      props.buildingCode,
      props.floorNumber,
      view,
      zoom,
    ],
  );
  const planBounds = floorPlanBounds(props, reference);
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
    <div ref={workspaceRef} className={`${styles.theme} ${styles.workspace}`}>
      <div className={styles.workspaceToolbar}>
        <FloorWorkspaceToolbar
          search={search}
          onSearch={(value) => {
            setSearch(value);
            if (
              !matchingFloorZones(props.zones, value).some(
                (zone) => zone.zoneId === selectedId,
              )
            )
              clearSelection();
          }}
          filters={filters}
          onFilters={(value) => {
            setFilters(value);
            if (selected && value.length) {
              const counts = locationInventory(selected);
              if (
                !value.some((filter) =>
                  filter === "empty"
                    ? counts.units === 0 && !counts.incomplete
                    : counts[filter] > 0,
                )
              )
                clearSelection();
            }
          }}
          view={workspaceView}
          onView={setWorkspaceView}
          canSplit={canSplit}
          count={matches.length}
          floorNumber={props.floorNumber}
          floorControl={floorControls}
          dimensions={`${m(props.widthMm)} × ${m(props.depthMm)} × ${m(props.heightMm)} m`}
          cameraControls={workspaceView !== "list" ? cameraControls : undefined}
          actions={props.locationActions}
        />
      </div>
      <section
        aria-label={t("mapTitle")}
        className={`${styles.workArea} @container min-w-0`}
        data-view={workspaceView}
        data-camera={view}
        style={
          {
            "--floor-aspect":
              Math.max(planBounds.widthMm, 1) / Math.max(planBounds.depthMm, 1),
          } as CSSProperties
        }
        data-inspector={
          workspaceView !== "list" &&
          !!(selected || selectedArea) &&
          inspectorVisible &&
          !compactInspector
        }
        onClickCapture={(event) => {
          interaction.current =
            event.target instanceof Element
              ? event.target.closest('[role="button"],button,tr')
              : null;
        }}
        onKeyDownCapture={() => {
          interaction.current = document.activeElement;
        }}
        onKeyDown={(event) => {
          // Dialog keyboard events can bubble through React portals after Radix
          // closes the dialog. Only a canvas Escape should clear selection.
          const fromDialog =
            event.target instanceof Element &&
            event.target.closest('[role="dialog"]') !== null;
          if (
            event.key === "Escape" &&
            !sheetOpen &&
            !fromDialog &&
            !event.defaultPrevented
          ) {
            clearSelection();
          }
        }}
      >
        <div className={styles.panels}>
          <div
            id={`${inspectorId}-map`}
            className={styles.mapPanel}
            role="region"
            aria-label={t("workspace.map")}
            hidden={workspaceView === "list"}
          >
            <div className={styles.canvas}>
              {workspaceView !== "list" && (
                <FloorMapDrawing
                  widthMm={props.widthMm}
                  depthMm={props.depthMm}
                  heightMm={props.heightMm}
                  baseWidthMm={props.baseWidthMm}
                  baseDepthMm={props.baseDepthMm}
                  offsetXMm={props.offsetXMm}
                  offsetYMm={props.offsetYMm}
                  baseLabel={props.baseLabel}
                  zones={props.zones}
                  blocks={props.blocks}
                  view={view}
                  rotation={rotation}
                  zoom={zoom}
                  focus={focus}
                  onFocusChange={setFocus}
                  selectedAreaIndex={areaIndex}
                  onSelectArea={selectArea}
                  reference={reference}
                  showLocationLabels={showLocationLabels}
                  showPackages={showPackages}
                  selectedId={selected?.zoneId}
                  selectedUnit={unitId}
                  matchIds={matchIds}
                  searching={!!search.trim() || filters.length > 0}
                  onSelect={selectMapLocation}
                >
                  {canvasFooter}
                </FloorMapDrawing>
              )}
            </div>
            {selected && floorPositions(selected).length > 0 && (
              <FloorPositionDetail
                zone={selected}
                zones={props.zones}
                blocks={props.blocks}
                onSelect={select}
              />
            )}
          </div>
          <div
            className={styles.listPanel}
            id={`${inspectorId}-list`}
            role="region"
            aria-label={t("workspace.list")}
            hidden={workspaceView === "map"}
          >
            <FloorLocationTable
              workspace
              zones={matches}
              groupedPositions={legacyPositionCount > 0}
              search={search}
              onClearSelection={clearSelection}
              actions={props.locationActions}
              selectedId={selected?.zoneId}
              onSelect={(id) =>
                selectedId === id ? clearSelection() : select(id)
              }
              details={
                workspaceView === "list" &&
                selected && (
                  <div className={styles.inlineDetails}>
                    {!props.locationInspector && inspectorDetails}
                    <div ref={setInlineTarget} />
                  </div>
                )
              }
              onShowMap={() => setWorkspaceView("map")}
            />
          </div>
        </div>
        {workspaceView !== "list" &&
          (selected || selectedArea) &&
          inspectorVisible &&
          !compactInspector && (
            <aside
              id={inspectorId}
              tabIndex={-1}
              aria-label={t("mapSelected")}
              className={styles.inspector}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold text-muted">
                  {t("locationDetails")}
                </h2>
                <IconButton
                  label={t("workspace.hideDetails")}
                  variant="ghost"
                  onClick={() => setInspectorVisible(false)}
                >
                  <X />
                </IconButton>
              </div>
              {(!props.locationInspector || !selected) && inspectorDetails}
              <div ref={setDesktopTarget} />
            </aside>
          )}
        {workspaceView !== "list" &&
          (selected || selectedArea) &&
          ((!inspectorVisible && !compactInspector) ||
            (compactInspector && !sheetOpen)) && (
            <Button
              type="button"
              className={styles.reopenDetails}
              variant="outline"
              onClick={() => {
                if (compactInspector) openDetails();
                else setInspectorVisible(true);
              }}
            >
              {selected?.code ?? selectedArea?.label} · {t("locationDetails")}
            </Button>
          )}
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
        <Sheet
          open={sheetOpen}
          onOpenChange={(open) => {
            if (!open) setSheetSelection(undefined);
          }}
        >
          <SheetContent
            side="bottom"
            closeLabel={t("closeDialog")}
            className={`${styles.theme} max-h-[85dvh] gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]`}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const action = pendingAction.current;
              pendingAction.current = undefined;
              if (action) requestAnimationFrame(action);
              else {
                const target = opener.current;
                if (
                  target?.isConnected &&
                  !target.closest("[hidden]") &&
                  "focus" in target &&
                  typeof target.focus === "function"
                )
                  target.focus({ preventScroll: true });
                else {
                  const floorButton = document.querySelector<HTMLButtonElement>(
                    '[data-floor-view-controls] button[aria-pressed="true"]',
                  );
                  (
                    floorButton ??
                    document.querySelector<HTMLButtonElement>(
                      'button[aria-pressed="true"]',
                    )
                  )?.focus({
                    preventScroll: true,
                  });
                }
              }
            }}
          >
            <SheetHeader className="shrink-0 pr-14">
              <SheetTitle>{t("locationDetails")}</SheetTitle>
              <SheetDescription className="break-words">
                {selected?.code ?? selectedArea?.label} ·{" "}
                {t("floor", { floor: props.floorNumber })}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
              {(!props.locationInspector || !selected) && inspectorDetails}
              <div ref={setSheetTarget} />
            </div>
          </SheetContent>
        </Sheet>
        <LocationDetailsHost.Provider
          value={{
            target:
              workspaceView === "list"
                ? inlineTarget
                : compactInspector
                  ? sheetOpen
                    ? sheetTarget
                    : null
                  : desktopTarget,
            runAction: runDetailAction,
            editZone: props.onEditZone,
            selectedUnitId: unitId,
          }}
        >
          {props.locationInspector}
        </LocationDetailsHost.Provider>
      </section>
    </div>
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
