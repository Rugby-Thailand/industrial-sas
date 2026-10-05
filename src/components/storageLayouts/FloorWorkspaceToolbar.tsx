"use client";
import { Columns2, Map, List, SlidersHorizontal } from "lucide-react";
import { Popover } from "radix-ui";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { CollectionToolbar } from "@/components/system/CollectionToolbar";
import type { FloorWorkspaceView } from "./useFloorWorkspaceView";
export type LocationFilter = "empty" | "stored" | "reserved" | "unmeasured";
export function FloorWorkspaceToolbar({
  search,
  onSearch,
  filters,
  onFilters,
  view,
  onView,
  canSplit,
  count,
  actions,
}: {
  search: string;
  onSearch: (value: string) => void;
  filters: readonly LocationFilter[];
  onFilters: (value: readonly LocationFilter[]) => void;
  view: FloorWorkspaceView;
  onView: (value: FloorWorkspaceView) => void;
  canSplit: boolean;
  count: number;
  actions?: ReactNode;
}) {
  const t = useTranslations("StorageLayouts");
  const views: readonly FloorWorkspaceView[] = canSplit
    ? (["map", "list", "split"] as const)
    : (["map", "list"] as const);
  return (
    <CollectionToolbar
      value={search}
      onValueChange={onSearch}
      searchLabel={t("locationTable.search")}
      clearLabel={t("workspace.clearSearch")}
      actions={
        <>
          <Popover.Root>
            <Popover.Trigger asChild>
              <IconButton
                label={t("locationTable.filters")}
                aria-pressed={filters.length > 0}
                variant={filters.length ? "secondary" : "outline"}
              >
                <SlidersHorizontal />
              </IconButton>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                sideOffset={8}
                className="z-50 w-56 rounded-lg border border-border bg-surface p-2 shadow-lg"
              >
                <div
                  role="group"
                  aria-label={t("locationTable.filters")}
                  className="flex flex-col gap-1"
                >
                  {(["empty", "stored", "reserved", "unmeasured"] as const).map(
                    (key) => (
                      <Button
                        key={key}
                        variant={filters.includes(key) ? "secondary" : "ghost"}
                        className="min-h-11 justify-start"
                        aria-pressed={filters.includes(key)}
                        onClick={() =>
                          onFilters(
                            filters.includes(key)
                              ? filters.filter((item) => item !== key)
                              : [...filters, key],
                          )
                        }
                      >
                        {t(`locationTable.${key === "empty" ? "vacant" : key}`)}
                      </Button>
                    ),
                  )}
                  <Button
                    variant="ghost"
                    disabled={!filters.length}
                    onClick={() => onFilters([])}
                  >
                    {t("locationTable.clear")}
                  </Button>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <div
            role="group"
            data-floor-view-controls
            aria-label={t("storageFloorView")}
            className="flex shrink-0 gap-1 rounded-lg border border-border p-1"
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const index = views.indexOf(view);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? views.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        views.length) %
                      views.length;
              onView(views[next]!);
              event.currentTarget
                .querySelectorAll<HTMLButtonElement>("button")
                [next]?.focus();
            }}
          >
            {views.map((mode) => {
              const Icon =
                mode === "map" ? Map : mode === "list" ? List : Columns2;
              const label = t(`workspace.${mode}`);
              return (
                <IconButton
                  key={mode}
                  label={label}
                  tooltip={label}
                  variant={view === mode ? "secondary" : "ghost"}
                  aria-pressed={view === mode}
                  tabIndex={view === mode ? 0 : -1}
                  onClick={() => onView(mode)}
                >
                  <Icon aria-hidden="true" />
                </IconButton>
              );
            })}
          </div>
          <span
            role="status"
            className="hidden text-xs text-muted min-[851px]:inline"
          >
            {t("floorLocationCount", { count })}
          </span>
          {actions}
        </>
      }
    />
  );
}
