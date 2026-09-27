"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FloorMap, type FloorMapProps } from "./FloorMap";

/** All geometry is live database millimetres. No traced reference coordinates. */
export function Fg1MeasuredPlan(props: FloorMapProps) {
  const [view, setView] = useState<"2D" | "3D">("2D");
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(640);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    setWidth(node.clientWidth || 640);
    return () => observer.disconnect();
  }, []);
  const s = (Math.max(1, width - 16) / props.widthMm) * zoom;
  const paintBlocks = props.blocks.filter(
    (b) => b.label !== "พื้นที่รับสินค้าและช่องกลาง",
  );
  return (
    <section
      aria-label="FG1 ผังจากพิกัดฐานข้อมูล"
      className="space-y-4 rounded-2xl border border-border bg-surface p-4 text-text"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            FG1 · ผัง {view} จากพิกัดฐานข้อมูล
          </h2>
          <p className="text-sm text-muted">
            ผังที่อนุมัติ · ทางเดินริมขวา R04–R08 และตำแหน่งจุดสงวนเป็นค่าประมาณ
          </p>
        </div>
        <div className="flex gap-2">
          {(["2D", "3D"] as const).map((v) => (
            <Button
              key={v}
              type="button"
              variant={view === v ? "default" : "outline"}
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {v}
            </Button>
          ))}
        </div>
      </div>
      <div ref={host} className="min-w-0">
        {view === "2D" ? (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                aria-label="ย่อผัง FG1"
                disabled={zoom <= 1}
                onClick={() => setZoom((v) => Math.max(1, v - 0.5))}
              >
                −
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-label="ขยายผัง FG1"
                disabled={zoom >= 3}
                onClick={() => setZoom((v) => Math.min(3, v + 0.5))}
              >
                +
              </Button>
              {props.locationActions}
            </div>
            <div className="overflow-x-auto">
              <svg
                width={props.widthMm * s + 16}
                height={props.depthMm * s + 16}
                viewBox={`0 0 ${props.widthMm * s + 16} ${props.depthMm * s + 16}`}
                role="group"
                aria-label="FG1 2D สเกลเดียวกันทั้งสองแกน"
                className="block"
              >
                <g transform="translate(8 8)">
                  {paintBlocks
                    .filter((b) => b.areaKind === "AISLE")
                    .map((b, i) => (
                      <rect
                        key={i}
                        data-fg1-aisle={b.label}
                        x={b.xMm * s}
                        y={b.yMm * s}
                        width={b.widthMm * s}
                        height={b.depthMm * s}
                        fill={b.color || "#eda576"}
                      />
                    ))}
                  {props.zones.map((z) => {
                    const selected = props.selectedZoneId === z.zoneId;
                    const split = z.widthMm * s < 88;
                    return (
                      <g
                        key={z.zoneId}
                        data-fg1-zone={z.code}
                        role="button"
                        tabIndex={0}
                        aria-label={z.code}
                        aria-pressed={selected}
                        className="cursor-pointer"
                        onClick={() => props.onSelectionChange?.(z.zoneId)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            props.onSelectionChange?.(z.zoneId);
                          }
                        }}
                      >
                        <rect
                          x={z.xMm * s}
                          y={z.yMm * s}
                          width={z.widthMm * s}
                          height={z.depthMm * s}
                          fill="var(--color-success-surface)"
                          stroke={
                            selected
                              ? "var(--color-primary)"
                              : "var(--color-border)"
                          }
                          strokeWidth={selected ? 3 : 1}
                        />
                        <text
                          data-fg1-name={z.code}
                          x={(z.xMm + z.widthMm / 2) * s}
                          y={(z.yMm + z.depthMm / 2) * s}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize={14}
                          fill="var(--color-text)"
                        >
                          {split ? (
                            <>
                              {["FG1-", z.code.slice(4)].map((part, i) => (
                                <tspan
                                  key={part}
                                  x={(z.xMm + z.widthMm / 2) * s}
                                  dy={i === 0 ? "-.55em" : "1.1em"}
                                >
                                  {part}
                                </tspan>
                              ))}
                            </>
                          ) : (
                            z.code
                          )}
                        </text>
                      </g>
                    );
                  })}
                  {paintBlocks
                    .filter((b) => b.areaKind !== "AISLE")
                    .map((b, i) => (
                      <g key={i} aria-label={b.label}>
                        <rect
                          x={b.xMm * s}
                          y={b.yMm * s}
                          width={b.widthMm * s}
                          height={b.depthMm * s}
                          fill={b.color || "#e8cc69"}
                          stroke="var(--color-border)"
                        />
                        {b.label === "ห้ามจัดเก็บระหว่าง L01–L02" && (
                          <path
                            d={`M ${b.xMm * s} ${b.yMm * s} l ${b.widthMm * s} ${b.depthMm * s} M ${(b.xMm + b.widthMm) * s} ${b.yMm * s} l ${-b.widthMm * s} ${b.depthMm * s}`}
                            stroke="var(--color-text)"
                            fill="none"
                          />
                        )}
                      </g>
                    ))}
                </g>
              </svg>
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <span>เขียว: ช่องจัดเก็บ</span>
              <span>ส้ม: ทางเดิน</span>
              <span>เหลือง: ห้ามจัดเก็บ</span>
              <span>แดง: จุดสงวน</span>
            </div>
            {props.locationInspector}
          </>
        ) : (
          <FloorMap {...props} initialView="3d" />
        )}
      </div>
    </section>
  );
}
