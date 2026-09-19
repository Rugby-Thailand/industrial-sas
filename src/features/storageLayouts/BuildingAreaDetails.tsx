"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { useLocale } from "next-intl";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SelectControl } from "@/components/ui/SelectControl";
import { sceneColors } from "@/components/storageScene/sceneColors";
import {
  storageLayoutRefs,
  type StorageBuildingRow,
  type StorageBuildingDetail,
} from "@/lib/convex/storageLayoutApi";
import { storageFootprintUsage } from "../../../convex/model/storageLayout/areaUsage";
import { AreaOverview } from "./AreaOverview";

export function BuildingAreaDetails({
  building,
}: {
  readonly building: StorageBuildingRow;
}) {
  const [open, setOpen] = useState(false);
  const locale = useLocale();
  const th = locale === "th";
  const result = useQuery(
    storageLayoutRefs.get,
    open
      ? { warehouseId: building.warehouseId, buildingId: building.buildingId }
      : "skip",
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="relative z-10 w-full rounded-lg text-left outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={`${th ? "ดูรายละเอียดพื้นที่" : "View space details"} · ${building.name}`}
        >
          <AreaOverview {...building} />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl" closeLabel={th ? "ปิด" : "Close"}>
        <DialogHeader>
          <DialogTitle>
            {th ? "รายละเอียดพื้นที่" : "Space breakdown"} · {building.name}
          </DialogTitle>
          <DialogDescription>
            {th
              ? "สัดส่วนพื้นที่และสินค้าที่จัดเก็บ แยกตามชั้นและจุดจัดเก็บ"
              : "Floor space and inventory by floor and storage area"}
          </DialogDescription>
        </DialogHeader>
        {result === undefined ? (
          <p role="status">{th ? "กำลังโหลด…" : "Loading…"}</p>
        ) : !result.ok ? (
          <p role="alert">
            {th
              ? "โหลดรายละเอียดไม่สำเร็จ กรุณาลองใหม่"
              : "Unable to load details. Please try again."}
          </p>
        ) : !result.value.found ? (
          <p>{th ? "ไม่พบอาคาร" : "Building not found"}</p>
        ) : (
          <BuildingUsageContent detail={result.value} />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function BuildingUsageContent({
  detail,
}: {
  readonly detail: Extract<StorageBuildingDetail, { found: true }>;
}) {
  const locale = useLocale();
  const th = locale === "th";
  const [filter, setFilter] = useState("ALL");
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const area = (n: number) =>
    `${format.format(n / 1_000_000)} ${th ? "ตร.ม." : "m²"}`;
  const { building, floors } = detail;
  const usage = storageFootprintUsage(floors.flatMap((f) => f.storageZones));
  const gross = Math.max(0, building.grossAreaSqMm);
  const usable = Math.max(0, Math.min(gross, building.usableAreaSqMm));
  const stored = Math.min(usable, usage.storedFootprintAreaSqMm);
  const reserved = Math.min(usable - stored, usage.heldFootprintAreaSqMm);
  const segments = [
    {
      label: th ? "ว่าง" : "Free",
      value: usable - stored - reserved,
      color: sceneColors.free,
    },
    {
      label: th ? "จัดเก็บแล้ว" : "Stored",
      value: stored,
      color: sceneColors.stored,
    },
    {
      label: th ? "จองแล้ว" : "Reserved",
      value: reserved,
      color: sceneColors.reserved,
    },
    {
      label: th ? "ใช้งานไม่ได้" : "Unavailable",
      value: gross - usable,
      color: sceneColors.unavailable,
    },
  ];
  const description = segments
    .map((s) => `${s.label} ${area(s.value)}`)
    .join(" · ");
  let angle = -Math.PI / 2;
  const rows = floors.flatMap((floor) =>
    floor.storageZones.flatMap((zone) =>
      zone.placements.map((placement) => ({ floor, zone, placement })),
    ),
  );
  const visible = rows.filter(
    (row) => filter === "ALL" || (row.placement.status ?? "STORED") === filter,
  );
  return (
    <div className="min-w-0 space-y-5">
      <div className="grid items-center gap-5 sm:grid-cols-[200px_1fr]">
        <svg
          viewBox="0 0 200 200"
          role="img"
          aria-label={description}
          className="mx-auto size-48 max-w-full"
        >
          <circle cx="100" cy="100" r="96" fill={sceneColors.unavailable} />
          {segments
            .filter((s) => s.value > 0)
            .map((s) => {
              const span = gross > 0 ? (s.value / gross) * Math.PI * 2 : 0;
              const start = angle;
              angle += span;
              if (span >= Math.PI * 2 - 1e-9)
                return (
                  <circle
                    key={s.label}
                    cx="100"
                    cy="100"
                    r="96"
                    fill={s.color}
                  />
                );
              const d = `M 100 100 L ${100 + 96 * Math.cos(start)} ${100 + 96 * Math.sin(start)} A 96 96 0 ${span > Math.PI ? 1 : 0} 1 ${100 + 96 * Math.cos(angle)} ${100 + 96 * Math.sin(angle)} Z`;
              return (
                <path
                  key={s.label}
                  d={d}
                  fill={s.color}
                  stroke="var(--color-popover)"
                  strokeWidth="1"
                />
              );
            })}
        </svg>
        <dl className="space-y-3 text-sm">
          {segments.map((s) => (
            <div
              key={s.label}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <dt className="flex items-center gap-2">
                <span
                  className="size-3 rounded-sm"
                  style={{ backgroundColor: s.color }}
                />
                {s.label}
              </dt>
              <dd className="tabular-nums">
                {area(s.value)} ·{" "}
                {format.format(gross > 0 ? (s.value / gross) * 100 : 0)}%
              </dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-border pt-3 font-semibold">
            <dt>{th ? "พื้นที่รวม" : "Total area"}</dt>
            <dd>{area(gross)}</dd>
          </div>
        </dl>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        {th
          ? "คำนวณจากพื้นที่ฐาน พาเลตที่ซ้อนกันนับพื้นที่เพียงครั้งเดียว การย้ายที่ยังไม่เสร็จจะกันพื้นที่ทั้งต้นทางและปลายทาง"
          : "Calculated from floor footprints; stacked pallets count once. Pending moves hold space at both source and destination."}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">
          {th ? "สินค้าและตำแหน่งจัดเก็บ" : "Inventory and locations"} (
          {visible.length})
        </h3>
        <div className="flex items-center gap-2 text-sm">
          <span>{th ? "สถานะ" : "Status"}</span>
          <SelectControl
            label={th ? "สถานะ" : "Status"}
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: "ALL", label: th ? "ทั้งหมด" : "All" },
              { value: "STORED", label: th ? "จัดเก็บแล้ว" : "Stored" },
              { value: "RESERVED", label: th ? "จองแล้ว" : "Reserved" },
            ]}
            placeholder={th ? "ทั้งหมด" : "All"}
            emptyLabel={th ? "ไม่มีสถานะให้เลือก" : "No statuses available"}
            className="w-36"
          />
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="rounded-lg border border-border p-4 text-sm text-muted">
          {th ? "ไม่มีรายการสินค้าในสถานะนี้" : "No inventory in this status"}
        </p>
      ) : (
        <div className="max-h-80 overflow-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              {th
                ? "สินค้าแยกตามชั้นและจุดจัดเก็บ"
                : "Inventory by floor and storage area"}
            </caption>
            <thead className="sticky top-0 bg-popover">
              <tr>
                {[
                  th ? "สินค้า / พาเลต" : "Product / pallet",
                  th ? "จัดเก็บที่" : "Location",
                  th ? "วิธีวาง / สถานะ" : "Placement / status",
                ].map((label) => (
                  <th key={label} scope="col" className="p-3">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ floor, zone, placement: p }) => (
                <tr
                  key={p.placementId}
                  className="border-t border-border align-top"
                >
                  <td className="min-w-40 p-3">
                    <Link
                      className="text-accent underline"
                      href={`/${locale}/finished-goods/pallets/${p.handlingUnitId}`}
                    >
                      {p.lpn}
                    </Link>
                    <p className="mt-1">
                      {p.productName ??
                        (th ? "ไม่พบข้อมูลสินค้า" : "Product unavailable")}
                    </p>
                    <p className="text-xs text-muted">
                      {p.productSku}
                      {p.quantity !== undefined
                        ? ` · ${format.format(p.quantity)} ${p.unit ?? ""}`
                        : ""}
                    </p>
                  </td>
                  <td className="min-w-40 p-3">
                    <Link
                      className="text-accent underline"
                      href={`/${locale}/master-data/storage-layouts/${building.buildingId}/floors/${floor.floorNumber}`}
                    >
                      {th ? "ชั้น" : "Floor"} {floor.floorNumber} · {zone.label}
                    </Link>
                    <p className="mt-1 text-xs text-muted">
                      {zone.code} · {p.positionCode ?? "—"}
                    </p>
                    <p className="text-xs text-muted">
                      X {format.format((p.xMm ?? 0) / 1000)} · Y{" "}
                      {format.format((p.yMm ?? 0) / 1000)} m
                    </p>
                  </td>
                  <td className="min-w-36 p-3">
                    <p className="flex items-center gap-2">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            p.status === "RESERVED"
                              ? sceneColors.reserved
                              : sceneColors.stored,
                        }}
                      />
                      {p.status === "RESERVED"
                        ? th
                          ? "จองแล้ว"
                          : "Reserved"
                        : th
                          ? "จัดเก็บแล้ว"
                          : "Stored"}
                    </p>
                    <p className="mt-1 text-xs">
                      {zone.mode === "RACK"
                        ? th
                          ? "ชั้นวาง"
                          : "Rack"
                        : zone.mode === "PLATFORM"
                          ? th
                            ? "แท่นวาง"
                            : "Platform"
                          : th
                            ? "พื้นที่จัดเก็บ"
                            : "Floor storage"}{" "}
                      · {th ? "ระดับฐาน" : "Base height"}{" "}
                      {format.format((p.zMm ?? 0) / 1000)} m
                    </p>
                    {p.moveRole && (
                      <p className="text-xs text-muted">
                        {p.moveRole === "SOURCE"
                          ? th
                            ? "ต้นทางการย้าย"
                            : "Move source"
                          : th
                            ? "ปลายทางการย้าย"
                            : "Move destination"}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
