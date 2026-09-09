"use client";
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
          const reserved = box.placement.status === "RESERVED";
          const moving = box.placement.moveState === "IN_TRANSIT";
          const status =
            box.placement.moveRole === "TARGET"
              ? moveTargetLabel
              : box.placement.moveRole === "SOURCE"
                ? moving
                  ? moveInTransitLabel
                  : moveSourceLabel
                : reserved
                  ? reservedLabel
                  : storedLabel;
          const held = reserved || moving;
          const attributes = {
            "data-placement-id": box.placement.placementId,
            "data-placement-x-mm": box.xMm,
            "data-placement-y-mm": box.yMm,
            "data-placement-z-mm": box.zMm,
            "data-placement-status": box.placement.status ?? "STORED",
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
      className="inline-flex rounded-lg border border-border bg-background p-1"
    >
      <button
        type="button"
        aria-pressed={value === "plan"}
        onClick={() => onChange("plan")}
        className="min-h-9 rounded-md px-3 text-xs font-medium text-muted transition hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-accent-surface aria-pressed:text-accent"
      >
        {planLabel}
      </button>
      <button
        type="button"
        aria-pressed={value === "3d"}
        onClick={() => onChange("3d")}
        className="min-h-9 rounded-md px-3 text-xs font-medium text-muted transition hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-accent-surface aria-pressed:text-accent"
      >
        {threeDLabel}
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
            className="fill-none stroke-border/40"
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
            className="fill-surface/70 stroke-accent/70"
            strokeWidth="1.5"
          />
          {isometricGridLines.map(([start, end], index) => (
            <line
              key={index}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              className="stroke-muted/30"
              strokeWidth="0.75"
            />
          ))}
          {reservedBlocks.map((block) => (
            <polygon
              key={block.id}
              points={pointsAttribute([
                point(block.xMm, block.yMm),
                point(block.xMm + block.widthMm, block.yMm),
                point(block.xMm + block.widthMm, block.yMm + block.depthMm),
                point(block.xMm, block.yMm + block.depthMm),
              ])}
              className="fill-warning/15 stroke-warning/45"
              strokeWidth="1.25"
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
            <SceneBox
              points={[...selectionBottom, ...selectionTop]}
              mode="3d"
              kind="location"
              selected
              held={variant === "reserved"}
              invalid={invalid}
            />
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
            className="stroke-muted"
            strokeDasharray="4 4"
          />
          <text
            x={heightGuideTop.x + 20}
            y={(heightGuideBottom.y + heightGuideTop.y) / 2}
            dominantBaseline="central"
            className="fill-muted text-[10px]"
          >
            H {floorHeightMm / 1_000} m
          </text>
        </>
      ) : (
        <>
          <rect
            width={floorWidthMm}
            height={floorDepthMm}
            fill={`url(#${patternId})`}
          />
          <rect
            width={floorWidthMm}
            height={floorDepthMm}
            className="fill-accent/5 stroke-muted"
            strokeWidth={planStrokeWidth}
          />
          {reservedBlocks.map((block) => (
            <rect
              key={block.id}
              x={block.xMm}
              y={block.yMm}
              width={block.widthMm}
              height={block.depthMm}
              className="fill-warning/25 stroke-warning/70"
              strokeWidth={planStrokeWidth}
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
                  className="fill-muted"
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
            <SceneBox
              kind="location"
              mode="plan"
              selected
              invalid={invalid}
              held={variant === "reserved"}
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
  );
}
