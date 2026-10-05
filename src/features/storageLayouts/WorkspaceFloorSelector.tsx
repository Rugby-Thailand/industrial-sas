"use client";
import { memo, useLayoutEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type {
  StorageBuildingRow,
  StorageFloorRow,
} from "@/lib/convex/storageLayoutApi";
import { resolveAreaColor } from "@/lib/storageLayouts/areaColors";
import { metres, squareMetres } from "./storageLayoutShared";
function FloorSelector({
  building,
  floors,
  selectedFloorNumber,
  onSelect,
  editAction,
}: {
  readonly building: StorageBuildingRow;
  readonly floors: readonly StorageFloorRow[];
  readonly selectedFloorNumber: number;
  readonly onSelect: (floor: number) => void;
  readonly editAction: ReactNode;
}) {
  const t = useTranslations("StorageLayouts");
  const rail = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const reveal = () => {
      const container = rail.current;
      const selected = container?.querySelector<HTMLElement>(
        '[aria-pressed="true"]',
      );
      if (!container || !selected) return;
      const bounds = selected.getBoundingClientRect();
      const viewport = container.getBoundingClientRect();
      if (bounds.left < viewport.left)
        container.scrollLeft -= viewport.left - bounds.left;
      if (bounds.right > viewport.right)
        container.scrollLeft += bounds.right - viewport.right;
      if (bounds.top < viewport.top)
        container.scrollTop -= viewport.top - bounds.top;
      if (bounds.bottom > viewport.bottom)
        container.scrollTop += bounds.bottom - viewport.bottom;
    };
    reveal();
    window.addEventListener("resize", reveal);
    return () => window.removeEventListener("resize", reveal);
  }, [selectedFloorNumber, floors]);
  return (
    <nav
      aria-label={t("floorSelector")}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface p-2"
    >
      <p className="hidden text-xs font-semibold text-muted min-[851px]:block">
        {t("floors")}
      </p>
      <div
        ref={rail}
        className="flex min-w-0 flex-1 gap-2 overflow-x-auto min-[851px]:max-h-[42dvh] min-[851px]:flex-col min-[851px]:overflow-x-hidden min-[851px]:overflow-y-auto"
      >
        {[...floors].reverse().map((floor) => (
          <button
            key={floor.floorId}
            type="button"
            aria-pressed={selectedFloorNumber === floor.floorNumber}
            aria-label={t("floor", { floor: floor.floorNumber })}
            onClick={() => onSelect(floor.floorNumber)}
            className="min-h-11 shrink-0 rounded-lg border border-border px-2 py-2 text-left text-xs hover:bg-raised aria-pressed:border-accent aria-pressed:bg-accent-surface min-[851px]:w-full"
          >
            <span className="block font-semibold">
              {t("floor", { floor: floor.floorNumber })}
            </span>
            <span className="mt-1 hidden text-muted min-[581px]:block">
              {squareMetres(floor.usableAreaSqMm).toLocaleString()} m²
            </span>
            <svg
              aria-hidden="true"
              viewBox={`0 0 ${floor.widthMm ?? building.widthMm} ${floor.depthMm ?? building.depthMm}`}
              className="my-2 hidden h-[45px] w-full min-[851px]:block"
            >
              <rect
                width="100%"
                height="100%"
                fill="var(--plan-floor, var(--color-raised))"
                stroke="var(--plan-wall, var(--color-accent))"
                strokeWidth={Math.min(building.widthMm, building.depthMm) / 60}
              />
              {floor.reservedBlocks.map((block, index) => (
                <rect
                  key={index}
                  x={block.xMm}
                  y={block.yMm}
                  width={block.widthMm}
                  height={block.depthMm}
                  fill={resolveAreaColor(block.color)}
                />
              ))}
              {floor.storageZones.map((zone) => (
                <rect
                  key={zone.zoneId}
                  x={zone.xMm}
                  y={zone.yMm}
                  width={zone.widthMm}
                  height={zone.depthMm}
                  fill="var(--plan-occupied-border, var(--color-accent))"
                  opacity="0.65"
                />
              ))}
            </svg>
            <span className="hidden text-muted min-[851px]:block">
              {t("floorLocationCount", { count: floor.storageZones.length })}
            </span>
            <span className="mt-1 hidden text-muted min-[851px]:block">
              {t("height")}:{" "}
              {metres(floor.heightMm ?? building.defaultFloorHeightMm)} m
            </span>
          </button>
        ))}
      </div>
      {editAction}
    </nav>
  );
}

export const WorkspaceFloorSelector = memo(FloorSelector);
