import type { StorageZoneRow } from "@/lib/convex/storageLayoutApi";

/** Isolated UI fixture: never written to inventory or used in live workflows. */
export function floorMapDemo(full: boolean, thai: boolean) {
  const labels = thai
    ? [
        "FG-A · เต็มพื้นที่",
        "FG-B · จัดเก็บและจอง",
        "FG-C · มีที่ว่าง",
        "FG-D · ว่าง",
      ]
    : [
        "FG-A · Full footprint",
        "FG-B · Stored & reserved",
        "FG-C · Space available",
        "FG-D · Empty",
      ];
  const zones: StorageZoneRow[] = [0, 1, 2, 3].map((index) => {
    const count = full ? 30 : [30, 24, 8, 0][index]!;
    const code = `DEMO-Z0${index + 1}`;
    return {
      zoneId: code,
      locationId: code,
      code,
      label: full
        ? `FG-${String.fromCharCode(65 + index)} · ${thai ? "เต็มพื้นที่" : "Full footprint"}`
        : labels[index]!,
      qrValue: `DEMO:LOCATION:${code}`,
      mode: "SIMPLE",
      xMm: index % 2 ? 14000 : 1000,
      yMm: index < 2 ? 1000 : 11000,
      widthMm: 9000,
      depthMm: 6000,
      maxStackHeightMm: 1600,
      positions: [],
      placements: Array.from({ length: count }, (_, slot) => ({
        placementId: `${code}-${slot}`,
        handlingUnitId: `demo-${index}-${slot}`,
        lpn: `DEMO-P-${String(index * 30 + slot + 1).padStart(3, "0")}`,
        levelIndex: 1,
        widthMm: 1500,
        depthMm: 1200,
        heightMm: 1400,
        orientation: "DEFAULT",
        placedAt: 1,
        xMm: (slot % 6) * 1500,
        yMm: Math.floor(slot / 6) * 1200,
        zMm: 0,
        status: index === 1 && slot >= 18 && slot < 24 ? "RESERVED" : "STORED",
        positionCode: `${code}-${String(slot + 1).padStart(2, "0")}`,
      })),
    };
  });
  return {
    widthMm: 24000,
    depthMm: 18000,
    heightMm: 4000,
    baseWidthMm: 24000,
    baseDepthMm: 18000,
    offsetXMm: 0,
    offsetYMm: 0,
    baseLabel: thai ? "พื้นที่ฐานอาคาร" : "Building footprint",
    floorNumber: 1,
    zones,
    blocks: [
      {
        xMm: 11000,
        yMm: 0,
        widthMm: 2000,
        depthMm: 18000,
        label: thai ? "ทางเดินหลัก 2 ม." : "Main aisle 2 m",
      },
      {
        xMm: 0,
        yMm: 8000,
        widthMm: 11000,
        depthMm: 2000,
        label: thai ? "ทางเดิน 2 ม." : "Aisle 2 m",
      },
      {
        xMm: 13000,
        yMm: 8000,
        widthMm: 11000,
        depthMm: 2000,
        label: thai ? "ทางเดิน 2 ม." : "Aisle 2 m",
      },
    ],
  };
}
