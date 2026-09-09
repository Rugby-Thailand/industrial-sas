"use client";
import { useState } from "react";
import { useLocale } from "next-intl";
import { FloorMap } from "./FloorMap";
import { floorMapDemo } from "./storageFloorDemoData";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";

export function FloorMapDemo() {
  const thai = useLocale() === "th";
  const [full, setFull] = useState(false);
  const data = floorMapDemo(full, thai);
  return (
    <>
      <PageHeader
        title={
          thai
            ? "ตัวอย่างชั้นจัดเก็บพร้อมทางเดิน"
            : "Populated floor with aisles"
        }
        back={{
          href: "/master-data/storage-layouts",
          label: thai ? "อาคารและจุดจัดเก็บ" : "Buildings & spots",
        }}
      />
      <p className="mb-4 rounded-xl border border-accent/30 bg-accent/5 p-4 text-sm">
        {thai
          ? "ข้อมูลตัวอย่างสำหรับทดลองแผนผัง ไม่มีผลต่อสินค้าและตำแหน่งจริง ลองเลือกจุดจัดเก็บ พาเลท ค้นหา หมุน ซูม หรือสลับ 2D/3D ได้ การย้ายและบันทึกสินค้าไม่ได้เปิดใช้ในตัวอย่างนี้"
          : "Interactive sample data, separate from live inventory. Select locations or pallets, search, rotate, zoom and switch 2D/3D. Inventory moves and saving are unavailable in this example."}
      </p>
      <div
        className="mb-4 flex flex-wrap gap-2"
        role="group"
        aria-label={thai ? "ตัวอย่างความหนาแน่น" : "Occupancy scenarios"}
      >
        <Button
          type="button"
          variant="outline"
          aria-pressed={!full}
          className="aria-pressed:border-accent aria-pressed:text-accent"
          onClick={() => setFull(false)}
        >
          {thai
            ? "มีทั้งเต็ม ว่าง และจอง · 62 หน่วย"
            : "Mixed occupancy · 62 units"}
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-pressed={full}
          className="aria-pressed:border-accent aria-pressed:text-accent"
          onClick={() => setFull(true)}
        >
          {thai
            ? "เต็มทุกจุดจัดเก็บ · 120 หน่วย"
            : "All storage footprints full · 120 units"}
        </Button>
      </div>
      <FloorMap {...data} previewOnly />
      <p className="mt-3 text-sm text-muted">
        {thai
          ? "ทางเดินกว้าง 2 ม. ไม่ถูกนับเป็นพื้นที่จัดเก็บ • ตัวอย่างเต็มหมายถึงพื้นที่ฐานของจุดจัดเก็บถูกใช้หรือจองครบ ไม่ได้หมายความว่าทางเดินถูกเติมสินค้า • ลองค้นหา DEMO-P-030"
          : "2 m aisles stay clear. Full means each storage footprint is occupied or reserved, not that aisles contain stock. Try searching DEMO-P-030."}
      </p>
    </>
  );
}
