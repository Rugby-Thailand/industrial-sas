"use client";

import { useState } from "react";
import type { StorageZoneRow } from "@/lib/convex/storageLayoutApi";

// Presentation coordinates from the user's approved reference, NOT millimetres.
// This schematic must never be used as an import/geometry or capacity source.
const areas = [
  ["L01", 55, 40, 250, 170, "2.87 × 4.82", 95],
  ["L02", 55, 340, 255, 175, "2.87 × 5.86", 95],
  ["L03", 55, 590, 255, 265, "2.87 × 12.40", 95],
  ["L04", 55, 870, 255, 58, "2.87 × 1.70", 55],
  ["L05", 55, 943, 255, 47, "2.87 × 1.45", 45],
  ["R01", 500, 25, 445, 65, "7.26 × 1.65", 55],
  ["R02", 500, 105, 445, 115, "7.26 × 3.00", 95],
  ["R03", 500, 235, 445, 115, "7.26 × 3.00", 95],
  ["R04", 500, 365, 460, 55, "7.26 × 1.60", 55],
  ["R05", 500, 435, 460, 105, "7.35 × 3.00", 95],
  ["R06", 500, 555, 460, 100, "7.35 × 2.90", 95],
  ["R07", 500, 670, 460, 100, "7.35 × 2.90", 95],
  ["R08", 500, 785, 460, 100, "7.35 × 2.90", 95],
  ["R09", 500, 900, 490, 42, "7.84 × 1.70", 45],
  ["R10", 500, 957, 490, 33, "7.84 × 1.50", 40],
] as const;
const palette = {
  bg: "#05080c",
  surface: "#0a0f15",
  grid: "#263440",
  boundary: "#9db6ca",
  green: "#4ce0a0",
  fill: "#123529",
  orange: "#f4a45d",
  red: "#ff6b71",
  text: "#f7f9fc",
  muted: "#9aa6b6",
};
type Point = [number, number];
const iso = (x: number, y: number, z = 0): Point => [
  900 + (x - y) * 0.866 * 0.66,
  300 + (x + y) * 0.5 * 0.66 - z * 0.66,
];
const points = (p: Point[]) => p.map((v) => v.join(",")).join(" ");
const box = (x: number, y: number, w: number, d: number, z = 0) => [
  iso(x, y, z),
  iso(x + w, y, z),
  iso(x + w, y + d, z),
  iso(x, y + d, z),
];

export function matchesFg1Reference(
  buildingId: string | undefined,
  floorNumber: number,
  zones: readonly StorageZoneRow[],
) {
  return (
    buildingId === "n57effrz60rbq7fqx438q6r6fx8f0hed" &&
    floorNumber === 1 &&
    zones.length === areas.length &&
    areas.every(
      ([id]) => zones.filter((zone) => zone.code === `FG1-${id}`).length === 1,
    )
  );
}

