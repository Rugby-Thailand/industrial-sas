"use client";

import { useId, useRef, useState } from "react";
import {
  CircleCheck,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { unitCopy, type StorageFormat } from "./storageUnitLabels";
import { pointsAttribute } from "@/lib/storageLayouts/isometricGeometry";

import {
  constrainPalletPlacement,
  resolvePalletSupport,
  type PlacementSurface,
  palletFootprint,
  palletPlacementIssue,
  projectPalletPoint,
  rotatePalletPoint,
  unprojectPalletDelta,
  validDimensions,
  type OccupiedPallet,
  type PalletDimensions,
  type PalletPlacement,
  type PalletSupport,
  type UnavailablePalletArea,
} from "./palletGeometry";

export type {
  OccupiedPallet,
  PalletDimensions,
  PalletPlacement,
  PalletSupport,
  UnavailablePalletArea,
} from "./palletGeometry";

export interface PalletSceneProps {
  readonly dimensions: PalletDimensions;
  readonly area?: PalletDimensions;
  readonly placement?: PalletPlacement;
  readonly occupied?: readonly OccupiedPallet[];
  /** Reference geometry only: never contributes to collision checks. */
  readonly sourceFootprint?: Omit<OccupiedPallet, "status">;
  readonly support?: PalletSupport;
  readonly automaticSupports?: readonly PlacementSurface[];
  readonly baseSupport?: PlacementSurface;
  readonly issueMessage?: string;
  readonly unavailable?: readonly UnavailablePalletArea[];
  readonly onPlacementChange?: (placement: PalletPlacement) => void;
  readonly editable?: boolean;
  readonly locale: "th" | "en";
  readonly label?: string;
  readonly storageFormat?: StorageFormat | undefined;
  /** Hide example geometry labels for a product illustration before actual measurement. */
  readonly showDimensions?: boolean;
  readonly status?: "PROPOSED" | "RESERVED" | "STORED" | "SOURCE";
}

const copy = {
  en: {
    title: "Pallet preview",
    view: "View",
    plan: "2D plan",
    threeD: "3D view",
    rotateView: "Rotate view",
    reset: "Reset view",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    zoom: "Zoom",
    camera: "Camera controls",
    rotatePallet: "Rotate pallet 90°",
    move: "Move pallet",
    hint: "Drag the pallet or use arrow keys to move 0.1 m. Rotate view changes the camera only.",
    origin: "Origin",
    incoming: "This pallet",
    proposedPallet: "Proposed pallet",
    reservedPallet: "Reserved pallet",
    storedPallet: "Stored pallet",
    sourcePallet: "Pallet at last confirmed source position",
    sourcePosition: "Last confirmed source position · Pallet in transit",
    reservedPosition: "Reserved · Awaiting physical storage",
    storedPosition: "Stored at this position",
    reserved: "Reserved",
    stored: "Stored",
    fits: "Fits at this position",
    dimensions: "Enter valid dimensions to preview the pallet.",
    boundary: "Pallet extends outside this location",
    support:
      "The supporting base is too small or the pallet overhangs its edge",
    height: "Pallet exceeds the available height",
    overlap: "This position overlaps a stored or reserved pallet",
    area: "Location",
    width: "Width",
    depth: "Length",
    heightLabel: "Height",
    position: "Position",
  },
  th: {
    title: "ภาพตัวอย่างพาเลท",
    view: "มุมมอง",
    plan: "ผัง 2D",
    threeD: "มุมมอง 3D",
    rotateView: "หมุนมุมมอง",
    reset: "รีเซ็ตมุมมอง",
    zoomIn: "ขยายภาพ",
    zoomOut: "ย่อภาพ",
    zoom: "การขยายภาพ",
    camera: "เครื่องมือมุมมอง",
    rotatePallet: "หมุนพาเลท 90°",
    move: "ย้ายพาเลท",
    hint: "ลากพาเลทหรือใช้ปุ่มลูกศรเพื่อขยับครั้งละ 0.1 ม. การหมุนมุมมองจะหมุนเฉพาะกล้อง",
    origin: "จุดเริ่มต้น",
    incoming: "พาเลทนี้",
    proposedPallet: "พาเลทที่เสนอ",
    reservedPallet: "พาเลทที่จองแล้ว",
    storedPallet: "พาเลทที่จัดเก็บแล้ว",
    sourcePallet: "พาเลท ณ ตำแหน่งต้นทางที่ยืนยันล่าสุด",
    sourcePosition: "ตำแหน่งต้นทางที่ยืนยันล่าสุด · พาเลทอยู่ระหว่างย้าย",
    reservedPosition: "จองแล้ว · รอนำพาเลทเข้าจัดเก็บ",
    storedPosition: "จัดเก็บในตำแหน่งนี้แล้ว",
    reserved: "จองแล้ว",
    stored: "จัดเก็บแล้ว",
    fits: "จัดเก็บในตำแหน่งนี้ได้",
    dimensions: "กรอกขนาดที่ถูกต้องเพื่อดูภาพพาเลท",
    boundary: "พาเลทอยู่นอกขอบเขตจุดจัดเก็บ",
    support: "ฐานรองรับเล็กเกินไป หรือพาเลทวางเหลื่อมออกนอกฐาน",
    height: "พาเลทสูงเกินพื้นที่ที่ใช้ได้",
    overlap: "ตำแหน่งนี้ทับซ้อนพาเลทที่จัดเก็บหรือจองแล้ว",
    area: "จุดจัดเก็บ",
    width: "กว้าง",
    depth: "ยาว",
    heightLabel: "สูง",
    position: "ตำแหน่ง",
  },
} as const;

const zeroPlacement: PalletPlacement = { xMm: 0, yMm: 0, rotation: 0 };
const metres = (value: number) => `${Number((value / 1_000).toFixed(3))} m`;

export function PalletScene({
  dimensions,
  area,
  placement = zeroPlacement,
  occupied = [],
  sourceFootprint,
  onPlacementChange,
  editable = false,
  locale,
  label,
  storageFormat,
  showDimensions = true,
  status = "PROPOSED",
  support: requestedSupport,
  automaticSupports,
  baseSupport,
  issueMessage,
  unavailable = [],
}: PalletSceneProps) {
  const t = Object.fromEntries(
    Object.entries(copy[locale]).map(([key, value]) => [
      key,
      unitCopy(value, storageFormat),
    ]),
  ) as Record<keyof typeof copy.en, string>;
  const [planView, setPlanView] = useState(false);
  const [quarterTurns, setQuarterTurns] = useState(0);
  const [zoom, setZoom] = useState(1);
  const hintId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<
    | {
        pointerId: number;
        startX: number;
        startY: number;
        placement: PalletPlacement;
      }
    | undefined
  >(undefined);
  const supportValid =
    requestedSupport === undefined ||
    (validDimensions({
      ...requestedSupport,
      heightMm: Math.max(1, requestedSupport.heightMm),
    }) &&
      [requestedSupport.xMm, requestedSupport.yMm, requestedSupport.zMm].every(
        (value) => Number.isFinite(value) && value >= 0,
      ));
  const support = supportValid ? requestedSupport : undefined;
  const dimensionsValid = validDimensions(dimensions);
  const showMeasurements = showDimensions && dimensionsValid;
  const areaValid = area === undefined || validDimensions(area);
  // Invalid drafts remain editable in the form, but never become SVG coordinates.
  const safeDimensions = dimensionsValid
    ? dimensions
    : { widthMm: 1_000, depthMm: 1_000, heightMm: 1_000 };
  const footprint = palletFootprint(safeDimensions, placement.rotation);
  const surface =
    area !== undefined && areaValid
      ? area
      : {
          widthMm: footprint.widthMm * 1.5,
          depthMm: footprint.depthMm * 1.5,
          heightMm: footprint.heightMm,
        };
  const drawnPlacement =
    area === undefined
      ? {
          xMm: footprint.widthMm * 0.25,
          yMm: footprint.depthMm * 0.25,
          rotation: placement.rotation,
        }
      : {
          ...placement,
          xMm: Number.isFinite(placement.xMm) ? placement.xMm : 0,
          yMm: Number.isFinite(placement.yMm) ? placement.yMm : 0,
        };
  const issue = issueMessage
    ? "blocked"
    : !dimensionsValid || !areaValid || !supportValid
      ? "dimensions"
      : area === undefined
        ? undefined
        : palletPlacementIssue(
            dimensions,
            area,
            placement,
            occupied,
            support,
            unavailable,
          );
  const elevation = Number.isFinite(placement.zMm ?? support?.zMm ?? 0)
    ? (placement.zMm ?? support?.zMm ?? 0)
    : 0;
  const canMove =
    editable &&
    status !== "STORED" &&
    onPlacementChange !== undefined &&
    area !== undefined &&
    dimensionsValid &&
    areaValid &&
    supportValid;
  const point = (x: number, y: number, z = 0) =>
    projectPalletPoint(x, y, z, quarterTurns, planView);
  const corners = (
    x: number,
    y: number,
    width: number,
    depth: number,
    z = 0,
  ) => [
    point(x, y, z),
    point(x + width, y, z),
    point(x + width, y + depth, z),
    point(x, y + depth, z),
  ];
  const validOccupied = occupied.filter(
    (pallet) =>
      validDimensions(pallet) &&
      Number.isFinite(pallet.xMm) &&
      Number.isFinite(pallet.yMm) &&
      Number.isFinite(pallet.zMm ?? 0),
  );
  const source =
    sourceFootprint &&
    validDimensions(sourceFootprint) &&
    [sourceFootprint.xMm, sourceFootprint.yMm, sourceFootprint.zMm ?? 0].every(
      Number.isFinite,
    )
      ? sourceFootprint
      : undefined;
  const cameraHeight = automaticSupports
    ? Math.max(
        surface.heightMm,
        ...automaticSupports.map((s) => s.zMm + footprint.heightMm),
      )
    : elevation + footprint.heightMm;
  const extent = Math.max(
    surface.widthMm,
    surface.depthMm,
    footprint.widthMm,
    footprint.depthMm,
    cameraHeight,
  );
  const allPoints = [
    ...corners(0, 0, surface.widthMm, surface.depthMm),
    // Keep the camera steady while a pallet moves across its supporting surface.
    ...corners(0, 0, surface.widthMm, surface.depthMm, cameraHeight),
    ...corners(
      drawnPlacement.xMm,
      drawnPlacement.yMm,
      footprint.widthMm,
      footprint.depthMm,
    ),
    ...corners(
      drawnPlacement.xMm,
      drawnPlacement.yMm,
      footprint.widthMm,
      footprint.depthMm,
      elevation + footprint.heightMm,
    ),
    ...(source
      ? corners(
          source.xMm,
          source.yMm,
          source.widthMm,
          source.depthMm,
          (source.zMm ?? 0) + source.heightMm,
        )
      : []),
    ...validOccupied.flatMap((pallet) =>
      corners(
        pallet.xMm,
        pallet.yMm,
        pallet.widthMm,
        pallet.depthMm,
        (pallet.zMm ?? 0) + pallet.heightMm,
      ),
    ),
  ];
  const padding = extent * 0.16;
  const fittedViewBox = {
    x: Math.min(...allPoints.map((p) => p.x)) - padding,
    y: Math.min(...allPoints.map((p) => p.y)) - padding,
    width:
      Math.max(...allPoints.map((p) => p.x)) -
      Math.min(...allPoints.map((p) => p.x)) +
      padding * 2,
    height:
      Math.max(...allPoints.map((p) => p.y)) -
      Math.min(...allPoints.map((p) => p.y)) +
      padding * 2,
  };
  // Zoom changes only the SVG camera; getScreenCTM below continues to map
  // pointer coordinates into the same physical placement coordinate system.
  const viewBox = {
    x: fittedViewBox.x + (fittedViewBox.width - fittedViewBox.width / zoom) / 2,
    y:
      fittedViewBox.y +
      (fittedViewBox.height - fittedViewBox.height / zoom) / 2,
    width: fittedViewBox.width / zoom,
    height: fittedViewBox.height / zoom,
  };
  const fontSize = extent * 0.032;
  const clientPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return undefined;
    const p = svg.createSVGPoint();
    p.x = clientX;
    p.y = clientY;
    return p.matrixTransform(matrix.inverse());
  };
  const updatePlacement = (next: PalletPlacement) => {
    if (canMove && area) {
      const constrained = constrainPalletPlacement(
        next,
        dimensions,
        area,
        automaticSupports ? undefined : support,
      );
      const resolved =
        automaticSupports && baseSupport
          ? resolvePalletSupport(
              constrained,
              dimensions,
              baseSupport,
              automaticSupports,
            )
          : undefined;
      onPlacementChange?.(
        resolved ? { ...constrained, zMm: resolved.zMm } : constrained,
      );
    }
  };
  const finishDrag = (pointerId: number) => {
    if (drag.current?.pointerId !== pointerId) return;
    if (svgRef.current?.hasPointerCapture(pointerId))
      svgRef.current.releasePointerCapture(pointerId);
    drag.current = undefined;
  };
  const visibleEdges = [
    {
      indices: [0, 1] as const,
      normal: rotatePalletPoint(0, -1, quarterTurns),
    },
    { indices: [1, 2] as const, normal: rotatePalletPoint(1, 0, quarterTurns) },
    { indices: [2, 3] as const, normal: rotatePalletPoint(0, 1, quarterTurns) },
    {
      indices: [3, 0] as const,
      normal: rotatePalletPoint(-1, 0, quarterTurns),
    },
  ].filter((face) => face.normal.x + face.normal.y > 0);
  const paintBox = (
    x: number,
    y: number,
    width: number,
    depth: number,
    z: number,
    height: number,
    colors: readonly [string, string, string],
    stroke: string,
    dashed = false,
  ) => {
    const bottom = corners(x, y, width, depth, z);
    const top = corners(x, y, width, depth, z + height);
    return (
      <g
        stroke={stroke}
        strokeWidth={1.2}
        strokeDasharray={dashed ? "5 4" : undefined}
      >
        {!planView &&
          visibleEdges.map(({ indices }, index) => (
            <polygon
              key={index}
              vectorEffect="non-scaling-stroke"
              points={pointsAttribute([
                bottom[indices[0]!]!,
                bottom[indices[1]!]!,
                top[indices[1]!]!,
                top[indices[0]!]!,
              ])}
              fill={colors[index % 2]}
            />
          ))}
        <polygon
          vectorEffect="non-scaling-stroke"
          points={pointsAttribute(top)}
          fill={colors[2]}
        />
      </g>
    );
  };
  const bodyBase =
    storageFormat === "BOX" || storageFormat === "OTHER"
      ? 0
      : Math.min(140, footprint.heightMm * 0.12);
  const showStatus = area !== undefined;
  const proposed = showStatus && status === "PROPOSED";
  const reserved = showStatus && status === "RESERVED";
  const stored = showStatus && status === "STORED";
  const sourceStatus = showStatus && status === "SOURCE";
  const selectedLabel = !showStatus
    ? t.incoming
    : sourceStatus
      ? t.sourcePallet
      : stored
        ? t.storedPallet
        : reserved
          ? t.reservedPallet
          : t.proposedPallet;
  const incomingStroke = issue
    ? "#f87171"
    : reserved
      ? "#e5af52"
      : showStatus
        ? "#53c69d"
        : "#7cb8ff";
  const palletColors: readonly [string, string, string] = proposed
    ? ["#197456", "#23916b", "#39b889"]
    : ["#735331", "#926d41", "#aa824c"];
  const cartonColors: readonly [string, string, string] = proposed
    ? ["#197456", "#23916b", "#39b889"]
    : reserved
      ? ["#8e703f", "#aa874d", "#c9a768"]
      : ["#957449", "#b18d5c", "#cfaa77"];
  const center = point(
    drawnPlacement.xMm + footprint.widthMm / 2,
    drawnPlacement.yMm + footprint.depthMm / 2,
    elevation + footprint.heightMm,
  );
  const origin = point(0, 0);
  const rightBottom = corners(
    drawnPlacement.xMm,
    drawnPlacement.yMm,
    footprint.widthMm,
    footprint.depthMm,
    elevation,
  ).reduce((rightmost, candidate) =>
    candidate.x > rightmost.x ? candidate : rightmost,
  );
  const heightGuide = { x: rightBottom.x + padding * 0.35, y: rightBottom.y };
  const line = (
    start: ReturnType<typeof point>,
    end: ReturnType<typeof point>,
    key: string,
    stroke = "#7c8995",
  ) => (
    <line
      key={key}
      x1={start.x}
      y1={start.y}
      x2={end.x}
      y2={end.y}
      stroke={stroke}
      strokeWidth={0.7}
      vectorEffect="non-scaling-stroke"
    />
  );
  const dimensionLine = (
    start: ReturnType<typeof point>,
    end: ReturnType<typeof point>,
    text: string,
  ) => (
    <g>
      {line(start, end, text, "#aab8c5")}
      <text
        x={(start.x + end.x) / 2}
        y={(start.y + end.y) / 2 + fontSize * 1.5}
        textAnchor="middle"
        fill="#d5e1ec"
        fontSize={fontSize}
      >
        {text}
      </text>
    </g>
  );

  return (
    <figure className="min-w-0 overflow-hidden rounded-xl border border-border bg-background">
      <figcaption className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <span className="text-sm font-semibold text-text">
          {label ?? t.title}
        </span>
        <div
          role="group"
          aria-label={t.view}
          className="flex gap-1 rounded-lg border border-border p-1"
        >
          <Button
            type="button"
            variant={planView ? "secondary" : "ghost"}
            size="touch"
            className="px-3"
            aria-pressed={planView}
            onClick={() => setPlanView(true)}
          >
            {t.plan}
          </Button>
          <Button
            type="button"
            variant={!planView ? "secondary" : "ghost"}
            size="touch"
            className="px-3"
            aria-pressed={!planView}
            onClick={() => setPlanView(false)}
          >
            {t.threeD}
          </Button>
        </div>
      </figcaption>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div
          role="group"
          aria-label={t.camera}
          className="flex items-center gap-1"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t.rotateView}
            title={t.rotateView}
            onClick={() => setQuarterTurns((turn) => (turn + 1) % 4)}
          >
            <RotateCw aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t.reset}
            title={t.reset}
            onClick={() => {
              setQuarterTurns(0);
              setPlanView(false);
              setZoom(1);
            }}
          >
            <RotateCcw aria-hidden="true" />
          </Button>
          {canMove && (
            <Button
              type="button"
              variant="outline"
              size="touch"
              className="ml-1 px-2 text-xs"
              onClick={() =>
                updatePlacement({
                  ...placement,
                  rotation: placement.rotation === 0 ? 90 : 0,
                })
              }
            >
              {t.rotatePallet}
            </Button>
          )}
        </div>
        <div
          role="group"
          aria-label={t.zoom}
          className="flex items-center gap-1"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t.zoomOut}
            title={t.zoomOut}
            disabled={zoom === 1}
            onClick={() => setZoom((value) => Math.max(1, value - 0.25))}
          >
            <ZoomOut aria-hidden="true" />
          </Button>
          <output
            aria-label={t.zoom}
            className="min-w-10 text-center text-xs text-muted tabular-nums"
          >
            {Math.round(zoom * 100)}%
          </output>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t.zoomIn}
            title={t.zoomIn}
            disabled={zoom === 2.5}
            onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))}
          >
            <ZoomIn aria-hidden="true" />
          </Button>
        </div>
      </div>
      {source && <p className="px-4 pt-2 text-xs text-muted">{source.label}</p>}
      <svg
        ref={svgRef}
        role="group"
        aria-label={
          showMeasurements
            ? `${label ?? t.title} · ${t.width} ${metres(safeDimensions.widthMm)} · ${t.depth} ${metres(safeDimensions.depthMm)} · ${t.heightLabel} ${metres(safeDimensions.heightMm)}`
            : (label ?? t.title)
        }
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        className="h-72 w-full sm:h-96"
        data-view={planView ? "2d" : "3d"}
        data-camera-rotation={quarterTurns * 90}
        data-camera-zoom={zoom}
        onPointerMove={(event) => {
          const active = drag.current;
          if (!active || active.pointerId !== event.pointerId) return;
          const current = clientPoint(event.clientX, event.clientY);
          if (!current) return;
          const delta = unprojectPalletDelta(
            current.x - active.startX,
            current.y - active.startY,
            quarterTurns,
            planView,
          );
          updatePlacement({
            ...active.placement,
            xMm: active.placement.xMm + delta.x,
            yMm: active.placement.yMm + delta.y,
          });
        }}
        onPointerUp={(event) => finishDrag(event.pointerId)}
        onPointerCancel={(event) => finishDrag(event.pointerId)}
      >
        <polygon
          points={pointsAttribute(
            corners(0, 0, surface.widthMm, surface.depthMm),
          )}
          fill="#14262a"
          stroke="#4b7b89"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        {Array.from({ length: 9 }, (_, index) => {
          const fraction = (index + 1) / 10;
          return (
            <g key={index} opacity={0.25}>
              {line(
                point(surface.widthMm * fraction, 0),
                point(surface.widthMm * fraction, surface.depthMm),
                "x",
              )}
              {line(
                point(0, surface.depthMm * fraction),
                point(surface.widthMm, surface.depthMm * fraction),
                "y",
              )}
            </g>
          );
        })}
        {showMeasurements && area && (
          <g>
            <circle
              cx={origin.x}
              cy={origin.y}
              r={extent * 0.009}
              fill="#e2edf7"
            />
            <text
              x={origin.x}
              y={origin.y - fontSize * 0.65}
              fontSize={fontSize}
              fill="#b8c8d5"
              textAnchor="middle"
            >
              {t.origin} · X 0 / Y 0
            </text>
          </g>
        )}
        {unavailable
          .filter((rectangle) =>
            [
              rectangle.xMm,
              rectangle.yMm,
              rectangle.widthMm,
              rectangle.depthMm,
            ].every(Number.isFinite),
          )
          .map((rectangle, index) => (
            <polygon
              key={rectangle.id ?? index}
              points={pointsAttribute(
                corners(
                  rectangle.xMm,
                  rectangle.yMm,
                  rectangle.widthMm,
                  rectangle.depthMm,
                ),
              )}
              fill="#a84040"
              fillOpacity={0.4}
              stroke="#f87171"
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            >
              <title>
                {locale === "th" ? "พื้นที่ห้ามจัดเก็บ" : "Unavailable area"}
              </title>
            </polygon>
          ))}
        {support &&
          support.zMm > 0 &&
          paintBox(
            support.xMm,
            support.yMm,
            support.widthMm,
            support.depthMm,
            Math.max(0, support.zMm - extent * 0.015),
            Math.min(support.zMm, extent * 0.015),
            ["#4e5b6d", "#62758b", "#8197ac"],
            "#a2b8cd",
          )}
        {source && (
          <g
            role="group"
            aria-label={source.label}
            data-source-footprint="true"
            pointerEvents="none"
          >
            <title>{source.label}</title>
            {paintBox(
              source.xMm,
              source.yMm,
              source.widthMm,
              source.depthMm,
              source.zMm ?? 0,
              source.heightMm,
              ["transparent", "transparent", "transparent"],
              "#b6c2d1",
              true,
            )}
          </g>
        )}
        {validOccupied.map((pallet) => {
          const position = point(
            pallet.xMm + pallet.widthMm / 2,
            pallet.yMm + pallet.depthMm / 2,
            (pallet.zMm ?? 0) + pallet.heightMm,
          );
          const reserved = pallet.status === "RESERVED";
          return (
            <g key={pallet.id} data-occupancy={pallet.status}>
              <title>
                {pallet.label} · {reserved ? t.reserved : t.stored}
              </title>
              {paintBox(
                pallet.xMm,
                pallet.yMm,
                pallet.widthMm,
                pallet.depthMm,
                pallet.zMm ?? 0,
                pallet.heightMm,
                reserved
                  ? ["#54472b", "#685634", "#80653a"]
                  : ["#293646", "#344558", "#425970"],
                reserved ? "#e5af52" : "#8fa5bb",
                reserved,
              )}
              <text
                x={position.x}
                y={position.y}
                textAnchor="middle"
                fontSize={fontSize}
                fill="#ffffff"
              >
                {pallet.label}
              </text>
            </g>
          );
        })}
        <g
          role={canMove ? "button" : "group"}
          tabIndex={canMove ? 0 : undefined}
          aria-label={canMove ? t.move : selectedLabel}
          data-pallet-status={showStatus ? status : undefined}
          aria-describedby={canMove ? hintId : undefined}
          className={
            canMove
              ? "cursor-grab outline-none active:cursor-grabbing focus-visible:[&_polygon]:stroke-white"
              : undefined
          }
          style={canMove ? { touchAction: "none" } : undefined}
          onPointerDown={(event) => {
            if (!canMove || event.button !== 0) return;
            const start = clientPoint(event.clientX, event.clientY);
            if (!start) return;
            event.preventDefault();
            event.currentTarget.focus();
            svgRef.current?.setPointerCapture(event.pointerId);
            drag.current = {
              pointerId: event.pointerId,
              startX: start.x,
              startY: start.y,
              placement,
            };
          }}
          onKeyDown={(event) => {
            if (!canMove) return;
            const movement: Record<string, readonly [number, number]> = {
              ArrowLeft: [-100, 0],
              ArrowRight: [100, 0],
              ArrowUp: [0, -100],
              ArrowDown: [0, 100],
            };
            const delta = movement[event.key];
            if (!delta) return;
            event.preventDefault();
            updatePlacement({
              ...placement,
              xMm: placement.xMm + delta[0],
              yMm: placement.yMm + delta[1],
            });
          }}
        >
          {paintBox(
            drawnPlacement.xMm,
            drawnPlacement.yMm,
            footprint.widthMm,
            footprint.depthMm,
            elevation,
            bodyBase,
            palletColors,
            incomingStroke,
            proposed || reserved,
          )}
          {paintBox(
            drawnPlacement.xMm,
            drawnPlacement.yMm,
            footprint.widthMm,
            footprint.depthMm,
            elevation + bodyBase,
            footprint.heightMm - bodyBase,
            cartonColors,
            incomingStroke,
            proposed || reserved,
          )}
          {!proposed &&
            [1 / 3, 2 / 3].map((fraction) => (
              <g key={fraction} opacity={0.6}>
                {line(
                  point(
                    drawnPlacement.xMm + footprint.widthMm * fraction,
                    drawnPlacement.yMm,
                    elevation + footprint.heightMm,
                  ),
                  point(
                    drawnPlacement.xMm + footprint.widthMm * fraction,
                    drawnPlacement.yMm + footprint.depthMm,
                    elevation + footprint.heightMm,
                  ),
                  "carton-x",
                  "#63482e",
                )}
                {line(
                  point(
                    drawnPlacement.xMm,
                    drawnPlacement.yMm + footprint.depthMm * fraction,
                    elevation + footprint.heightMm,
                  ),
                  point(
                    drawnPlacement.xMm + footprint.widthMm,
                    drawnPlacement.yMm + footprint.depthMm * fraction,
                    elevation + footprint.heightMm,
                  ),
                  "carton-y",
                  "#63482e",
                )}
                {!planView &&
                  visibleEdges.map(({ indices }, faceIndex) => {
                    const band = corners(
                      drawnPlacement.xMm,
                      drawnPlacement.yMm,
                      footprint.widthMm,
                      footprint.depthMm,
                      elevation +
                        bodyBase +
                        (footprint.heightMm - bodyBase) * fraction,
                    );
                    const bottom = corners(
                      drawnPlacement.xMm,
                      drawnPlacement.yMm,
                      footprint.widthMm,
                      footprint.depthMm,
                      elevation + bodyBase,
                    );
                    const top = corners(
                      drawnPlacement.xMm,
                      drawnPlacement.yMm,
                      footprint.widthMm,
                      footprint.depthMm,
                      elevation + footprint.heightMm,
                    );
                    const a = indices[0];
                    const b = indices[1];
                    return (
                      <g key={faceIndex}>
                        {line(band[a]!, band[b]!, "band", "#63482e")}
                        {line(
                          {
                            x:
                              bottom[a]!.x +
                              (bottom[b]!.x - bottom[a]!.x) * fraction,
                            y:
                              bottom[a]!.y +
                              (bottom[b]!.y - bottom[a]!.y) * fraction,
                          },
                          {
                            x: top[a]!.x + (top[b]!.x - top[a]!.x) * fraction,
                            y: top[a]!.y + (top[b]!.y - top[a]!.y) * fraction,
                          },
                          "seam",
                          "#63482e",
                        )}
                      </g>
                    );
                  })}
              </g>
            ))}
          <text
            x={center.x}
            y={center.y - fontSize * 1.2}
            textAnchor="middle"
            fontSize={fontSize}
            fill="#ffffff"
            stroke="#443721"
            strokeWidth={fontSize * 0.06}
            paintOrder="stroke"
          >
            {selectedLabel}
          </text>
        </g>
        {showMeasurements && (
          <>
            {dimensionLine(
              point(
                drawnPlacement.xMm,
                drawnPlacement.yMm + footprint.depthMm + padding * 0.4,
              ),
              point(
                drawnPlacement.xMm + footprint.widthMm,
                drawnPlacement.yMm + footprint.depthMm + padding * 0.4,
              ),
              `${t.width} ${metres(footprint.widthMm)}`,
            )}
            {dimensionLine(
              point(
                drawnPlacement.xMm + footprint.widthMm + padding * 0.4,
                drawnPlacement.yMm,
              ),
              point(
                drawnPlacement.xMm + footprint.widthMm + padding * 0.4,
                drawnPlacement.yMm + footprint.depthMm,
              ),
              `${t.depth} ${metres(footprint.depthMm)}`,
            )}
            {!planView &&
              dimensionLine(
                heightGuide,
                { x: heightGuide.x, y: heightGuide.y - footprint.heightMm },
                `${t.heightLabel} ${metres(footprint.heightMm)}`,
              )}
          </>
        )}
      </svg>
      {(showMeasurements || issue || canMove || validOccupied.length > 0) && (
        <div className="space-y-2 border-t border-border px-4 py-3 text-xs">
          <p
            aria-live="polite"
            className={`flex items-center gap-1.5 ${issue ? "text-destructive" : sourceStatus ? "text-muted" : reserved ? "text-warning" : "text-success"}`}
          >
            {stored && !issue && (
              <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
            )}
            {issue
              ? issue === "blocked"
                ? issueMessage
                : t[issue]
              : area
                ? sourceStatus
                  ? t.sourcePosition
                  : stored
                    ? t.storedPosition
                    : reserved
                      ? t.reservedPosition
                      : t.fits
                : `${t.width} ${metres(dimensions.widthMm)} · ${t.depth} ${metres(dimensions.depthMm)} · ${t.heightLabel} ${metres(dimensions.heightMm)}`}
          </p>
          {showMeasurements && area && (
            <p className="text-muted tabular-nums">
              {t.position}: X {metres(drawnPlacement.xMm)} · Y{" "}
              {metres(drawnPlacement.yMm)} · Z {metres(elevation)} ·{" "}
              {placement.rotation}° <span className="mx-1">/</span> {t.area}:{" "}
              {metres(surface.widthMm)} × {metres(surface.depthMm)} ×{" "}
              {metres(surface.heightMm)}
            </p>
          )}
          {canMove && (
            <p id={hintId} className="text-muted">
              {t.hint}
            </p>
          )}
          {validOccupied.length > 0 && (
            <div className="flex flex-wrap gap-4 text-muted">
              <span>
                <span
                  aria-hidden="true"
                  className="mr-1.5 inline-block size-2 rounded-sm bg-[#8fa5bb]"
                />
                {t.stored}
              </span>
              <span>
                <span
                  aria-hidden="true"
                  className="mr-1.5 inline-block size-2 rounded-sm bg-amber-400"
                />
                {t.reserved}
              </span>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
