"use client";
import { memo, useLayoutEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type {
  StorageBuildingRow,
  StorageFloorRow,
} from "@/lib/convex/storageLayoutApi";
import { squareMetres } from "./storageLayoutShared";
function FloorSelector({
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
      className="flex min-w-0 flex-col gap-1"
    >
      <p className="px-2 py-1 text-xs font-semibold text-muted">
        {t("floors")}
      </p>
      <div
        ref={rail}
        className="flex max-h-[42dvh] min-w-0 flex-col gap-1 overflow-y-auto"
      >
        {[...floors].reverse().map((floor) => (
          <button
            key={floor.floorId}
            type="button"
            aria-pressed={selectedFloorNumber === floor.floorNumber}
            aria-label={t("floor", { floor: floor.floorNumber })}
            onClick={() => onSelect(floor.floorNumber)}
            className="grid min-h-11 w-full grid-cols-[1fr_auto] items-center gap-x-3 rounded-md px-2 py-2 text-left text-xs hover:bg-raised aria-pressed:bg-selected aria-pressed:text-link"
          >
            <span className="block font-semibold">
              {t("floor", { floor: floor.floorNumber })}
            </span>
            <span className="text-xs text-muted">
              {squareMetres(floor.usableAreaSqMm).toLocaleString()} m²
            </span>
            <span className="mt-1 block text-xs text-muted">
              {t("floorLocationCount", { count: floor.storageZones.length })}
            </span>
          </button>
        ))}
      </div>
      {editAction}
    </nav>
  );
}

export const WorkspaceFloorSelector = memo(FloorSelector);
