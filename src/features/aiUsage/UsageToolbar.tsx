"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Download, SlidersHorizontal } from "lucide-react";

import { dayNumber } from "../../../convex/model/hr/calendar";
import { FEATURES, type Feature } from "../../../convex/model/aiUsage/usage";
import { Button } from "@/components/ui/button";
import { DetailsPanel } from "@/components/ui/DetailsPanel";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { SelectControl } from "@/components/ui/SelectControl";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
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
 * Period, report filters and CSV export. Filters live in a Sheet on every
 * width; they apply as they change, so the report behind updates live.
 */
export function UsageToolbar({
  period,
  onPeriod,
  range,
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
      <div className="flex flex-wrap items-end gap-3">
        <FormField
          id="usage-period"
          label={t("period")}
          srOnlyLabel
          className="w-full sm:w-56"
        >
          {(props) => (
            <SelectControl
              id={props.id}
              value={period}
              label={t("period")}
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
          )}
        </FormField>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className={count ? "text-link" : ""}>
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              {t("filters")}
              {count ? ` (${count})` : ""}
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
              {selector(
                "actorUserId",
                t("user"),
                options?.users.map((u) => ({ value: u.id, label: u.name })) ??
                  [],
              )}
              {selector(
                "warehouseId",
                t("warehouse"),
                options?.warehouses.map((w) => ({
                  value: w.id,
                  label: w.name,
                })) ?? [],
              )}
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
        <Button
          variant="outline"
          className="sm:ml-auto"
          onClick={onExport}
          disabled={!canExport || exporting}
        >
          <Download aria-hidden="true" className="size-4" />
          {t(exporting ? "exporting" : "export")}
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
  const names = [
    filters.feature ? featureLabel(filters.feature) : null,
    filters.actorUserId
      ? (options?.users.find((u) => u.id === filters.actorUserId)?.name ??
        t("unknownUser"))
      : null,
    filters.warehouseId
      ? (options?.warehouses.find((w) => w.id === filters.warehouseId)?.name ??
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
