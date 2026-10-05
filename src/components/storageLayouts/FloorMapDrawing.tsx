"use client";
import { memo, useMemo } from "react";
import { useTranslations } from "next-intl";
import { placementStatusKey } from "@/lib/storageLayouts/storageKit";
import { SceneBox } from "@/components/storageScene/SceneBox";
import { sceneColors } from "@/components/storageScene/sceneColors";
import {
  storagePlacementBoxes,
  storagePlacementCorners,
} from "@/lib/storageLayouts/storagePlacementGeometry";
import type { StorageZoneRow } from "@/lib/convex/storageLayoutApi";
import type { FloorMapProps } from "./FloorMap";
import styles from "./FloorMap.module.css";
import { useFloorMapViewport } from "./useFloorMapViewport";
import { useFloorMapPan } from "./useFloorMapPan";
import { useStorageLayoutMobile } from "./useStorageLayoutMobile";
import { floorPositions, positionAisles } from "./floorPositionGeometry";
import { ReservedAreaShape } from "./StorageZoneVisualizer";
import {
  adjacentZone,
  floorZoneUnitCount,
  isAisleBlock,
  labelZoom,
  m,
  pdCells,
  pdGroupCode,
  groupBounds,
  planColors,
  visualAreaColor,
} from "./floorMapGeometry";
function SceneDrawing({
  view,
  rotation,
  zoom,
  focus,
  onFocusChange,
  selectedAreaIndex,
  onSelectArea,
  reference,
  showLocationLabels,
  showPackages,
  selectedId,
  selectedUnit,
  matchIds,
  searching,
  onSelect,
  ...props
}: Pick<
  FloorMapProps,
  | "widthMm"
  | "depthMm"
  | "heightMm"
  | "baseWidthMm"
  | "baseDepthMm"
  | "offsetXMm"
  | "offsetYMm"
  | "baseLabel"
  | "zones"
  | "blocks"
> & {
  view: "3d" | "plan";
  rotation: number;
  zoom: number;
  focus: { x: number; y: number } | undefined;
  onFocusChange: (focus: { x: number; y: number }) => void;
  selectedAreaIndex: number | undefined;
  onSelectArea: (index: number) => void;
  reference: boolean;
  showLocationLabels: boolean;
  showPackages: boolean;
  selectedId: string | undefined;
  selectedUnit: string | undefined;
  matchIds: string[];
  searching: boolean;
  onSelect: (id: string, palletId?: string) => void;
}) {
  const t = useTranslations("StorageLayouts");
  const { svg: viewportSvg, aspect } = useFloorMapViewport();
  const mobile = useStorageLayoutMobile();
  const frameWidth = mobile ? 400 : 920;
  const frameCenterX = frameWidth / 2;
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
  const boxes = useMemo(
    () =>
      props.zones.flatMap((zone) =>
        storagePlacementBoxes(zone.placements, zone).map((box) => ({
          zone,
          box,
        })),
      ),
    [props.zones],
  );
  const pdGroups = useMemo(() => {
    const groups = new Map<string, StorageZoneRow[]>();
    for (const zone of pdCells(props.zones)) {
      const code = pdGroupCode(zone.code)!;
      const group = groups.get(code);
      if (group) group.push(zone);
      else groups.set(code, [zone]);
    }
    return Array.from(groups, ([code, zones]) => ({
      code,
      bounds: groupBounds(zones),
    }));
  }, [props.zones]);
  const pdGroupBounds = useMemo(
    () => new Map(pdGroups.map(({ code, bounds }) => [code, bounds])),
    [pdGroups],
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
  const frameHeight = aspect
    ? Math.max(180, frameWidth * aspect)
    : compactPlan
      ? 500
      : 660;
  const frameCenterY = frameHeight / 2;
  const labelSpace = showLocationLabels && !hasPdCells;
  const scale = Math.min(
    (frameWidth - (mobile ? 80 : labelSpace ? 210 : 120)) /
      Math.max(maxX - minX, 1),
    Math.max(
      60,
      frameHeight -
        (labelSpace
          ? Math.min(220, frameHeight / 3)
          : Math.min(120, frameHeight / 4)),
    ) / Math.max(maxY - minY, 1),
  );
  const point = (x: number, y: number, z = 0) => {
    const p = rawPoint(x, y, z);
    return {
      x: frameCenterX + (p.x - (minX + maxX) / 2) * scale,
      y: frameCenterY + (p.y - (minY + maxY) / 2) * scale,
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
    detailedPlan || !showLocationLabels
      ? []
      : props.zones.filter(
          (zone) => view !== "plan" || zone.placements.length > 0,
        )
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
  const scaleBarMm = 5000 / 2 ** Math.ceil(Math.log2(zoom));
  const scaleBarRight = frameCenterX + ((maxX - minX) * scale) / 2 + 35;
  const scaleBarY = frameCenterY + ((maxY - minY) * scale) / 2 + 38;
  const selected = props.zones.find((z) => z.zoneId === selectedId);
  const selectedArea =
    selectedAreaIndex === undefined
      ? undefined
      : props.blocks[selectedAreaIndex];
  const orderedZones = [...props.zones].sort(
    (a, b) => Number(a.zoneId === selectedId) - Number(b.zoneId === selectedId),
  );
  const target = selected ?? selectedArea;
  const frame = { x: 0, y: 0, width: frameWidth, height: frameHeight };
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
      frameCenterX - ((maxX - minX) / 2) * scale,
      frameCenterX + ((maxX - minX) / 2) * scale,
      frame.width / 2,
    ),
    y: clampAxis(
      p.y,
      frameCenterY - ((maxY - minY) / 2) * scale,
      frameCenterY + ((maxY - minY) / 2) * scale,
      frame.height / 2,
    ),
  });
  const center = !pannable
    ? { x: frameCenterX, y: frameCenterY }
    : clampFocus(
        focus ??
          (target
            ? point(
                target.xMm + target.widthMm / 2,
                target.yMm + target.depthMm / 2,
              )
            : { x: frameCenterX, y: frameCenterY }),
      );
  const transform = (point: { x: number; y: number }) =>
    `translate(${frameCenterX - point.x * zoom} ${frameCenterY - point.y * zoom}) scale(${zoom})`;
  const { group: panGroup, handlers: panHandlers } = useFloorMapPan({
    zoom,
    center,
    frame,
    clamp: clampFocus,
    transform,
    onCommit: onFocusChange,
  });
  return (
    <svg
      ref={viewportSvg}
      role="group"
      aria-label={t("mapTitle")}
      viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
      preserveAspectRatio="xMidYMid meet"
      className={`${styles.svg} ${pannable ? "cursor-grab select-none" : ""}`}
      style={pannable ? { touchAction: "none" } : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.focus();
      }}
      {...panHandlers}
      tabIndex={-1}
    >
      <desc>{t("mapKeyboardHint")}</desc>
      <g ref={panGroup} transform={transform(center)}>
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
          strokeWidth={view === "plan" ? 3 : 1.5}
        />
        {view === "3d" &&
          Array.from(
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
        {view === "3d" &&
          Array.from(
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
              style={{ outline: "none" }}
              {...(selectable
                ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-label": t("mapSelectArea", { name: b.label }),
                    "aria-pressed": active,
                    className: "group cursor-pointer",
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
              {b.areaKind ? (
                <g data-reserved-kind={b.areaKind}>
                  {/* Real floor footprint: aisles remain filled in both views. */}
                  <polygon
                    points={pts(rect(b.xMm, b.yMm, b.widthMm, b.depthMm))}
                    fill={visualAreaColor(b)}
                    stroke={active ? sceneColors.selected : undefined}
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>{b.label}</title>
                  </polygon>
                  {(b.areaKind === "PLATFORM" || b.areaKind === "STAIRS") &&
                    Array.from(
                      { length: b.areaKind === "STAIRS" ? 5 : 1 },
                      (_, stepIndex) => {
                        const count = b.areaKind === "STAIRS" ? 5 : 1;
                        const d = b.depthMm / count,
                          y = b.yMm + stepIndex * d;
                        const z =
                          view === "3d"
                            ? ((b.displayHeightMm ?? 0) * (count - stepIndex)) /
                              count
                            : 0;
                        const top = rect(b.xMm, y, b.widthMm, d, z);
                        const base = rect(b.xMm, y, b.widthMm, d);
                        return (
                          <g key={stepIndex}>
                            {view === "3d" &&
                              [0, 1, 2, 3].map((i) => (
                                <polygon
                                  key={i}
                                  points={pts([
                                    base[i]!,
                                    base[(i + 1) % 4]!,
                                    top[(i + 1) % 4]!,
                                    top[i]!,
                                  ])}
                                  fill={visualAreaColor(b)}
                                  stroke="#5d6265"
                                  strokeWidth={0.7}
                                />
                              ))}
                            <polygon
                              points={pts(top)}
                              fill={visualAreaColor(b)}
                              stroke="#5d6265"
                              strokeWidth={0.7}
                            />
                          </g>
                        );
                      },
                    )}
                </g>
              ) : hasPdCells && view === "plan" ? (
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
                  appearance="canvas"
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
        {orderedZones.map((zone) => {
          const active = zone.zoneId === selectedId;
          const cellLabel = zone.label.trim() || zone.code;
          const shortCode = zone.code.split("-").at(-1)!;
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
              style={{ outline: "none" }}
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
              className="group cursor-pointer"
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
                {view === "3d" && (
                  <SceneBox
                    points={[...base, ...top]}
                    mode={view}
                    kind="location"
                    selected={active}
                    selectionSurface={active}
                  />
                )}
                {view === "plan" &&
                  !pdGroupCode(zone.code) &&
                  floorPositions(zone).length === 0 && (
                    <>
                      <rect
                        x={base[0]!.x}
                        y={base[0]!.y}
                        width={base[1]!.x - base[0]!.x}
                        height={base[3]!.y - base[0]!.y}
                        rx={Math.min(4, (base[1]!.x - base[0]!.x) / 10)}
                        fill={
                          active
                            ? "var(--plan-selected)"
                            : floorZoneUnitCount(zone) > 0
                              ? "var(--plan-occupied)"
                              : "var(--plan-empty)"
                        }
                        stroke={
                          active
                            ? "var(--plan-selected-border)"
                            : floorZoneUnitCount(zone) > 0
                              ? "var(--plan-occupied-border)"
                              : "var(--plan-wall)"
                        }
                        strokeWidth={active ? 3 : 1.5}
                        vectorEffect="non-scaling-stroke"
                        data-zone-face="plan"
                        data-floor-zone-code={zone.code}
                        className={
                          active ? undefined : "group-focus-visible:stroke-text"
                        }
                      />
                      {cellWidth > 24 && cellHeight > 15 && (
                        <text
                          data-floor-zone-name={zone.code}
                          x={(base[0]!.x + base[1]!.x) / 2}
                          y={
                            (base[0]!.y + base[3]!.y) / 2 -
                            (cellHeight > 36 ? 6 : 0)
                          }
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill={
                            active
                              ? "var(--plan-selected-text)"
                              : "var(--plan-text)"
                          }
                          fontSize={Math.min(
                            13,
                            (base[1]!.x - base[0]!.x - 8) /
                              (shortCode.length * 0.6),
                          )}
                          fontWeight="600"
                          className="pointer-events-none font-mono"
                        >
                          {shortCode}
                          {cellHeight > 36 && (
                            <tspan
                              x={(base[0]!.x + base[1]!.x) / 2}
                              dy="18"
                              fontSize={Math.min(
                                10,
                                (base[1]!.x - base[0]!.x - 6) /
                                  (Math.max(
                                    1,
                                    (floorZoneUnitCount(zone)
                                      ? t("mapUnitCount", {
                                          count: floorZoneUnitCount(zone),
                                        })
                                      : t("mapEmpty")
                                    ).length,
                                  ) *
                                    0.6),
                              )}
                              fill={
                                active
                                  ? "var(--plan-selected-text)"
                                  : "var(--plan-muted)"
                              }
                            >
                              {floorZoneUnitCount(zone)
                                ? t("mapUnitCount", {
                                    count: floorZoneUnitCount(zone),
                                  })
                                : t("mapEmpty")}
                            </tspan>
                          )}
                        </text>
                      )}
                    </>
                  )}
                {view === "plan" && pdGroupCode(zone.code) && (
                  <>
                    <polygon
                      data-floor-zone-code={zone.code}
                      data-pd-cell-code={zone.code}
                      points={pts(base)}
                      fill={
                        active
                          ? "var(--plan-selected)"
                          : floorZoneUnitCount(zone) > 0
                            ? "var(--plan-occupied)"
                            : "var(--plan-empty)"
                      }
                      stroke={
                        active
                          ? "var(--plan-selected-border)"
                          : floorZoneUnitCount(zone) > 0
                            ? "var(--plan-occupied-border)"
                            : "var(--plan-wall)"
                      }
                      strokeWidth={active ? 1.5 : 0.75}
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
                          fill={
                            active
                              ? "var(--plan-selected-text)"
                              : planColors.storageLabel
                          }
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
                    <polygon points={pts(base)} fill={planColors.aisle} />
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
                        fill={planColors.storage}
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
                        fill={planColors.aisle}
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
                      strokeWidth={active ? 1.5 : 1}
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
        {[...(view === "3d" || showPackages ? boxes : [])]
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
        {view === "plan" ? (
          <g
            fill={sceneColors.dimension}
            stroke={sceneColors.dimension}
            className="font-mono"
            aria-hidden="true"
          >
            <path
              d={`M${floor[0]!.x} ${floor[0]!.y - 14}H${floor[1]!.x} M${floor[0]!.x} ${floor[0]!.y - 18}v8 M${floor[1]!.x} ${floor[1]!.y - 18}v8`}
              fill="none"
            />
            <text
              x={(floor[0]!.x + floor[1]!.x) / 2}
              y={floor[0]!.y - 24}
              textAnchor="middle"
              fontSize="12"
              stroke="none"
            >
              {m(props.widthMm)} m
            </text>
            <text
              x={floor[0]!.x - 18}
              y={(floor[0]!.y + floor[3]!.y) / 2}
              transform={`rotate(-90 ${floor[0]!.x - 18} ${(floor[0]!.y + floor[3]!.y) / 2})`}
              textAnchor="middle"
              fontSize="12"
              stroke="none"
            >
              {m(props.depthMm)} m
            </text>
          </g>
        ) : (
          <>
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
          </>
        )}
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
      {view === "plan" && (
        <g
          aria-hidden="true"
          stroke="var(--plan-muted)"
          fill="var(--plan-muted)"
          className="font-mono"
        >
          <path
            d={`M${scaleBarRight - scaleBarMm * scale * zoom} ${scaleBarY - 4}v4H${scaleBarRight}v-4`}
            fill="none"
          />
          <text
            x={scaleBarRight - (scaleBarMm * scale * zoom) / 2}
            y={scaleBarY - 7}
            textAnchor="middle"
            fontSize="10"
            stroke="none"
          >
            {m(scaleBarMm)} m
          </text>
        </g>
      )}
    </svg>
  );
}

export const FloorMapDrawing = memo(SceneDrawing);
