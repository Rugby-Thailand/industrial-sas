"use client";
import { sceneColors } from "@/components/storageScene/sceneColors";
import {
  clampStoragePosition,
  placementStatusKey,
} from "@/lib/storageLayouts/storageKit";
import {
  resolveAreaColor,
  areaColorText,
} from "@/lib/storageLayouts/areaColors";
import { SceneBox } from "@/components/storageScene/SceneBox";

import { useId, useRef } from "react";
import type { StorageStackPlacementRow } from "@/lib/convex/storageLayoutApi";
import {
  storagePlacementBoxes,
  storagePlacementCorners,
  type StoragePlacementBox,
} from "@/lib/storageLayouts/storagePlacementGeometry";

import {
  pointsAttribute,
  projectIsometricPoint,
  unprojectIsometricDelta,
} from "@/lib/storageLayouts/isometricGeometry";

export type StorageViewMode = "plan" | "3d";

export interface StorageVisualArea {
  readonly color?: string;
  readonly heightMm?: number;
  readonly id: string;
  readonly label?: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly placements?: readonly StorageStackPlacementRow[];
}

export interface StorageVisualSelection extends StorageVisualArea {
  readonly heightMm: number;
}

/** Unavailable geometry keeps its color independently of selection/error outlines. */
export function ReservedAreaShape({
  points,
  color,
  label,
  mode,
  selected = false,
  invalid = false,
  fontSize = 11,
}: {
  readonly points: readonly { x: number; y: number }[];
  readonly color?: string | undefined;
  readonly label?: string | undefined;
  readonly mode: StorageViewMode;
  readonly selected?: boolean;
  readonly invalid?: boolean;
  readonly fontSize?: number;
}) {
  const patternId = `area-${useId().replaceAll(":", "")}`;
  const base = resolveAreaColor(color);
  const contrast = areaColorText(color);
  const top =
    points.length === 8 && mode === "3d" ? points.slice(4) : points.slice(0, 4);
  const faces =
    points.length === 8 && mode === "3d"
      ? [
          [points[1]!, points[2]!, points[6]!, points[5]!],
          [points[2]!, points[3]!, points[7]!, points[6]!],
          top,
        ]
      : [top];
  const center = {
    x: top.reduce((sum, p) => sum + p.x, 0) / 4,
    y: top.reduce((sum, p) => sum + p.y, 0) / 4,
  };
  return (
    <g data-area-color={base}>
      <title>{label}</title>
      <defs>
        <pattern
          id={patternId}
          width={fontSize}
          height={fontSize}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2={fontSize}
            stroke={contrast}
            strokeWidth={fontSize / 5}
            opacity="0.2"
          />
        </pattern>
      </defs>
      {faces.map((face, index) => (
        <g key={index}>
          <polygon
            data-zone-face={
              selected
                ? mode === "plan"
                  ? "plan"
                  : index === faces.length - 1
                    ? "top"
                    : "side"
                : undefined
            }
            points={pointsAttribute(face)}
            fill={base}
            stroke={contrast}
            vectorEffect="non-scaling-stroke"
          />
          {index < faces.length - 1 && (
            <polygon
              points={pointsAttribute(face)}
              fill="#000000"
              opacity={index === 0 ? 0.15 : 0.3}
            />
          )}
          <polygon points={pointsAttribute(face)} fill={`url(#${patternId})`} />
        </g>
      ))}
      {(selected || invalid) &&
        faces.map((face, index) => (
          <polygon
            key={index}
            points={pointsAttribute(face)}
            fill="none"
            stroke={invalid ? sceneColors.invalid : sceneColors.selected}
            strokeWidth="3"
            strokeDasharray={invalid ? "5 3" : undefined}
            vectorEffect="non-scaling-stroke"
            className="group-focus-visible:stroke-text"
          />
        ))}
      {label && (
        <text
          x={center.x}
          y={center.y}
          textAnchor="middle"
          dominantBaseline="central"
          fill={contrast}
          stroke={base}
          strokeWidth={fontSize / 3}
          paintOrder="stroke"
          fontSize={fontSize}
          className="pointer-events-none"
        >
          {label}
        </text>
      )}
    </g>
  );
}

export function ReservedAreaLegend({
  areas,
}: {
  readonly areas: readonly {
    readonly label?: string | undefined;
    readonly color?: string | undefined;
  }[];
}) {
  if (areas.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 px-3 py-2 text-xs text-muted">
      {areas
        .filter((area) => area.label)
        .map((area, index) => (
          <li key={index} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-sm border"
              style={{
                backgroundColor: resolveAreaColor(area.color),
                borderColor: areaColorText(area.color),
              }}
            />
            {area.label}
          </li>
        ))}
    </ul>
  );
}