/** Approved schematic presentation; drawing coordinates never update geometry. */
export function Fg1ReferencePreview({
  zones,
  selectedZoneId,
  onSelectionChange,
}: {
  readonly zones?: readonly StorageZoneRow[];
  readonly selectedZoneId?: string | undefined;
  readonly onSelectionChange?: ((zoneId: string) => void) | undefined;
} = {}) {
  const [view, setView] = useState<"2D" | "3D">("2D");
  const [localSelected, setLocalSelected] = useState<string>();
  const selected = onSelectionChange
    ? zones
        ?.find((zone) => zone.zoneId === selectedZoneId)
        ?.code.replace(/^FG1-/, "")
    : localSelected;
  const select = (id: string) => {
    setLocalSelected(id);
    const zone = zones?.find((candidate) => candidate.code === `FG1-${id}`);
    if (zone) onSelectionChange?.(zone.zoneId);
  };
  // Live dimensions come from Convex, not from reference-image literals.
  const displayedAreas = areas.flatMap(([id, x, y, w, d, size, z]) => {
    const zone = zones?.find((candidate) => candidate.code === `FG1-${id}`);
    if (zones && !zone) return [];
    const liveSize = zone
      ? `${(zone.widthMm / 1000).toFixed(2)} × ${(zone.depthMm / 1000).toFixed(2)}`
      : size;
    return [[id, x, y, w, d, liveSize, z] as const];
  });
  const floor = box(0, 0, 1000, 1000);
  return (
    <section
      aria-label="ผังสรุป FG1 ตามแบบอ้างอิง"
      style={{
        background: palette.bg,
        color: palette.text,
        fontFamily: "Tahoma, sans-serif",
        overflowX: "auto",
      }}
    >
      <svg
        viewBox="0 0 2048 1152"
        style={{ width: "100%", minWidth: 980, display: "block" }}
        aria-label={`FG1 ผังอ้างอิง ${view}`}
      >
        <text x={84} y={101} fontSize={32} fontWeight={700} fill={palette.text}>
          ชั้น 1 · อาคาร FG1
        </text>
        <text x={84} y={136} fontSize={21} fill={palette.muted}>
          {view === "2D"
            ? "ผังสรุปตามภาพอ้างอิง · ขนาดกำกับเป็นเมตร · ไม่ใช่มาตราส่วนจริง"
            : "มุมมอง 3D จากผังเดียวกับ 2D · ความสูงเป็นค่าจำลองเพื่อดูรูปทรง"}
        </text>
        <rect
          x={1392}
          y={65}
          width={235}
          height={43}
          rx={18}
          fill="#261b0e"
          stroke="#8a5c18"
        />
        <text x={1509} y={92} textAnchor="middle" fontSize={16} fill="#ffc66d">
          {zones ? "ผังสรุป · ข้อมูลจากระบบ" : "รอตรวจสอบ · แบบปรับใหม่"}
        </text>
        <rect
          x={1660}
          y={48}
          width={298}
          height={78}
          rx={18}
          fill="#101720"
          stroke="#27313d"
          strokeWidth={2}
        />
        {(["2D", "3D"] as const).map((v, i) => (
          <g
            key={v}
            role="button"
            tabIndex={0}
            aria-label={`แสดง ${v}`}
            aria-pressed={view === v}
            onClick={() => setView(v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setView(v);
              }
            }}
            style={{ cursor: "pointer" }}
          >
            <rect
              x={1668 + i * 143}
              y={56}
              width={137}
              height={62}
              rx={14}
              fill={view === v ? "#343b45" : "#101720"}
            />
            <text
              x={1736 + i * 143}
              y={99}
              textAnchor="middle"
              fontSize={25}
              fontWeight={view === v ? 700 : 400}
              fill={view === v ? "#8db8ff" : palette.muted}
            >
              {v}
            </text>
          </g>
        ))}
        <rect
          x={54}
          y={156}
          width={1940}
          height={892}
          rx={28}
          fill={palette.surface}
          stroke="#27313d"
          strokeWidth={2}
        />
        {view === "2D" ? (
          <>
            <rect
              x={170}
              y={198}
              width={1250}
              height={790}
              fill="#0b1218"
              stroke={palette.boundary}
              strokeWidth={3}
            />
            {Array.from({ length: 19 }, (_, i) => (
              <g key={i} stroke={palette.grid}>
                <path
                  d={`M ${170 + (i + 1) * 62.5} 198 V 988 M 170 ${198 + (i + 1) * 39.5} H 1420`}
                />
              </g>
            ))}
            <rect
              x={582.5}
              y={198}
              width={168.75}
              height={790}
              fill="#392318"
            />
            <text
              x={666}
              y={238}
              textAnchor="middle"
              fontSize={17}
              fill={palette.orange}
            >
              ทางเดินกลาง
            </text>
            {[90, 220, 350, 420, 540, 655, 770, 885, 942].map((y) => (
              <rect
                key={y}
                x={795}
                y={198 + y * 0.79}
                width={612.5}
                height={7.11}
                fill={palette.orange}
              />
            ))}
            {displayedAreas.map(([id, x, y, w, d, size]) => {
              const left = 170 + x * 1.25,
                top = 198 + y * 0.79,
                width = w * 1.25,
                height = d * 0.79,
                cx = left + width / 2,
                cy = top + height / 2;
              return (
                <g
                  key={id}
                  role="button"
                  tabIndex={0}
                  aria-label={`FG1-${id} ${size} เมตร`}
                  aria-pressed={selected === id}
                  data-reference-zone={id}
                  onClick={() => select(id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      select(id);
                    }
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <title>{`FG1-${id} · ${size} m`}</title>
                  <rect
                    x={left}
                    y={top}
                    width={width}
                    height={height}
                    fill={palette.fill}
                    stroke={selected === id ? "#8db8ff" : palette.green}
                    strokeWidth={3}
                  />
                  {height < 56 ? (
                    <text
                      x={cx}
                      y={cy + 4}
                      fontSize={12}
                      fontWeight={700}
                      textAnchor="middle"
                      fill={palette.text}
                    >{`FG1-${id} · ${size} m`}</text>
                  ) : (
                    <>
                      <text
                        x={cx}
                        y={cy - 5 - (id === "L02" ? 12 : 0)}
                        fontSize={17}
                        fontWeight={700}
                        textAnchor="middle"
                        fill={palette.text}
                      >{`FG1-${id}`}</text>
                      <text
                        x={cx}
                        y={cy + 23 - (id === "L02" ? 12 : 0)}
                        fontSize={14}
                        textAnchor="middle"
                        fill={palette.muted}
                      >
                        {size} m
                      </text>
                    </>
                  )}
                </g>
              );
            })}
            <g data-reference-obstruction="cross" fill={palette.red}>
              <rect
                x={238.75}
                y={363.9}
                width={312.5}
                height={94.8}
                fill="#241315"
                stroke={palette.red}
                strokeWidth={3}
              />
              <path
                d="M238.75 363.9 L551.25 458.7 M551.25 363.9 L238.75 458.7"
                stroke={palette.red}
                strokeWidth={2}
              />
              <text
                x={395}
                y={416}
                fontSize={15}
                fontWeight={700}
                textAnchor="middle"
              >
                ห้ามจัดเก็บ · 2.87 × 1.60 m
              </text>
            </g>
            <g data-reference-obstruction="small">
              <rect
                x={251.25}
                y={555.08}
                width={131.25}
                height={35.55}
                fill="#3b191b"
                stroke={palette.red}
                strokeWidth={2}
              />
              <text
                x={317}
                y={578}
                textAnchor="middle"
                fontSize={12}
                fill={palette.red}
              >
                1.20 × 0.65 m
              </text>
            </g>
            <text
              x={1500}
              y={250}
              fontSize={25}
              fontWeight={700}
              fill={palette.text}
            >
              {zones ? "ข้อมูลอาคาร" : "ข้อมูลสำหรับตรวจสอบ"}
            </text>
            {[
              ["อาคาร", "FG1"],
              ["จำนวนชั้น", "1"],
              ["จุดจัดเก็บ", `${displayedAreas.length} Locations`],
              ["ฝั่งซ้าย", "FG1-L01 - FG1-L05"],
              ["ฝั่งขวา", "FG1-R01 - FG1-R10"],
              ["ความสูงอาคาร", "ยังไม่มีใน PDF"],
            ].map(([k, v], i) => (
              <g key={k}>
                <path d={`M1500 ${330 + i * 74} H1908`} stroke="#27313d" />
                <text
                  x={1500}
                  y={302 + i * 74}
                  fontSize={17}
                  fill={palette.muted}
                >
                  {k}
                </text>
                <text
                  x={1908}
                  y={302 + i * 74}
                  textAnchor="end"
                  fontSize={19}
                  fontWeight={700}
                  fill={palette.text}
                >
                  {v}
                </text>
              </g>
            ))}
            <text
              x={1500}
              y={776}
              fontSize={19}
              fontWeight={700}
              fill={palette.orange}
            >
              หมายเหตุ
            </text>
            <text x={1500} y={816} fontSize={17} fill={palette.muted}>
              รูปแบบตามภาพอ้างอิง ไม่ใช่มาตราส่วนจริง
            </text>
            <text x={1500} y={850} fontSize={17} fill={palette.muted}>
              {zones
                ? "ชื่อและขนาดจุดจัดเก็บอ่านจากฐานข้อมูล"
                : "รหัส L/R บันทึกในฐานข้อมูลแล้ว"}
            </text>
            <text x={1500} y={884} fontSize={17} fill={palette.muted}>
              {zones
                ? "จุด 1.20 × 0.65 ม. เป็นข้อมูลอ้างอิง"
                : "ตัวอย่างนี้ไม่เปลี่ยนพิกัดหรือข้อมูลในระบบ"}
            </text>
            {zones && (
              <text x={1500} y={916} fontSize={17} fill={palette.orange}>
                ยังไม่หักพื้นที่จุดนี้ในฐานข้อมูล
              </text>
            )}
            {selected && (
              <text x={1500} y={950} fontSize={19} fill="#8db8ff">
                เลือก: FG1-{selected}
              </text>
            )}
          </>
        ) : (
          <>
            <polygon
              points={points([
                floor[2]!,
                floor[3]!,
                [floor[3]![0], floor[3]![1] + 16],
                [floor[2]![0], floor[2]![1] + 16],
              ])}
              fill="#17242e"
              stroke={palette.boundary}
            />
            <polygon
              points={points([
                floor[1]!,
                floor[2]!,
                [floor[2]![0], floor[2]![1] + 16],
                [floor[1]![0], floor[1]![1] + 16],
              ])}
              fill="#111b23"
              stroke={palette.boundary}
            />
            <polygon
              points={points(floor)}
              fill="#0d171e"
              stroke={palette.boundary}
              strokeWidth={3}
            />
            {Array.from({ length: 19 }, (_, i) => (
              <g key={i} stroke={palette.grid}>
                <polyline
                  points={points([
                    iso((i + 1) * 50, 0),
                    iso((i + 1) * 50, 1000),
                  ])}
                />
                <polyline
                  points={points([
                    iso(0, (i + 1) * 50),
                    iso(1000, (i + 1) * 50),
                  ])}
                />
              </g>
            ))}
            <polygon
              data-reference-obstruction="cross"
              points={points(box(55, 210, 250, 120, 2))}
              fill="#2a1518"
              stroke={palette.red}
              strokeWidth={3}
            />
            <polyline
              points={points([iso(55, 210, 2), iso(305, 330, 2)])}
              stroke={palette.red}
            />
            <polyline
              points={points([iso(305, 210, 2), iso(55, 330, 2)])}
              stroke={palette.red}
            />
            {[...displayedAreas]
              .sort((a, b) => a[1] + a[2] - b[1] - b[2])
              .map(([id, x, y, w, d, size, z]) => {
                const b = box(x, y, w, d),
                  t = box(x, y, w, d, z),
                  c = iso(x + w / 2, y + d / 2, z + 5);
                return (
                  <g
                    key={id}
                    data-reference-zone={id}
                    role="button"
                    aria-label={`FG1-${id} ${size} เมตร`}
                    aria-pressed={selected === id}
                    tabIndex={0}
                    onClick={() => select(id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        select(id);
                      }
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <title>{`FG1-${id} · ${size} m · ความสูงจำลอง`}</title>
                    <g
                      stroke={selected === id ? "#8db8ff" : palette.green}
                      strokeWidth={2}
                    >
                      <polygon
                        points={points([b[1]!, b[2]!, t[2]!, t[1]!])}
                        fill="#102c25"
                      />
                      <polygon
                        points={points([b[2]!, b[3]!, t[3]!, t[2]!])}
                        fill="#0e241e"
                      />
                      <polygon
                        points={points(t)}
                        fill="#153d31"
                        strokeWidth={3}
                      />
                      {b.map((p, i) => (
                        <polyline key={i} points={points([p, t[i]!])} />
                      ))}
                    </g>
                    {d >= 75 && (
                      <text
                        x={c[0]}
                        y={c[1] + 5}
                        textAnchor="middle"
                        fontSize={14}
                        fontWeight={700}
                        fill={palette.text}
                      >{`FG1-${id}`}</text>
                    )}
                  </g>
                );
              })}
            <text
              x={104}
              y={965}
              fontSize={24}
              fontWeight={700}
              fill={palette.text}
            >
              FG1 · {displayedAreas.length} จุดจัดเก็บ
            </text>
            <text x={104} y={997} fontSize={18} fill={palette.muted}>
              ผังสรุปตามภาพอ้างอิงของโซนที่เลือกจาก PDF หน้า 3
            </text>
            <text
              x={1518}
              y={958}
              fontSize={17}
              fontWeight={700}
              fill={palette.orange}
            >
              ความสูงกล่อง 3D: ค่าจำลอง
            </text>
            <text x={1518} y={997} fontSize={17} fill={palette.muted}>
              ไม่ใช้คำนวณความจุหรือความสูงจัดเก็บจริง
            </text>
          </>
        )}
        {[
          [palette.green, "จุดจัดเก็บ"],
          [palette.orange, "ทางเดิน 0.30 ม."],
          [palette.red, "พื้นที่ห้ามจัดเก็บ"],
          [palette.boundary, "ขอบเขต FG1"],
        ].map(([color, label], i) => (
          <g key={label}>
            <rect
              x={104 + i * 270}
              y={1075}
              width={22}
              height={22}
              fill={color}
            />
            <text x={138 + i * 270} y={1093} fontSize={18} fill={palette.muted}>
              {label}
            </text>
          </g>
        ))}
      </svg>
    </section>
  );
}
