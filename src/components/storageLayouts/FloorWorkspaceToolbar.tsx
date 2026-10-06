"use client";
import {
  Columns2,
  Map,
  List,
  SlidersHorizontal,
  Search,
  X,
  MoreHorizontal,
} from "lucide-react";
import { Popover } from "radix-ui";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import type { FloorWorkspaceView } from "./useFloorWorkspaceView";
import styles from "./FloorWorkspaceToolbar.module.css";
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
  floorControl,
  floorNumber,
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
  floorControl?: ReactNode;
  floorNumber: number;
}) {
  const t = useTranslations("StorageLayouts");
  const [moreOpen, setMoreOpen] = useState(false);
  const views: readonly FloorWorkspaceView[] = canSplit
    ? ["map", "list", "split"]
    : ["map", "list"];
  return (
    <div className={styles.toolbar} data-workspace-toolbar>
      <div className={styles.context}>
        {floorControl ?? (
          <span className={styles.floor}>
            {t("floor", { floor: floorNumber })}
          </span>
        )}
        <span role="status" className={styles.count}>
          {t("floorLocationCount", { count })}
        </span>
      </div>
      <div className={styles.search}>
        <Search aria-hidden="true" className="size-4 shrink-0 text-muted" />
        <input
          type="text"
          role="searchbox"
          inputMode="search"
          aria-label={t("locationTable.search")}
          placeholder={t("locationTable.search")}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
        />
        {search && (
          <IconButton
            className={styles.icon}
            variant="ghost"
            label={t("workspace.clearSearch")}
            onClick={() => onSearch("")}
          >
            <X />
          </IconButton>
        )}
      </div>
      <div className={styles.filter}>
        <Popover.Root>
          <Popover.Trigger asChild>
            <IconButton
              className={styles.icon}
              label={t("locationTable.filters")}
              aria-pressed={filters.length > 0}
              variant={filters.length ? "secondary" : "outline"}
            >
              <SlidersHorizontal />
              {filters.length > 0 && <span className={styles.filterDot} />}
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
      </div>
      <div
        role="group"
        data-floor-view-controls
        aria-label={t("storageFloorView")}
        className={styles.views}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
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
          const Icon = mode === "map" ? Map : mode === "list" ? List : Columns2;
          const label = t(`workspace.${mode}`);
          return (
            <IconButton
              key={mode}
              className={styles.icon}
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
      {actions && (
        <div className={styles.more}>
          <Popover.Root open={moreOpen} onOpenChange={setMoreOpen}>
            <Popover.Trigger asChild>
              <IconButton
                className={styles.icon}
                label={t("workspace.moreActions")}
                variant="ghost"
              >
                <MoreHorizontal />
              </IconButton>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                sideOffset={8}
                className="z-50 rounded-lg border border-border bg-surface p-2 shadow-lg"
                onClick={(event) => {
                  if (
                    event.target instanceof Element &&
                    event.target.closest("button, a")
                  )
                    setMoreOpen(false);
                }}
              >
                {actions}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      )}
    </div>
  );
}