/** Shared floor/zone occupancy layer; box coordinates are already floor-relative. */
export function StoragePlacementLayer({
  boxes,
  mode,
  point = (x, y) => ({ x, y }),
  reservedLabel = "Reserved",
  storedLabel = "Stored",
  moveSourceLabel = "Move source",
  moveInTransitLabel = "Last confirmed position · moving",
  moveTargetLabel = "Move destination reserved",
}: {
  readonly boxes: readonly StoragePlacementBox[];
  readonly mode: StorageViewMode;
  readonly point?: (
    x: number,
    y: number,
    z: number,
  ) => { x: number; y: number };
  readonly reservedLabel?: string;
  readonly storedLabel?: string;
  readonly moveSourceLabel?: string;
  readonly moveInTransitLabel?: string;
  readonly moveTargetLabel?: string;
}) {
  return (
    <g data-storage-placements="true" className="pointer-events-none">
      {[...boxes]
        .sort((a, b) => a.xMm + a.yMm - (b.xMm + b.yMm) || a.zMm - b.zMm)
        .map((box) => {
          const projected = storagePlacementCorners(box).map((p) =>
            point(p.x, p.y, mode === "3d" ? p.z : 0),
          );
          const statusKey = placementStatusKey(box.placement);
          const status =
            statusKey === "placementMoveTarget"
              ? moveTargetLabel
              : statusKey === "placementMoveInTransit"
                ? moveInTransitLabel
                : statusKey === "placementMoveSource"
                  ? moveSourceLabel
                  : statusKey === "placementReserved"
                    ? reservedLabel
                    : storedLabel;
          const held =
            statusKey === "placementReserved" ||
            statusKey === "placementMoveInTransit" ||
            statusKey === "placementMoveTarget";
          const attributes = {
            "data-placement-id": box.placement.placementId,
            "data-placement-x-mm": box.xMm,
            "data-placement-y-mm": box.yMm,
            "data-placement-z-mm": box.zMm,
            "data-placement-status": box.placement.status ?? "STORED",
            "data-placement-status-key": statusKey,
            "data-move-role": box.placement.moveRole,
            "data-move-state": box.placement.moveState,
          };
          return (
            <g key={box.placement.placementId} {...attributes}>
              <title>
                {box.placement.lpn} · {box.placement.positionCode ?? ""} ·{" "}
                {status}
              </title>
              <SceneBox
                points={projected}
                mode={mode}
                kind="package"
                held={held}
                source={box.placement.moveRole === "SOURCE"}
              />
            </g>
          );
        })}
    </g>
  );
}

export function StorageViewModeToggle({
  value,
  onChange,
  label,
  planLabel,
  threeDLabel,
}: {
  readonly value: StorageViewMode;
  readonly onChange: (value: StorageViewMode) => void;
  readonly label: string;
  readonly planLabel: string;
  readonly threeDLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-lg border border-border bg-background p-0.5"
    >
      <button
        type="button"
        aria-label={planLabel}
        title={planLabel}
        aria-pressed={value === "plan"}
        onClick={() => onChange("plan")}
        className="min-h-12 rounded-md px-3 text-xs font-medium text-muted transition-colors hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-accent-surface aria-pressed:text-link motion-reduce:transition-none"
      >
        2D
      </button>
      <button
        type="button"
        aria-label={threeDLabel}
        title={threeDLabel}
        aria-pressed={value === "3d"}
        onClick={() => onChange("3d")}
        className="min-h-12 rounded-md px-3 text-xs font-medium text-muted transition-colors hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-accent-surface aria-pressed:text-link motion-reduce:transition-none"
      >
        3D
      </button>
    </div>
  );
}

