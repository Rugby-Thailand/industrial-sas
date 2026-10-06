"use client";
import { Fragment, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Map,
} from "lucide-react";
import { Popover } from "radix-ui";
import { SelectControl } from "@/components/ui/SelectControl";
import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/button";
import { LOCAL_PAGE_SIZES } from "@/components/system/PageSizeSelect";
import type { messagesFor } from "@/i18n/messages";
import type { StorageZoneRow } from "@/lib/convex/storageLayoutApi";
import type { locationInventory } from "@/lib/storageLayouts/locationSelectors";
import styles from "./FloorWorkspaceLocationList.module.css";
export type LocationSort = {
  key: "code" | "label" | "units";
  descending: boolean;
};
type LocationRow = {
  zone: StorageZoneRow;
  counts: ReturnType<typeof locationInventory>;
};
/** Compact workspace presentation; the shared table owns filtering, sorting and pagination. */
export function FloorWorkspaceLocationList({
  rows,
  showLabel,
  selection,
  pagination,
  sorting,
  labels,
  number,
  mobile,
  thai,
}: {
  rows: readonly LocationRow[];
  showLabel: boolean;
  selection: {
    id?: string;
    onSelect: (id: string) => void;
    details?: ReactNode;
    onShowMap?: () => void;
  };
  pagination: {
    page: number;
    pages: number;
    size: number;
    countText: string;
    onPage: (page: number) => void;
    onSize: (size: number) => void;
  };
  sorting: LocationSort & { onChange: (sort: LocationSort) => void };
  labels: ReturnType<typeof messagesFor>["StorageLayouts"]["locationTable"];
  number: Intl.NumberFormat;
  mobile: boolean;
  thai: boolean;
}) {
  const t = useTranslations("StorageLayouts");
  function changeSort(key: LocationSort["key"]) {
    sorting.onChange({
      key,
      descending: sorting.key === key ? !sorting.descending : false,
    });
  }
  function sortHeader(key: LocationSort["key"], label: string) {
    const active = sorting.key === key;
    const Icon = active
      ? sorting.descending
        ? ArrowDown
        : ArrowUp
      : ArrowUpDown;
    return (
      <th
        scope="col"
        data-column={key}
        aria-sort={
          active ? (sorting.descending ? "descending" : "ascending") : "none"
        }
      >
        <button type="button" onClick={() => changeSort(key)}>
          {label}
          <Icon aria-hidden="true" className="size-3" />
        </button>
      </th>
    );
  }
  function details() {
    return (
      <div className={styles.details} data-inline-location-details>
        {selection.onShowMap && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-11"
            onClick={selection.onShowMap}
          >
            <Map aria-hidden="true" />
            {t("workspace.showOnMap")}
          </Button>
        )}
        {selection.details}
      </div>
    );
  }
  const dimensions = (zone: StorageZoneRow) =>
    `${number.format(zone.widthMm / 1000)} × ${number.format(zone.depthMm / 1000)} × ${number.format(zone.maxStackHeightMm / 1000)}`;
  const value = (count: number, incomplete = false) =>
    `${incomplete ? "≥ " : ""}${number.format(count)}`;
  return (
    <div className={styles.root} data-workspace-location-list>
      {mobile && (
        <div className={styles.listHeading}>
          <span>{labels.title}</span>
          <Popover.Root>
            <Popover.Trigger asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={styles.sort}
                aria-label={labels.sort}
              >
                <ArrowUpDown aria-hidden="true" />
                {labels[sorting.key]}
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                sideOffset={4}
                className="z-50 rounded-lg border border-border bg-surface p-2 shadow-lg"
              >
                <div
                  role="group"
                  aria-label={labels.sort}
                  className="flex flex-col"
                >
                  {(["code", "label", "units"] as const).map((key) => (
                    <Button
                      type="button"
                      key={key}
                      variant="ghost"
                      aria-pressed={sorting.key === key}
                      className="justify-start"
                      onClick={() => changeSort(key)}
                    >
                      {labels[key]}
                      {sorting.key === key &&
                        (sorting.descending ? (
                          <ArrowDown aria-hidden="true" />
                        ) : (
                          <ArrowUp aria-hidden="true" />
                        ))}
                    </Button>
                  ))}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      )}
      <div className={styles.scroll} data-location-scroll>
        {mobile ? (
          <div role="list" aria-label={labels.title}>
            {rows.map(({ zone, counts }) => (
              <div role="listitem" key={zone.zoneId}>
                <button
                  type="button"
                  data-location-row
                  aria-pressed={selection.id === zone.zoneId}
                  aria-expanded={
                    selection.id === zone.zoneId && !!selection.details
                  }
                  aria-label={`${thai ? "เลือกจุดจัดเก็บ" : "Select location"} ${zone.code} · ${zone.label}`}
                  onClick={() => selection.onSelect(zone.zoneId)}
                  className={styles.row}
                >
                  <span className={styles.identity}>
                    <strong>{zone.code}</strong>
                    {zone.label !== zone.code && <span>{zone.label}</span>}
                    <span>{dimensions(zone)} m</span>
                  </span>
                  <span className={styles.status}>
                    <span>
                      {counts.incomplete
                        ? labels.unmeasured
                        : counts.stored > 0
                          ? labels.stored
                          : counts.reserved > 0
                            ? labels.reserved
                            : labels.vacant}
                    </span>
                    <span className={styles.units}>
                      {value(counts.units, counts.totalIncomplete)}{" "}
                      {labels.units}
                    </span>
                  </span>
                </button>
                {selection.id === zone.zoneId && selection.details && details()}
              </div>
            ))}
            {!rows.length && <p className={styles.empty}>{labels.empty}</p>}
          </div>
        ) : (
          <table className={styles.table}>
            <caption className="sr-only">{labels.title}</caption>
            <thead>
              <tr>
                {sortHeader("code", labels.code)}
                {showLabel && sortHeader("label", labels.label)}
                <th scope="col" data-column="dimensions">
                  {labels.dimensions}
                </th>
                {sortHeader("units", labels.units)}
                {(["stored", "reserved", "unmeasured"] as const).map((key) => (
                  <th scope="col" data-column={key} key={key}>
                    {labels[key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ zone, counts }) => (
                <Fragment key={zone.zoneId}>
                  <tr
                    data-location-row
                    data-state={
                      selection.id === zone.zoneId ? "selected" : undefined
                    }
                    onClick={() => selection.onSelect(zone.zoneId)}
                  >
                    <td data-column="code">
                      <button
                        type="button"
                        aria-pressed={selection.id === zone.zoneId}
                        aria-expanded={
                          selection.id === zone.zoneId && !!selection.details
                        }
                        aria-label={`${thai ? "เลือกจุดจัดเก็บ" : "Select location"} ${zone.code} · ${zone.label}`}
                      >
                        {zone.code}
                      </button>
                    </td>
                    {showLabel && (
                      <td data-column="label">
                        {zone.label !== zone.code ? zone.label : "—"}
                      </td>
                    )}
                    <td data-column="dimensions">{dimensions(zone)}</td>
                    <td data-column="units">
                      {value(counts.units, counts.totalIncomplete)}
                    </td>
                    <td data-column="stored">
                      {value(counts.stored, counts.incomplete)}
                    </td>
                    <td data-column="reserved">
                      {value(counts.reserved, counts.incomplete)}
                    </td>
                    <td data-column="unmeasured">{value(counts.unmeasured)}</td>
                  </tr>
                  {selection.id === zone.zoneId && selection.details && (
                    <tr>
                      <td colSpan={showLabel ? 7 : 6}>{details()}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={showLabel ? 7 : 6} className={styles.empty}>
                    {labels.empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {rows.some(({ counts }) => counts.incomplete) && (
        <p className={styles.note}>{labels.incomplete}</p>
      )}
      <nav
        className={styles.pagination}
        aria-label={thai ? "หน้ารายการจุดจัดเก็บ" : "Storage location pages"}
      >
        <span role="status">{pagination.countText}</span>
        {pagination.pages > 1 && (
          <div className={styles.paging}>
            <SelectControl
              label={labels.size}
              placeholder={labels.size}
              emptyLabel={labels.size}
              value={String(pagination.size)}
              options={LOCAL_PAGE_SIZES.map((size) => ({
                value: String(size),
                label: String(size),
              }))}
              onValueChange={(value) => {
                const size = LOCAL_PAGE_SIZES.find(
                  (size) => String(size) === value,
                );
                if (size !== undefined) pagination.onSize(size);
              }}
              className={styles.pageSize ?? ""}
            />
            <span>
              {thai ? "หน้า" : "Page"} {number.format(pagination.page + 1)} /{" "}
              {number.format(pagination.pages)}
            </span>
            <IconButton
              className={styles.pageButton}
              variant="ghost"
              label={labels.previous}
              disabled={pagination.page === 0}
              onClick={() => pagination.onPage(pagination.page - 1)}
            >
              <ChevronLeft />
            </IconButton>
            <IconButton
              className={styles.pageButton}
              variant="ghost"
              label={labels.next}
              disabled={pagination.page === pagination.pages - 1}
              onClick={() => pagination.onPage(pagination.page + 1)}
            >
              <ChevronRight />
            </IconButton>
          </div>
        )}
      </nav>
    </div>
  );
}
