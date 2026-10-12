"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { CalendarDays, Download, Funnel } from "lucide-react";

import { dayNumber } from "../../../convex/model/hr/calendar";
import { FEATURES, type Feature } from "../../../convex/model/aiUsage/usage";
import { Button } from "@/components/ui/button";
import { DetailsPanel } from "@/components/ui/DetailsPanel";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { SelectControl } from "@/components/ui/SelectControl";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { DimensionFilter, useDimensionLabels } from "./DimensionFilter";
import {
  activeFilterCount,
  NO_FILTERS,
  type Report,
  type UsageFilters,
} from "./report";

export type Period = "month" | "today" | "custom";
export interface DateRange {
  readonly from: string;
  readonly to: string;
}
type Options = Pick<Report, "users" | "warehouses" | "models" | "environments">;

/**
 * Period, report filters, the answered range and CSV export, in one row.
 * Phones keep the period, filter and export on the first line and move the
 * range below. Filters live in a Sheet on every width; they apply as they
 * change, so the report behind updates live.
 */
export function UsageToolbar({
  period,
  onPeriod,
  range,
  timezone,
  onDates,
  filters,
  onFilters,
  options,
  featureLabel,
  canExport,
  exporting,
  onExport,
}: {
  readonly period: Period;
  readonly onPeriod: (period: Period) => void;
  /** The range the report currently answers, used as the date defaults. */
  readonly range: DateRange | null;
  /** The organization timezone the range is in, once the report answers. */
  readonly timezone: string | null;
  readonly onDates: (dates: DateRange) => void;
  readonly filters: UsageFilters;
  readonly onFilters: (filters: UsageFilters) => void;
  readonly options: Options | null;
  readonly featureLabel: (feature: Feature) => string;
  readonly canExport: boolean;
  readonly exporting: boolean;
  readonly onExport: () => void;
}) {
  const t = useTranslations("AiUsage");
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(""),
    [draftTo, setDraftTo] = useState(""),
    [dateError, setDateError] = useState(false);
  const count = activeFilterCount(filters);
  const all = { value: "", label: t("all") };
  const set = (patch: Partial<UsageFilters>) =>
    onFilters({ ...filters, ...patch });

  function applyDates(event: FormEvent) {
    event.preventDefault();
    const from = draftFrom || range?.from || "",
      to = draftTo || range?.to || "",
      a = dayNumber(from),
      b = dayNumber(to);
    if (a === null || b === null || b < a || b - a > 92) {
      setDateError(true);
      return;
    }
    setDateError(false);
    onDates({ from, to });
  }

  const selector = (
    key: keyof UsageFilters,
    title: string,
    choices: readonly { value: string; label: string }[],
  ) => (
    <FormField id={`usage-filter-${key}`} label={title}>
      {(props) => (
        <SelectControl
          id={props.id}
          value={filters[key]}
          label={title}
          onValueChange={(value) => set({ [key]: value })}
          options={[all, ...choices]}
          placeholder={t("all")}
          emptyLabel={t("all")}
        />
      )}
    </FormField>
  );
  const unique = (values: readonly string[] | undefined) =>
    Array.from(new Set(values ?? [])).map((value) => ({
      value,
      label: value,
    }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-3">
        <FormField
          id="usage-period"
          label={t("period")}
          srOnlyLabel
          className="w-40 min-w-0 shrink sm:w-44"
        >
          {(props) => (
            <span className="relative block">
              <CalendarDays
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted"
              />
              <SelectControl
                id={props.id}
                value={period}
                label={t("period")}
                className="w-full pl-9 whitespace-nowrap"
                onValueChange={(value) => {
                  onPeriod(value as Period);
                  setDateError(false);
                }}
                options={[
                  { value: "month", label: t("month") },
                  { value: "today", label: t("today") },
                  { value: "custom", label: t("custom") },
                ]}
                placeholder={t("month")}
                emptyLabel={t("month")}
              />
            </span>
          )}
        </FormField>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label={count ? `${t("filters")} (${count})` : t("filters")}
              title={t("filters")}
              className={`relative ${count ? "border-link text-link" : ""}`}
            >
              <Funnel aria-hidden="true" className="size-4" />
              {count ? (
                <span
                  aria-hidden="true"
                  className="absolute -top-1.5 -right-1.5 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[0.6875rem] leading-5 font-semibold text-primary-foreground tabular-nums"
                >
                  {count}
                </span>
              ) : null}
            </Button>
          </SheetTrigger>
          <DetailsPanel
            title={t("filtersTitle")}
            description={t("filtersDescription")}
            closeLabel={t("filtersClose")}
          >
            <div className="grid gap-4">
              {selector(
                "feature",
                t("feature"),
                FEATURES.map((kind) => ({
                  value: kind,
                  label: featureLabel(kind),
                })),
              )}
              {/* Every member and warehouse is reachable, not only those
                  the report could label within its bounded lookup. */}
              <DimensionFilter
                kind="actor"
                title={t("user")}
                value={filters.actorUserId}
                knownLabel={
                  options?.users.find((u) => u.id === filters.actorUserId)?.name
                }
                onChange={(value) => set({ actorUserId: value })}
              />
              <DimensionFilter
                kind="warehouse"
                title={t("warehouse")}
                value={filters.warehouseId}
                knownLabel={
                  options?.warehouses.find((w) => w.id === filters.warehouseId)
                    ?.name
                }
                onChange={(value) => set({ warehouseId: value })}
              />
              {selector("requestedModel", t("model"), unique(options?.models))}
              {selector(
                "environment",
                t("environment"),
                unique(options?.environments),
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-3">
              <Button onClick={() => setOpen(false)}>{t("filtersDone")}</Button>
              {count ? (
                <Button variant="outline" onClick={() => onFilters(NO_FILTERS)}>
                  {t("filtersClear")}
                </Button>
              ) : null}
            </div>
          </DetailsPanel>
        </Sheet>
        {range ? (
          <p
            className="order-last flex w-full flex-wrap items-center gap-x-2 text-sm text-muted tabular-nums sm:order-none sm:ml-auto sm:w-auto sm:justify-end"
            data-testid="usage-range"
          >
            <span>
              {range.from} – {range.to}
            </span>
            {timezone ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{timezone}</span>
              </>
            ) : null}
          </p>
        ) : null}
        <Button
          variant="outline"
          className="ml-auto sm:ml-0"
          aria-label={t(exporting ? "exporting" : "export")}
          onClick={onExport}
          disabled={!canExport || exporting}
        >
          <Download aria-hidden="true" className="size-4" />
          <span className="sm:hidden">
            {t(exporting ? "exporting" : "exportShort")}
          </span>
          <span className="hidden sm:inline">
            {t(exporting ? "exporting" : "export")}
          </span>
        </Button>
      </div>
      {period === "custom" ? (
        <form onSubmit={applyDates} className="flex flex-wrap items-end gap-3">
          <FormField id="usage-from" label={t("from")}>
            {(props) => (
              <Input
                {...props}
                type="date"
                value={draftFrom || range?.from || ""}
                onChange={(e) => setDraftFrom(e.target.value)}
                required
              />
            )}
          </FormField>
          <FormField id="usage-to" label={t("to")}>
            {(props) => (
              <Input
                {...props}
                type="date"
                value={draftTo || range?.to || ""}
                onChange={(e) => setDraftTo(e.target.value)}
                required
              />
            )}
          </FormField>
          <Button type="submit">{t("apply")}</Button>
          {dateError ? (
            <p role="alert" className="w-full text-sm text-danger">
              {t("dateInvalid")}
            </p>
          ) : null}
        </form>
      ) : null}
      {count ? (
        <ActiveFilters
          filters={filters}
          options={options}
          featureLabel={featureLabel}
          onClear={() => onFilters(NO_FILTERS)}
        />
      ) : null}
    </div>
  );
}

/** What the filtered totals answer, named rather than counted. */
function ActiveFilters({
  filters,
  options,
  featureLabel,
  onClear,
}: {
  readonly filters: UsageFilters;
  readonly options: Options | null;
  readonly featureLabel: (feature: Feature) => string;
  readonly onClear: () => void;
}) {
  const t = useTranslations("AiUsage");
  const reportUser = options?.users.find((u) => u.id === filters.actorUserId);
  const reportWarehouse = options?.warehouses.find(
    (w) => w.id === filters.warehouseId,
  );
  // A selection outside the report's labelled dimensions is named by ID.
  const resolved = useDimensionLabels(
    filters.actorUserId && !reportUser ? [filters.actorUserId] : [],
    filters.warehouseId && !reportWarehouse ? [filters.warehouseId] : [],
  );
  const names = [
    filters.feature ? featureLabel(filters.feature) : null,
    filters.actorUserId
      ? (reportUser?.name ??
        resolved.user(filters.actorUserId) ??
        t("unknownUser"))
      : null,
    filters.warehouseId
      ? (reportWarehouse?.name ??
        resolved.warehouse(filters.warehouseId) ??
        t("unknownWarehouse"))
      : null,
    filters.requestedModel || null,
    filters.environment || null,
  ].filter((name): name is string => name !== null);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <p className="min-w-0 break-words text-muted">
        {t("filteredBy", { filters: names.join(" · ") })}
      </p>
      <Button variant="ghost" size="sm" onClick={onClear}>
        {t("filtersClear")}
      </Button>
    </div>
  );
}