export function StorageZoneVisualizer({
  mode,
  ariaLabel,
  floorWidthMm,
  floorDepthMm,
  floorHeightMm,
  selection,
  zones,
  reservedBlocks,
  variant = "storage",
  dragLabel,
  dragHintId,
  onPositionChange,
  className = "h-72 w-full",
  reservedLabel,
  storedLabel,
  moveSourceLabel,
  moveInTransitLabel,
  moveTargetLabel,
  contextBoxes = [],
  invalid = false,
}: {
  readonly mode: StorageViewMode;
  readonly ariaLabel: string;
  readonly floorWidthMm: number;
  readonly floorDepthMm: number;
  readonly floorHeightMm: number;
  readonly invalid?: boolean;
  readonly contextBoxes?: readonly StoragePlacementBox[];
  readonly selection: StorageVisualSelection;
  readonly zones: readonly StorageVisualArea[];
  readonly reservedBlocks: readonly StorageVisualArea[];
  readonly variant?: "storage" | "reserved";
  readonly dragLabel?: string;
  readonly dragHintId?: string;
  readonly onPositionChange?: (position: {
    readonly xMm: number;
    readonly yMm: number;
  }) => void;
  readonly className?: string;
  readonly reservedLabel?: string;
  readonly storedLabel?: string;
  readonly moveSourceLabel?: string;
  readonly moveInTransitLabel?: string;
  readonly moveTargetLabel?: string;
}) {
  const patternId = `storage-zone-${useId().replaceAll(":", "")}`;
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
  const interactive = onPositionChange !== undefined;
  const drawnWidthMm = Math.max(100, Math.min(selection.widthMm, floorWidthMm));
  const drawnDepthMm = Math.max(100, Math.min(selection.depthMm, floorDepthMm));
  const drawnHeightMm = Math.max(
    100,
    Math.min(selection.heightMm, floorHeightMm),
  );
  const drawnXMm = Math.max(
    0,
    Math.min(selection.xMm, Math.max(0, floorWidthMm - drawnWidthMm)),
  );
  const drawnYMm = Math.max(
    0,
    Math.min(selection.yMm, Math.max(0, floorDepthMm - drawnDepthMm)),
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
  const selectionBottom = [
    point(drawnXMm, drawnYMm),
    point(drawnXMm + drawnWidthMm, drawnYMm),
    point(drawnXMm + drawnWidthMm, drawnYMm + drawnDepthMm),
    point(drawnXMm, drawnYMm + drawnDepthMm),
  ];
  const selectionTop = [
    point(drawnXMm, drawnYMm, drawnHeightMm),
    point(drawnXMm + drawnWidthMm, drawnYMm, drawnHeightMm),
    point(drawnXMm + drawnWidthMm, drawnYMm + drawnDepthMm, drawnHeightMm),
    point(drawnXMm, drawnYMm + drawnDepthMm, drawnHeightMm),
  ];
  const displayedGridStepMm = Math.max(
    1_000,
    Math.ceil(Math.max(floorWidthMm, floorDepthMm) / 20_000) * 1_000,
  );
  const isometricGridLines = [
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
  const isometricVisualPoints = [
    ...floorShape,
    ...selectionTop,
    ...contextBoxes.flatMap((box) =>
      storagePlacementCorners(box).map((p) => point(p.x, p.y, p.z)),
    ),
    ...zones.flatMap((zone) =>
      storagePlacementCorners({
        xMm: zone.xMm,
        yMm: zone.yMm,
        zMm: 0,
        widthMm: zone.widthMm,
        depthMm: zone.depthMm,
        heightMm: zone.heightMm ?? floorHeightMm,
      }).map((p) => point(p.x, p.y, p.z)),
    ),
    heightGuideTop,
    { x: heightGuideBottom.x + 64, y: heightGuideBottom.y },
    { x: heightGuideTop.x + 64, y: heightGuideTop.y },
    ...zones.flatMap((zone) =>
      storagePlacementBoxes(zone.placements ?? [], zone).flatMap((box) =>
        storagePlacementCorners(box).map((p) => point(p.x, p.y, p.z)),
      ),
    ),
  ];
  const isometricXs = isometricVisualPoints.map((visualPoint) => visualPoint.x);
  const isometricYs = isometricVisualPoints.map((visualPoint) => visualPoint.y);
  const isometricPadding = 34;
  const isometricViewBox = {
    x: Math.min(...isometricXs) - isometricPadding,
    y: Math.min(...isometricYs) - isometricPadding,
    width:
      Math.max(...isometricXs) -
      Math.min(...isometricXs) +
      isometricPadding * 2,
    height:
      Math.max(...isometricYs) -
      Math.min(...isometricYs) +
      isometricPadding * 2,
  };
  const planPadding = Math.max(floorWidthMm, floorDepthMm) * 0.05;
  const planStrokeWidth = Math.max(
    30,
    Math.max(floorWidthMm, floorDepthMm) / 650,
  );
  const viewBox =
    mode === "3d"
      ? isometricViewBox
      : {
          x: -planPadding,
          y: -planPadding,
          width: floorWidthMm + planPadding * 2,
          height: floorDepthMm + planPadding * 2,
        };
  const clampPosition = (nextXMm: number, nextYMm: number) =>
    clampStoragePosition(
      nextXMm,
      nextYMm,
      floorWidthMm,
      floorDepthMm,
      drawnWidthMm,
      drawnDepthMm,
    );
  const clientPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (svg === null || matrix === null || matrix === undefined) {
      return undefined;
    }
    const visualPoint = svg.createSVGPoint();
    visualPoint.x = clientX;
    visualPoint.y = clientY;
    return visualPoint.matrixTransform(matrix.inverse());
  };
  const finishDrag = (pointerId: number) => {
    if (dragState.current?.pointerId !== pointerId) return;
    svgRef.current?.releasePointerCapture(pointerId);
    dragState.current = undefined;
  };
  const interactionProps = interactive
    ? {
        role: "button" as const,
        tabIndex: 0,
        "aria-label": dragLabel,
        "aria-describedby": dragHintId,
        onPointerDown: (event: React.PointerEvent<SVGGElement>) => {
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
        },
        onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => {
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
        },
      }
    : {};

  return (
    <>
      <svg
        ref={svgRef}
        role="img"
        aria-label={ariaLabel}
        data-view-mode={mode}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        className={className}
        onPointerMove={(event) => {
          const drag = dragState.current;
          if (
            onPositionChange === undefined ||
            drag === undefined ||
            drag.pointerId !== event.pointerId
          ) {
            return;
          }
          const current = clientPoint(event.clientX, event.clientY);
          if (current === undefined) return;
          const delta =
            mode === "3d"
              ? unprojectIsometricDelta(
                  { x: current.x - drag.startX, y: current.y - drag.startY },
                  scale,
                )
              : {
                  x: current.x - drag.startX,
                  y: current.y - drag.startY,
                };
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
            width={mode === "3d" ? 18 : 1_000}
            height={mode === "3d" ? 18 : 1_000}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={mode === "3d" ? "M 18 0 L 0 0 0 18" : "M 1000 0 L 0 0 0 1000"}
              fill="none"
              stroke={sceneColors.grid}
              strokeOpacity={0.4}
              strokeWidth={mode === "3d" ? 0.75 : planStrokeWidth / 2}
            />
          </pattern>
        </defs>
        {mode === "3d" ? (
          <>
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
            {isometricGridLines.map(([start, end], index) => (
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
            {reservedBlocks.map((block) => (
              <ReservedAreaShape
                key={block.id}
                color={block.color}
                label={block.label}
                mode="3d"
                points={[
                  point(block.xMm, block.yMm),
                  point(block.xMm + block.widthMm, block.yMm),
                  point(block.xMm + block.widthMm, block.yMm + block.depthMm),
                  point(block.xMm, block.yMm + block.depthMm),
                ]}
              />
            ))}
            {zones.map((zone) => (
              <SceneBox
                key={zone.id}
                kind="location"
                mode="3d"
                points={storagePlacementCorners({
                  xMm: zone.xMm,
                  yMm: zone.yMm,
                  zMm: 0,
                  widthMm: zone.widthMm,
                  depthMm: zone.depthMm,
                  heightMm: zone.heightMm ?? floorHeightMm,
                }).map((p) => point(p.x, p.y, p.z))}
              />
            ))}
            <g
              {...interactionProps}
              className={
                interactive
                  ? "group cursor-grab outline-none active:cursor-grabbing"
                  : undefined
              }
              style={interactive ? { touchAction: "none" } : undefined}
            >
              {variant === "reserved" ? (
                <ReservedAreaShape
                  points={[...selectionBottom, ...selectionTop]}
                  color={selection.color}
                  label={selection.label}
                  mode="3d"
                  selected
                  invalid={invalid}
                />
              ) : (
                <SceneBox
                  points={[...selectionBottom, ...selectionTop]}
                  mode="3d"
                  kind="location"
                  selected
                  invalid={invalid}
                />
              )}
            </g>
            <StoragePlacementLayer
              mode="3d"
              {...(reservedLabel === undefined ? {} : { reservedLabel })}
              {...(storedLabel === undefined ? {} : { storedLabel })}
              {...(moveSourceLabel === undefined ? {} : { moveSourceLabel })}
              {...(moveInTransitLabel === undefined
                ? {}
                : { moveInTransitLabel })}
              {...(moveTargetLabel === undefined ? {} : { moveTargetLabel })}
              boxes={[
                ...contextBoxes,
                ...zones.flatMap((zone) =>
                  storagePlacementBoxes(zone.placements ?? [], zone),
                ),
              ]}
              point={point}
            />
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
              H {floorHeightMm / 1_000} m
            </text>
          </>
        ) : (
          <>
            <rect
              width={floorWidthMm}
              height={floorDepthMm}
              fill={sceneColors.floor}
              stroke={sceneColors.boundary}
              strokeWidth={planStrokeWidth}
            />
            <rect
              width={floorWidthMm}
              height={floorDepthMm}
              fill={`url(#${patternId})`}
            />
            {reservedBlocks.map((block) => (
              <ReservedAreaShape
                key={block.id}
                color={block.color}
                label={block.label}
                mode="plan"
                fontSize={Math.max(280, floorWidthMm / 42)}
                points={storagePlacementCorners({
                  ...block,
                  zMm: 0,
                  heightMm: 0,
                }).map((p) => ({ x: p.x, y: p.y }))}
              />
            ))}
            {zones.map((zone) => (
              <g key={zone.id}>
                <SceneBox
                  kind="location"
                  mode="plan"
                  points={storagePlacementCorners({
                    xMm: zone.xMm,
                    yMm: zone.yMm,
                    zMm: 0,
                    widthMm: zone.widthMm,
                    depthMm: zone.depthMm,
                    heightMm: 0,
                  }).map((p) => ({ x: p.x, y: p.y }))}
                />
                {zone.label === undefined ? null : (
                  <text
                    x={zone.xMm + zone.widthMm / 2}
                    y={zone.yMm + zone.depthMm / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={sceneColors.secondaryLabel}
                    style={{ fontSize: Math.max(280, floorWidthMm / 42) }}
                  >
                    {zone.label}
                  </text>
                )}
              </g>
            ))}
            <g
              {...interactionProps}
              className={
                interactive
                  ? "group cursor-grab outline-none active:cursor-grabbing"
                  : undefined
              }
              style={interactive ? { touchAction: "none" } : undefined}
            >
              {variant === "reserved" ? (
                <ReservedAreaShape
                  color={selection.color}
                  label={selection.label}
                  mode="plan"
                  selected
                  invalid={invalid}
                  fontSize={Math.max(280, floorWidthMm / 42)}
                  points={storagePlacementCorners({
                    xMm: drawnXMm,
                    yMm: drawnYMm,
                    widthMm: drawnWidthMm,
                    depthMm: drawnDepthMm,
                    zMm: 0,
                    heightMm: 0,
                  }).map((p) => ({ x: p.x, y: p.y }))}
                />
              ) : (
                <>
                  <SceneBox
                    kind="location"
                    mode="plan"
                    selected
                    invalid={invalid}
                    points={storagePlacementCorners({
                      xMm: drawnXMm,
                      yMm: drawnYMm,
                      zMm: 0,
                      widthMm: drawnWidthMm,
                      depthMm: drawnDepthMm,
                      heightMm: 0,
                    }).map((p) => ({ x: p.x, y: p.y }))}
                  />
                  {selection.label === undefined ? null : (
                    <text
                      x={drawnXMm + drawnWidthMm / 2}
                      y={drawnYMm + drawnDepthMm / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="pointer-events-none fill-text font-bold"
                      style={{ fontSize: Math.max(280, floorWidthMm / 42) }}
                    >
                      {selection.label}
                    </text>
                  )}
                </>
              )}
            </g>
            <StoragePlacementLayer
              mode="plan"
              {...(reservedLabel === undefined ? {} : { reservedLabel })}
              {...(storedLabel === undefined ? {} : { storedLabel })}
              {...(moveSourceLabel === undefined ? {} : { moveSourceLabel })}
              {...(moveInTransitLabel === undefined
                ? {}
                : { moveInTransitLabel })}
              {...(moveTargetLabel === undefined ? {} : { moveTargetLabel })}
              boxes={[
                ...contextBoxes,
                ...zones.flatMap((zone) =>
                  storagePlacementBoxes(zone.placements ?? [], zone),
                ),
              ]}
            />
          </>
        )}
      </svg>
      <ReservedAreaLegend
        areas={
          variant === "reserved"
            ? [...reservedBlocks, selection]
            : reservedBlocks
        }
      />
    </>
  );
}
