"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  SlidersHorizontal,
  LayoutGrid,
  List,
  X,
} from "lucide-react";
import { useLocale } from "next-intl";
import { useId, useMemo, useState, useEffect, type ReactNode } from "react";

import { PaginationFooter } from "@/components/system/PaginationFooter";
import { CollectionToolbar } from "@/components/system/CollectionToolbar";
import { IconButton } from "@/components/ui/IconButton";
import { SelectControl } from "@/components/ui/SelectControl";
import {
  PageSizeSelect,
  LOCAL_PAGE_SIZES,
} from "@/components/system/PageSizeSelect";

import { Button } from "@/components/ui/button";
import {
  locationInventory,
  matchingStorageLocations,
} from "@/lib/storageLayouts/locationSelectors";
import type { StorageZoneRow } from "@/lib/convex/storageLayoutApi";
import { messagesFor } from "@/i18n/messages";

type SortKey = "code" | "label" | "units";

export function FloorLocationTable({
  zones,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  actions,
  onClearSelection,
}: {
  readonly zones: readonly StorageZoneRow[];
  readonly selectedId?: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly search?: string;
  readonly onSearchChange?: (value: string) => void;
  readonly actions?: ReactNode;
  readonly onClearSelection?: () => void;
}) {
  const locale = useLocale();
  const thai = locale === "th";
  const filtersId = useId();
  const [localSearch, setLocalSearch] = useState("");
  const query = search ?? localSearch;
  const [layout, setLayout] = useState<"table" | "grid">("table");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState(25);
  const [pagination, setPagination] = useState({ page: 0, revealKey: "" });
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: "code",
    descending: false,
  });
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const labels = {
    ...messagesFor(locale).StorageLayouts.locationTable,
  };
  const sorted = useMemo(() => {
    const collator = new Intl.Collator(locale, {
      numeric: true,
      sensitivity: "base",
    });
    return matchingStorageLocations(zones, query)
      .map((zone) => ({ zone, counts: locationInventory(zone) }))
      .filter(({ counts }) => {
        return (
          !filters.length ||
          filters.some((filter) =>
            filter === "empty"
              ? counts.units === 0 && !counts.incomplete
              : counts[filter as "stored" | "reserved" | "unmeasured"] > 0,
          )
        );
      })
      .sort((a, b) => {
        const primary =
          sort.key === "units"
            ? a.counts.units - b.counts.units
            : collator.compare(a.zone[sort.key], b.zone[sort.key]);
        return (
          (sort.descending ? -primary : primary) ||
          collator.compare(a.zone.code, b.zone.code) ||
          a.zone.zoneId.localeCompare(b.zone.zoneId)
        );
      });
  }, [locale, sort, zones, query, filters]);
  const selectedIndex = sorted.findIndex(
    ({ zone }) => zone.zoneId === selectedId,
  );
  useEffect(() => {
    if (filters.length && selectedId && selectedIndex < 0) onClearSelection?.();
  }, [filters.length, selectedId, selectedIndex, onClearSelection]);
  // Only a selection/order/size change reveals the selected row. A manual
  // page change retains selection without snapping back to its page.
  const revealKey = `${selectedId ?? ""}:${selectedIndex}:${pageSize}`;
  const page =
    pagination.revealKey === revealKey
      ? pagination.page
      : selectedIndex >= 0
        ? Math.floor(selectedIndex / pageSize)
        : 0;
  if (pagination.revealKey !== revealKey) setPagination({ page, revealKey });
  function setPage(next: number) {
    setPagination({ page: next, revealKey });
  }
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const first = currentPage * pageSize;
  const visible = sorted.slice(first, first + pageSize);
  const countText = thai
    ? `${number.format(sorted.length ? first + 1 : 0)}–${number.format(first + visible.length)} จาก ${number.format(sorted.length)} จุดจัดเก็บ`
    : `${number.format(sorted.length ? first + 1 : 0)}–${number.format(first + visible.length)} of ${number.format(sorted.length)} locations`;
  function sortHeader(key: SortKey, label: string) {
    const active = sort.key === key;
    const Icon = active ? (sort.descending ? ArrowDown : ArrowUp) : ArrowUpDown;
    return (
      <th
        scope="col"
        aria-sort={
          active ? (sort.descending ? "descending" : "ascending") : "none"
        }
        className={key === "units" ? "px-3 text-right" : "px-3 text-left"}
      >
        <button
          type="button"
          className="inline-flex min-h-touch items-center gap-2 text-xs font-semibold"
          onClick={() => {
            setSort({ key, descending: active ? !sort.descending : false });
            setPage(0);
          }}
        >
          {label}
          <Icon aria-hidden="true" className="size-3.5" />
        </button>
      </th>
    );
  }
  return (
    <div className="min-w-0 space-y-3">
      <p role="status" className="sr-only">
        {countText}
      </p>
      <CollectionToolbar
        value={query}
        searchLabel={labels.search}
        clearLabel={thai ? "ล้างการค้นหา" : "Clear search"}
        onValueChange={(value) => {
          setLocalSearch(value);
          onSearchChange?.(value);
          setPage(0);
        }}
        actions={
          <>
            <IconButton
              type="button"
              variant={filters.length ? "secondary" : "outline"}
              label={labels.filters}
              aria-expanded={filtersOpen}
              aria-controls={filtersId}
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              <SlidersHorizontal aria-hidden="true" />
            </IconButton>
            <div
              className="flex gap-1"
              role="group"
              aria-label={thai ? "รูปแบบรายการ" : "Location view"}
            >
              <IconButton
                type="button"
                variant={layout === "table" ? "secondary" : "ghost"}
                label={labels.table}
                aria-pressed={layout === "table"}
                onClick={() => setLayout("table")}
              >
                <List aria-hidden="true" />
              </IconButton>
              <IconButton
                type="button"
                variant={layout === "grid" ? "secondary" : "ghost"}
                label={labels.grid}
                aria-pressed={layout === "grid"}
                onClick={() => setLayout("grid")}
              >
                <LayoutGrid aria-hidden="true" />
              </IconButton>
            </div>
            {actions}
          </>
        }
      />
      {filtersOpen || filters.length ? (
        <div
          id={filtersId}
          role="group"
          aria-label={labels.filters}
          className="flex flex-wrap gap-2"
        >
          {(
            [
              ["empty", labels.vacant],
              ["stored", labels.stored],
              ["reserved", labels.reserved],
              ["unmeasured", labels.unmeasured],
            ] as const
          )
            .filter(([key]) => filtersOpen || filters.includes(key))
            .map(([key, label]) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={filters.includes(key) ? "secondary" : "outline"}
                aria-pressed={filters.includes(key)}
                onClick={() => {
                  setFilters((current) =>
                    current.includes(key)
                      ? current.filter((item) => item !== key)
                      : [...current, key],
                  );
                  setPage(0);
                }}
              >
                {label}
              </Button>
            ))}
          {filters.length ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setFilters([]);
                setPage(0);
              }}
            >
              <X aria-hidden="true" />
              {labels.clear}
            </Button>
          ) : null}
        </div>
      ) : null}
      {layout === "grid" ? (
        <>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted">
              {labels.sort}
              <SelectControl
                label={labels.sort}
                value={sort.key}
                options={[
                  { value: "code", label: labels.code },
                  { value: "label", label: labels.label },
                  { value: "units", label: labels.units },
                ]}
                placeholder={labels.sort}
                emptyLabel={labels.sort}
                onValueChange={(key) => {
                  if (key === "code" || key === "label" || key === "units")
                    setSort({ key, descending: sort.descending });
                }}
              />
            </label>
            <IconButton
              type="button"
              variant="ghost"
              label={labels.direction}
              onClick={() => setSort({ ...sort, descending: !sort.descending })}
            >
              {sort.descending ? (
                <ArrowDown aria-hidden="true" />
              ) : (
                <ArrowUp aria-hidden="true" />
              )}
            </IconButton>
          </div>
          <div
            role="list"
            aria-label={labels.title}
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          >
            {visible.map(({ zone, counts }) => (
              <div role="listitem" key={zone.zoneId}>
                <button
                  type="button"
                  aria-pressed={selectedId === zone.zoneId}
                  aria-label={`${thai ? "เลือกจุดจัดเก็บ" : "Select location"} ${zone.code} · ${zone.label}`}
                  onClick={() => onSelect(zone.zoneId)}
                  className="h-full w-full space-y-3 rounded-lg border border-border bg-surface p-4 text-left hover:bg-raised aria-pressed:border-ring aria-pressed:bg-selected"
                >
                  <div className="text-xs break-words text-muted">
                    {zone.code}
                  </div>
                  <div className="font-medium break-words">{zone.label}</div>
                  <div className="text-sm text-muted">
                    {number.format(zone.widthMm / 1000)} ×{" "}
                    {number.format(zone.depthMm / 1000)} ×{" "}
                    {number.format(zone.maxStackHeightMm / 1000)} m
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    {(
                      [
                        [labels.units, counts.units, counts.totalIncomplete],
                        [labels.stored, counts.stored, counts.incomplete],
                        [labels.reserved, counts.reserved, counts.incomplete],
                        [labels.unmeasured, counts.unmeasured, false],
                      ] as const
                    ).map(([label, count, incomplete]) => (
                      <div key={label}>
                        <dt className="text-xs text-muted">{label}</dt>
                        <dd className="tabular-nums">
                          {incomplete ? "≥ " : ""}
                          {number.format(count)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </button>
              </div>
            ))}
          </div>
          {!visible.length ? (
            <p className="py-8 text-center text-muted">{labels.empty}</p>
          ) : null}
        </>
      ) : (
        <div
          role="region"
          aria-label={labels.title}
          tabIndex={0}
          className="min-w-0 overflow-x-auto rounded-lg border border-border focus-visible:outline-offset-[-3px]"
        >
          <table className="w-full min-w-[52rem] border-collapse bg-surface text-sm">
            <caption className="sr-only">{labels.title}</caption>
            <thead className="border-b border-border bg-raised text-text">
              <tr>
                {sortHeader("code", labels.code)}
                {sortHeader("label", labels.label)}
                <th
                  scope="col"
                  className="px-3 text-left text-xs font-semibold"
                >
                  {labels.dimensions}
                </th>
                {sortHeader("units", labels.units)}
                {[labels.stored, labels.reserved, labels.unmeasured].map(
                  (label) => (
                    <th
                      scope="col"
                      key={label}
                      className="px-3 text-right text-xs font-semibold"
                    >
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ zone, counts }) => (
                <tr
                  key={zone.zoneId}
                  data-state={
                    selectedId === zone.zoneId ? "selected" : undefined
                  }
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-raised data-[state=selected]:bg-selected"
                  onClick={() => onSelect(zone.zoneId)}
                >
                  <td className="max-w-48 px-3 py-2 align-top">
                    <button
                      type="button"
                      aria-pressed={selectedId === zone.zoneId}
                      aria-label={`${thai ? "เลือกจุดจัดเก็บ" : "Select location"} ${zone.code} · ${zone.label}`}
                      className="min-h-touch text-left font-medium break-words text-link"
                    >
                      {zone.code}
                    </button>
                  </td>
                  <td className="max-w-80 min-w-48 px-3 py-4 align-top break-words whitespace-normal">
                    {zone.label}
                  </td>
                  <td className="px-3 py-4 align-top whitespace-nowrap text-muted tabular-nums">
                    {number.format(zone.widthMm / 1000)} ×{" "}
                    {number.format(zone.depthMm / 1000)} ×{" "}
                    {number.format(zone.maxStackHeightMm / 1000)}
                  </td>
                  <td className="px-3 py-4 text-right align-top tabular-nums">
                    {counts.totalIncomplete ? "≥ " : ""}
                    {number.format(counts.units)}
                  </td>
                  <td className="px-3 py-4 text-right align-top tabular-nums">
                    {counts.incomplete ? "≥ " : ""}
                    {number.format(counts.stored)}
                  </td>
                  <td className="px-3 py-4 text-right align-top tabular-nums">
                    {counts.incomplete ? "≥ " : ""}
                    {number.format(counts.reserved)}
                  </td>
                  <td className="px-3 py-4 text-right align-top tabular-nums">
                    {number.format(counts.unmeasured)}
                  </td>
                </tr>
              ))}
              {!visible.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    {labels.empty}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      {visible.some(({ counts }) => counts.incomplete) ? (
        <p className="text-xs text-muted">{labels.incomplete}</p>
      ) : null}
      <PaginationFooter
        label={thai ? "หน้ารายการจุดจัดเก็บ" : "Storage location pages"}
        pageSizeControl={
          <PageSizeSelect
            label={labels.size}
            value={pageSize}
            sizes={LOCAL_PAGE_SIZES}
            onValueChange={(size) => {
              setPageSize(size);
              setPage(0);
            }}
          />
        }
        status={
          <>
            {thai ? "หน้า" : "Page"} {number.format(currentPage + 1)} /{" "}
            {number.format(pages)}
          </>
        }
        previousLabel={labels.previous}
        nextLabel={labels.next}
        canPrevious={currentPage > 0}
        canNext={currentPage < pages - 1}
        onPrevious={() => setPage(currentPage - 1)}
        onNext={() => setPage(currentPage + 1)}
      />
    </div>
  );
}
