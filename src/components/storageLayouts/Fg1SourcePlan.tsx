"use client";

import { Button } from "@/components/ui/button";

// Display units traced from the approved 2026-09-27 reference. NOT millimetres.
// Never use these coordinates for imports, floor bounds, or capacity calculations.
export const fg1SourceAreas = [
  ["L01", 0, 78, 225, 266],
  ["L02", 0, 514, 230, 260],
  ["L03", 0, 898, 230, 347],
  ["L04", 0, 1270, 230, 63],
  ["L05", 0, 1355, 230, 53],
  ["R01", 375, 0, 436, 94],
  ["R02", 375, 122, 436, 170],
  ["R03", 375, 313, 436, 190],
  ["R04", 375, 527, 436, 66],
  ["R05", 375, 621, 454, 143],
  ["R06", 375, 790, 454, 135],
  ["R07", 375, 950, 454, 130],
  ["R08", 375, 1105, 454, 124],
  ["R09", 375, 1255, 466, 75],
  ["R10", 375, 1355, 466, 53],
] as const;

const colors = {
  storage: "var(--color-success-surface)",
  text: "var(--color-text)",
  aisle: "#eda576",
  aisleText: "#352315",
  yellow: "#d4aa27",
  red: "#cb7c7c",
  background: "var(--color-surface)",
};

