"use client";
import { sceneColors } from "@/components/storageScene/sceneColors";
import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { SceneBox } from "@/components/storageScene/SceneBox";
import {
  StoragePlacementLayer,
  ReservedAreaShape,
  ReservedAreaLegend,
  StorageViewModeToggle,
  StorageZoneVisualizer,
  type StorageViewMode,
} from "./StorageZoneVisualizer";
import type {
  StorageZoneRow,
  StorageReservedBlockRow,
} from "@/lib/convex/storageLayoutApi";
import {
  pointsAttribute,
  projectIsometricPoint,
  unprojectIsometricDelta,
} from "@/lib/storageLayouts/isometricGeometry";
import {
  storagePlacementBoxes,
  storagePlacementCorners,
  rectanglesOverlap,
} from "@/lib/storageLayouts/storagePlacementGeometry";
import { storageRectangleContains } from "../../../convex/model/storageLayout/storageZone";
type EditableBlock = Omit<StorageReservedBlockRow, "blockId"> & {
  readonly id: string;
};
const metres = (value: number) => value / 1000;
const draftMillimetres = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 1_000) : 0;
};

export function StorageZoneDraftPreview({
  floorWidthMm,
  floorDepthMm,
  floorHeightMm,
  zoneX,
  zoneY,
  zoneWidth,
  zoneDepth,
  stackHeight,
  zones,
  reservedBlocks = [],
  editingZone,
  variant = "storage",
  selectedColor,
  selectedLabel,
  onPositionChange,
}: {
  readonly floorWidthMm: number;
  readonly floorDepthMm: number;
  readonly floorHeightMm: number;
  readonly zoneX: string;
  readonly zoneY: string;
  readonly zoneWidth: string;
  readonly zoneDepth: string;
  readonly stackHeight: string;
  readonly zones: readonly StorageZoneRow[];
  readonly editingZone?: StorageZoneRow;
  readonly reservedBlocks?: readonly EditableBlock[];
  readonly variant?: "storage" | "reserved";
  readonly selectedColor?: string;
  readonly selectedLabel?: string;
  readonly onPositionChange: (position: {
    readonly xMm: number;
    readonly yMm: number;
  }) => void;
}) {
  const t = useTranslations("StorageLayouts");
  const [view, setView] = useState<StorageViewMode>("3d");
  const patternId = useId();
  const dragHintId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const dragState = useRef<
    | {
        readonly pointerId: number;
        readonly startX: number;
        readonly startY: number;
        readonly xMm: number;
        readonly yMm: number;
      }
    | undefined
  >(undefined);
  const xMm = draftMillimetres(zoneX);
  const yMm = draftMillimetres(zoneY);
  const widthMm = draftMillimetres(zoneWidth);
  const depthMm = draftMillimetres(zoneDepth);
  const heightMm = draftMillimetres(stackHeight);
  const isReserved = variant === "reserved";
  const previewLabel = t(
    view === "3d"
      ? isReserved
        ? "reservedZonePreview"
        : "storageZonePreview"
      : isReserved
        ? "reservedZonePlanPreview"
        : "storageZonePlanPreview",
  );
  const dragLabel = t(isReserved ? "dragReservedZone" : "dragStorageZone");
  const dragHint = t(
    isReserved ? "dragReservedZoneHint" : "dragStorageZoneHint",
  );
  const draft = { xMm, yMm, widthMm, depthMm };
  const overlapsContext = isReserved
    ? reservedBlocks.some((area) => rectanglesOverlap(draft, area)) ||
      zones.some(
        (area) =>
          rectanglesOverlap(draft, area) &&
          !storageRectangleContains(area, draft),
      )
    : zones.some((area) => rectanglesOverlap(draft, area)) ||
      reservedBlocks.some(
        (area) =>
          rectanglesOverlap(draft, area) &&
          !storageRectangleContains(draft, area),
      );
  const fitsFloor =
    xMm >= 0 &&
    yMm >= 0 &&
    widthMm > 0 &&
    depthMm > 0 &&
    heightMm > 0 &&
    xMm + widthMm <= floorWidthMm &&
    yMm + depthMm <= floorDepthMm &&
    heightMm <= floorHeightMm &&
    !overlapsContext;
  const drawnWidthMm = Math.max(100, Math.min(widthMm, floorWidthMm));
  const drawnDepthMm = Math.max(100, Math.min(depthMm, floorDepthMm));
  const drawnHeightMm = Math.max(100, Math.min(heightMm, floorHeightMm));
  const drawnXMm = Math.max(
    0,
    Math.min(xMm, Math.max(0, floorWidthMm - drawnWidthMm)),
  );
  const drawnYMm = Math.max(
    0,
    Math.min(yMm, Math.max(0, floorDepthMm - drawnDepthMm)),
  );
  const scale = 0.016;
  const point = (x: number, y: number, z = 0) =>
    projectIsometricPoint({ x: x * scale, y: y * scale, z: z * scale });
  const floorShape = [
    point(0, 0),
    point(floorWidthMm, 0),
    point(floorWidthMm, floorDepthMm),
    point(0, floorDepthMm),
  ];
  const zoneBottom = [
    point(drawnXMm, drawnYMm),
    point(drawnXMm + drawnWidthMm, drawnYMm),
    point(drawnXMm + drawnWidthMm, drawnYMm + drawnDepthMm),
    point(drawnXMm, drawnYMm + drawnDepthMm),
  ];
  const zoneTop = [
    point(drawnXMm, drawnYMm, drawnHeightMm),
    point(drawnXMm + drawnWidthMm, drawnYMm, drawnHeightMm),
    point(drawnXMm + drawnWidthMm, drawnYMm + drawnDepthMm, drawnHeightMm),
    point(drawnXMm, drawnYMm + drawnDepthMm, drawnHeightMm),
  ];
  const displayedGridStepMm = Math.max(
    1_000,
    Math.ceil(Math.max(floorWidthMm, floorDepthMm) / 20_000) * 1_000,
  );
  const gridLines = [
    ...Array.from(
      {
        length: Math.max(0, Math.ceil(floorWidthMm / displayedGridStepMm) - 1),
      },
      (_, index) => {
        const x = (index + 1) * displayedGridStepMm;
        return [point(x, 0), point(x, floorDepthMm)] as const;
      },
    ),
    ...Array.from(
      {
        length: Math.max(0, Math.ceil(floorDepthMm / displayedGridStepMm) - 1),
      },
      (_, index) => {
        const y = (index + 1) * displayedGridStepMm;
        return [point(0, y), point(floorWidthMm, y)] as const;
      },
    ),
  ];
  const heightGuideBottom = point(floorWidthMm, 0);
  const heightGuideTop = point(floorWidthMm, 0, floorHeightMm);
  const contextBoxes = [
    ...zones,
    ...(editingZone ? [editingZone] : []),
  ].flatMap((zone) => storagePlacementBoxes(zone.placements, zone));
  const visualPoints = [
    ...zones.flatMap((zone) =>
      storagePlacementCorners({
        xMm: zone.xMm,
        yMm: zone.yMm,
        zMm: 0,
        widthMm: zone.widthMm,
        depthMm: zone.depthMm,
        heightMm: zone.maxStackHeightMm,
      }).map((p) => point(p.x, p.y, p.z)),
    ),
    ...contextBoxes.flatMap((box) =>
      storagePlacementCorners(box).map((p) => point(p.x, p.y, p.z)),
    ),
    ...floorShape,
    ...zoneTop,
    ...zones.flatMap((zone) =>
      storagePlacementBoxes(zone.placements, zone).flatMap((box) =>
        storagePlacementCorners(box).map((p) => point(p.x, p.y, p.z)),
      ),
    ),
    heightGuideTop,
    { x: heightGuideBottom.x + 64, y: heightGuideBottom.y },
    { x: heightGuideTop.x + 64, y: heightGuideTop.y },
  ];
  const visualXs = visualPoints.map((visualPoint) => visualPoint.x);
  const visualYs = visualPoints.map((visualPoint) => visualPoint.y);
  const padding = 34;
  const viewBox = {
    x: Math.min(...visualXs) - padding,
    y: Math.min(...visualYs) - padding,
    width: Math.max(...visualXs) - Math.min(...visualXs) + padding * 2,
    height: Math.max(...visualYs) - Math.min(...visualYs) + padding * 2,
  };
  const clampPosition = (nextXMm: number, nextYMm: number) => ({
    xMm: Math.max(
      0,
      Math.min(nextXMm, Math.max(0, floorWidthMm - drawnWidthMm)),
    ),
    yMm: Math.max(
      0,
      Math.min(nextYMm, Math.max(0, floorDepthMm - drawnDepthMm)),
    ),
  });
  const clientPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (svg === null || matrix === null || matrix === undefined)
      return undefined;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(matrix.inverse());
  };
  const finishDrag = (pointerId: number) => {
    if (dragState.current?.pointerId !== pointerId) return;
    svgRef.current?.releasePointerCapture(pointerId);
    dragState.current = undefined;
  };

  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-background">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-2 py-1">
        <div>
          <p className="text-sm font-semibold text-text">{previewLabel}</p>
          <p className="mt-0.5 text-xs text-muted tabular-nums">
            X {metres(xMm)} · Y {metres(yMm)} m
          </p>
        </div>
        <span
          aria-live="polite"
          className={
            fitsFloor
              ? "inline-flex items-center gap-1.5 text-xs font-medium text-success"
              : "inline-flex items-center gap-1.5 text-xs font-medium text-warning"
          }
        >
          <CheckCircle2 className="size-4" />
          {fitsFloor
            ? t(isReserved ? "reservedZoneFitsFloor" : "zoneFitsFloor")
            : t(isReserved ? "reservedZoneOutsideFloor" : "zoneOutsideFloor")}
        </span>
        <StorageViewModeToggle
          value={view}
          onChange={setView}
          label={t("viewMode")}
          planLabel={t("planView")}
          threeDLabel={t("threeDView")}
        />
      </figcaption>
      {view === "3d" ? (
        <svg
          ref={svgRef}
          role="img"
          aria-label={previewLabel}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
          className="h-72 w-full"
          onPointerMove={(event) => {
            const drag = dragState.current;
            if (drag === undefined || drag.pointerId !== event.pointerId)
              return;
            const current = clientPoint(event.clientX, event.clientY);
            if (current === undefined) return;
            const delta = unprojectIsometricDelta(
              { x: current.x - drag.startX, y: current.y - drag.startY },
              scale,
            );
            const snap = (value: number) => Math.round(value / 100) * 100;
            onPositionChange(
              clampPosition(snap(drag.xMm + delta.x), snap(drag.yMm + delta.y)),
            );
          }}
          onPointerUp={(event) => finishDrag(event.pointerId)}
          onPointerCancel={(event) => finishDrag(event.pointerId)}
        >
          <defs>
            <pattern
              id={patternId}
              width="18"
              height="18"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 18 0 L 0 0 0 18"
                fill="none"
                stroke={sceneColors.grid}
                strokeOpacity={0.4}
                strokeWidth="0.75"
              />
            </pattern>
          </defs>
          <rect
            x={viewBox.x}
            y={viewBox.y}
            width={viewBox.width}
            height={viewBox.height}
            fill={`url(#${patternId})`}
            opacity="0.45"
          />
          <polygon
            points={pointsAttribute(floorShape)}
            fill={sceneColors.floor}
            stroke={sceneColors.boundary}
            strokeWidth="1.5"
          />
          {gridLines.map(([start, end], index) => (
            <line
              key={index}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke={sceneColors.grid}
              strokeOpacity={0.6}
              strokeWidth="0.75"
            />
          ))}
          {reservedBlocks.map((block) => {
            const shape = [
              point(block.xMm, block.yMm),
              point(block.xMm + block.widthMm, block.yMm),
              point(block.xMm + block.widthMm, block.yMm + block.depthMm),
              point(block.xMm, block.yMm + block.depthMm),
            ];
            return (
              <ReservedAreaShape
                key={block.id}
                points={shape}
                color={block.color}
                label={block.label}
                mode="3d"
              />
            );
          })}
          {zones.map((zone) => (
            <SceneBox
              key={zone.zoneId}
              kind="location"
              mode="3d"
              points={storagePlacementCorners({
                xMm: zone.xMm,
                yMm: zone.yMm,
                zMm: 0,
                widthMm: zone.widthMm,
                depthMm: zone.depthMm,
                heightMm: zone.maxStackHeightMm,
              }).map((p) => point(p.x, p.y, p.z))}
            />
          ))}
          <g
            role="button"
            tabIndex={0}
            aria-label={dragLabel}
            aria-describedby={dragHintId}
            className="group cursor-grab outline-none active:cursor-grabbing"
            style={{ touchAction: "none" }}
            onPointerDown={(event) => {
              const start = clientPoint(event.clientX, event.clientY);
              if (start === undefined) return;
              event.preventDefault();
              svgRef.current?.setPointerCapture(event.pointerId);
              dragState.current = {
                pointerId: event.pointerId,
                startX: start.x,
                startY: start.y,
                xMm: drawnXMm,
                yMm: drawnYMm,
              };
            }}
            onKeyDown={(event) => {
              const movement: readonly [number, number] | undefined = {
                ArrowLeft: [-100, 0],
                ArrowRight: [100, 0],
                ArrowUp: [0, -100],
                ArrowDown: [0, 100],
              }[event.key] as readonly [number, number] | undefined;
              if (movement === undefined) return;
              event.preventDefault();
              onPositionChange(
                clampPosition(drawnXMm + movement[0], drawnYMm + movement[1]),
              );
            }}
          >
            {isReserved ? (
              <ReservedAreaShape
                points={[...zoneBottom, ...zoneTop]}
                color={selectedColor}
                label={selectedLabel}
                mode="3d"
                selected
                invalid={!fitsFloor}
              />
            ) : (
              <SceneBox
                points={[...zoneBottom, ...zoneTop]}
                mode="3d"
                kind="location"
                selected
                held={isReserved}
                invalid={!fitsFloor}
              />
            )}
          </g>
          <line
            x1={heightGuideBottom.x + 14}
            y1={heightGuideBottom.y}
            x2={heightGuideTop.x + 14}
            y2={heightGuideTop.y}
            stroke={sceneColors.dimension}
            strokeDasharray="4 4"
          />
          <text
            x={heightGuideTop.x + 20}
            y={(heightGuideBottom.y + heightGuideTop.y) / 2}
            dominantBaseline="central"
            fill={sceneColors.dimension}
            className="text-[10px]"
          >
            H {metres(floorHeightMm)} m
          </text>
          <StoragePlacementLayer
            mode="3d"
            boxes={contextBoxes}
            point={point}
            reservedLabel={t("placementReserved")}
            storedLabel={t("placementStored")}
            moveSourceLabel={t("placementMoveSource")}
            moveInTransitLabel={t("placementMoveInTransit")}
            moveTargetLabel={t("placementMoveTarget")}
          />
        </svg>
      ) : (
        <StorageZoneVisualizer
          mode="plan"
          invalid={!fitsFloor}
          contextBoxes={
            editingZone
              ? storagePlacementBoxes(editingZone.placements, editingZone)
              : []
          }
          reservedLabel={t("placementReserved")}
          storedLabel={t("placementStored")}
          moveSourceLabel={t("placementMoveSource")}
          moveInTransitLabel={t("placementMoveInTransit")}
          moveTargetLabel={t("placementMoveTarget")}
          ariaLabel={previewLabel}
          floorWidthMm={floorWidthMm}
          floorDepthMm={floorDepthMm}
          floorHeightMm={floorHeightMm}
          selection={{
            id: "draft",
            ...(selectedLabel ? { label: selectedLabel } : {}),
            ...(selectedColor ? { color: selectedColor } : {}),
            xMm,
            yMm,
            widthMm,
            depthMm,
            heightMm,
          }}
          zones={zones.map((zone) => ({
            id: zone.zoneId,
            label: zone.code,
            placements: zone.placements,
            xMm: zone.xMm,
            yMm: zone.yMm,
            widthMm: zone.widthMm,
            depthMm: zone.depthMm,
            heightMm: zone.maxStackHeightMm,
          }))}
          reservedBlocks={reservedBlocks.map((block) => ({
            id: block.id,
            label: block.label,
            ...(block.color ? { color: block.color } : {}),
            xMm: block.xMm,
            yMm: block.yMm,
            widthMm: block.widthMm,
            depthMm: block.depthMm,
          }))}
          variant={variant}
          dragLabel={dragLabel}
          dragHintId={dragHintId}
          onPositionChange={onPositionChange}
        />
      )}
      {view === "3d" && (
        <ReservedAreaLegend
          areas={
            isReserved
              ? [
                  ...reservedBlocks,
                  { label: selectedLabel, color: selectedColor },
                ]
              : reservedBlocks
          }
        />
      )}
      <div className="grid grid-cols-3 border-t border-border text-center text-xs tabular-nums">
        <span className="px-2 py-2 text-muted">
          W <strong className="text-text">{metres(widthMm)} m</strong>
        </span>
        <span className="border-x border-border px-2 py-2 text-muted">
          D <strong className="text-text">{metres(depthMm)} m</strong>
        </span>
        <span className="px-2 py-2 text-muted">
          H <strong className="text-text">{metres(heightMm)} m</strong>
        </span>
      </div>
      <p
        id={dragHintId}
        className="border-t border-border px-3 py-2 text-center text-xs text-muted"
      >
        {dragHint}
      </p>
    </figure>
  );
}
