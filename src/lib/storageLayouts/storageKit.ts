import type {
  StorageStackPlacementRow,
  StorageZoneRow,
} from "@/lib/convex/storageLayoutApi";

/** Shared storage domain vocabulary used by maps, lists, inspectors and editors. */
export const metres = (millimetres: number) => millimetres / 1_000;
export const squareMetres = (squareMillimetres: number) =>
  squareMillimetres / 1_000_000;

export function millimetres(value: string): number {
  return Math.round(Number(value) * 1_000);
}

/** Clamp a draggable footprint to its parent floor while retaining sub-metre coordinates. */
export function clampStoragePosition(
  xMm: number,
  yMm: number,
  parentWidthMm: number,
  parentDepthMm: number,
  itemWidthMm: number,
  itemDepthMm: number,
) {
  return {
    xMm: Math.max(0, Math.min(xMm, Math.max(0, parentWidthMm - itemWidthMm))),
    yMm: Math.max(0, Math.min(yMm, Math.max(0, parentDepthMm - itemDepthMm))),
  };
}

/** The translation key is deliberately stable; callers own the translated text. */
export function placementStatusKey(
  placement: Pick<
    StorageStackPlacementRow,
    "moveRole" | "moveState" | "status"
  >,
) {
  return placement.moveRole === "TARGET"
    ? "placementMoveTarget"
    : placement.moveRole === "SOURCE"
      ? placement.moveState === "IN_TRANSIT"
        ? "placementMoveInTransit"
        : "placementMoveSource"
      : placement.status === "RESERVED"
        ? "placementReserved"
        : "placementStored";
}

/** Preserve the distinction between no rows and a summary-only location. */
export function storageLocationSummary(zone: StorageZoneRow) {
  const knownUnits = new Set(
    zone.placements.map((placement) => placement.handlingUnitId),
  );
  const locationOnlyUnits = new Set(
    (zone.locationOnlyPlacements ?? [])
      .filter((placement) => placement.status !== "RELEASED")
      .map((placement) => placement.handlingUnitId),
  );
  const knownUnitCount = new Set([...knownUnits, ...locationOnlyUnits]).size;
  const units =
    zone.palletCount ??
    Math.max(knownUnitCount, zone.unmeasuredPalletCount ?? 0);
  return {
    units,
    stored: new Set([
      ...zone.placements
        .filter((placement) => (placement.status ?? "STORED") === "STORED")
        .map((placement) => placement.handlingUnitId),
      ...(zone.locationOnlyPlacements ?? [])
        .filter((placement) => placement.status === "STORED")
        .map((placement) => placement.handlingUnitId),
    ]).size,
    reserved: new Set([
      ...zone.placements
        .filter((placement) => placement.status === "RESERVED")
        .map((placement) => placement.handlingUnitId),
      ...(zone.locationOnlyPlacements ?? [])
        .filter((placement) => placement.status === "RESERVED")
        .map((placement) => placement.handlingUnitId),
    ]).size,
    unmeasured: Math.max(
      zone.unmeasuredPalletCount ?? 0,
      locationOnlyUnits.size,
    ),
    incomplete:
      (zone.unmeasuredPalletCount ?? 0) > locationOnlyUnits.size ||
      (zone.palletCount ?? knownUnitCount) > knownUnitCount,
  };
}

export interface StorageAreaSummary {
  readonly gross: number;
  readonly usable: number;
  readonly stored: number;
  readonly reserved: number;
  readonly free: number;
  readonly unavailable: number;
}

export function storageAreaSummary(input: {
  grossAreaSqMm: number;
  usableAreaSqMm: number;
  storedFootprintAreaSqMm?: number;
  heldFootprintAreaSqMm?: number;
}): StorageAreaSummary {
  const finite = (value: number) =>
    Number.isFinite(value) ? Math.max(0, value) : 0;
  const gross = finite(input.grossAreaSqMm);
  const usable = Math.min(gross, finite(input.usableAreaSqMm));
  const stored = Math.min(usable, finite(input.storedFootprintAreaSqMm ?? 0));
  const reserved = Math.min(
    usable - stored,
    finite(input.heldFootprintAreaSqMm ?? 0),
  );
  return {
    gross,
    usable,
    stored,
    reserved,
    free: usable - stored - reserved,
    unavailable: gross - usable,
  };
}