export function Fg1SourcePlan({
  areas,
  selected,
  onSelect,
  onShow3D,
  live,
  smallExclusionSaved,
}: {
  readonly areas: readonly { readonly id: string; readonly size: string }[];
  readonly selected: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly onShow3D: () => void;
  readonly live: boolean;
  readonly smallExclusionSaved: boolean;
}) {
  const visible = fg1SourceAreas.filter(([id]) =>
    areas.some((area) => area.id === id),
  );
  const aisles = fg1SourceAreas.slice(5, 14).map((area, i) => {
    const next = fg1SourceAreas[i + 6]!;
    return [
      area[1],
      area[2] + area[4],
      Math.max(area[3], next[3]),
      next[2] - area[2] - area[4],
    ];
  });
  aisles.push([0, 1245, 230, 25], [0, 1333, 230, 22]);
  return (
    <section
      aria-label="ผังสรุป FG1 ตามแบบอ้างอิง"
      data-fg1-source-revision="2026-09-27"
      className="space-y-4 rounded-2xl border border-border bg-surface p-4 text-text sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">FG1 · 2D จัดวางตามต้นฉบับ</h2>
          <p className="mt-1 text-sm text-muted">
            ขนาดกำกับเป็นเมตร · ภาพอ้างอิง ไม่ใช่มาตราส่วนจริง
          </p>
          <p className="mt-1 text-sm text-muted">
            {live
              ? "ชื่อและขนาดช่องอ่านจากฐานข้อมูล · พิกัดอาคารยังรอตรวจยืนยัน"
              : "ภาพสำหรับตรวจสอบการจัดวาง"}
          </p>
        </div>
        <div className="flex gap-2" aria-label="มุมมอง FG1">
          <Button type="button" aria-label="แสดง 2D" aria-pressed>
            2D
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-label="แสดง 3D"
            aria-pressed={false}
            onClick={onShow3D}
          >
            3D
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox="-8 -8 857 1424"
          role="group"
          aria-label="FG1 ผังอ้างอิง 2D"
          className="mx-auto block w-full max-w-[640px] min-w-[520px]"
        >
          <desc>
            ผังอ้างอิง 15 ช่อง R01 อยู่บนสุด R10 และ L05 จบเสมอกัน
            ไม่มีพื้นที่ว่างเพิ่มด้านบนหรือล่าง ภาพนี้ไม่ใช่พิกัดฐานข้อมูล
          </desc>
          {aisles.map(([x, y, w, h], i) => (
            <g key={i} data-source-aisle="0.30">
              <rect x={x} y={y} width={w} height={h} fill={colors.aisle} />
              <text
                x={x! + w! / 2}
                y={y! + h! / 2 + 6}
                textAnchor="middle"
                fontSize={18}
                fill={colors.aisleText}
              >
                0.30 ม.
              </text>
            </g>
          ))}
          {visible.map(([id, x, y, w, h]) => {
            const size = areas.find((area) => area.id === id)!.size;
            return (
              <g
                key={id}
                data-reference-zone={id}
                role="button"
                tabIndex={0}
                aria-label={`FG1-${id} ${size} เมตร`}
                aria-pressed={selected === id}
                onClick={() => onSelect(id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(id);
                  }
                }}
                className="cursor-pointer"
              >
                <title>{`FG1-${id} · ${size} ม.`}</title>
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill={colors.storage}
                  stroke={
                    selected === id ? "var(--color-primary)" : colors.text
                  }
                  strokeWidth={selected === id ? 4 : 1.5}
                />
                <text
                  x={x + w / 2}
                  y={y + h / 2 - 4}
                  textAnchor="middle"
                  fontSize={20}
                  fontWeight={600}
                  fill={colors.text}
                >{`FG1-${id}`}</text>
                <text
                  x={x + w / 2}
                  y={y + h / 2 + 18}
                  textAnchor="middle"
                  fontSize={19}
                  fill={colors.text}
                >
                  {size} ม.
                </text>
              </g>
            );
          })}
          <g data-reference-obstruction="cross">
            <rect
              x={0}
              y={344}
              width={225}
              height={170}
              fill={colors.background}
              stroke={colors.yellow}
              strokeWidth={2}
            />
            <path
              d="M0 344 L225 514 M225 344 L0 514"
              stroke={colors.yellow}
              strokeWidth={3}
            />
            <rect
              x={15}
              y={392}
              width={195}
              height={72}
              fill={colors.background}
            />
            <text
              x={112.5}
              y={415}
              textAnchor="middle"
              fontSize={20}
              fill={colors.text}
            >
              ห้ามจัดเก็บ
            </text>
            <text
              x={112.5}
              y={443}
              textAnchor="middle"
              fontSize={19}
              fill={colors.text}
            >
              2.87 × 1.60 ม.
            </text>
          </g>
          <g data-reference-obstruction="small">
            <title>
              พื้นที่กันไว้ใน L02 · 1.20 × 0.65 ม. · สูง 0.75 ม. ตามต้นฉบับ
            </title>
            <rect
              x={14}
              y={690}
              width={120}
              height={48}
              fill={colors.red}
              stroke={colors.text}
              strokeWidth={1.5}
            />
          </g>
          <text
            x={302}
            y={704}
            transform="rotate(-90 302 704)"
            textAnchor="middle"
            fontSize={22}
            fill={colors.text}
          >
            พื้นที่รับสินค้า
          </text>
        </svg>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <span>จุดจัดเก็บ {visible.length} ช่อง</span>
        <span>
          <i
            className="mr-2 inline-block size-3"
            style={{ background: colors.aisle }}
          />
          ทางเดิน 0.30 ม.
        </span>
        <span>
          <i
            className="mr-2 inline-block size-3"
            style={{ background: colors.yellow }}
          />
          ห้ามจัดเก็บ
        </span>
        <span>
          <i
            className="mr-2 inline-block size-3"
            style={{ background: colors.red }}
          />
          1.20 × 0.65 m
        </span>
      </div>
      {live && (
        <p className="text-sm text-muted">
          {smallExclusionSaved
            ? "จุด 1.20 × 0.65 ม. กันพื้นที่ในฐานข้อมูลแล้ว"
            : "ยังไม่หักพื้นที่จุดนี้ในฐานข้อมูล"}
        </p>
      )}
      {selected && (
        <p className="text-sm" aria-live="polite">
          เลือก: FG1-{selected}
        </p>
      )}
    </section>
  );
}
