"use client";

import { CalendarDays } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";

import { isIsoDate } from "../../../convex/model/hr/calendar";
import { FEATURES, type Feature } from "../../../convex/model/aiUsage/usage";
import {
  AppliedFilterChip,
  ClearFilterButton,
  FilterTrigger,
} from "@/components/system/FilterActions";
import { FilterDateField } from "@/components/system/FilterDateField";
import { Button } from "@/components/ui/button";
import { CollectionToolbar } from "@/components/system/CollectionToolbar";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DimensionFilter, useDimensionLabels } from "./DimensionFilter";
import {
  activeConditionCount,
  activeFilterCount,
  DEFAULT_CRITERIA,
  formatDateRangeLabel,
  presetDateRange,
  validateDateRange,
  type DateRange,
  type Period,
  type Report,
  type UsageCriteria,
  type UsageFilters,
} from "./report";

export type { DateRange, Period, UsageCriteria } from "./report";

type Options = Pick<Report, "users" | "warehouses" | "models" | "environments">;
type ConditionKey =
  | "period"
  | "feature"
  | "actorUserId"
  | "warehouseId"
  | "requestedModel"
  | "environment";
type EditorScope = "all" | ConditionKey;

interface DraftState {
  readonly period: Period;
  readonly from: string;
  readonly to: string;
  readonly filters: UsageFilters;
}

const SHORT_RADIO_LIMIT = 6;
const PERIOD_OPTIONS: readonly Period[] = ["month", "today", "week", "custom"];

function uniqueValues(
  values: readonly string[] | undefined,
  selected: string,
): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const item of values ?? []) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    ordered.push(item);
  }
  if (selected && !seen.has(selected)) ordered.unshift(selected);
  return ordered;
}

function RadioChoiceGroup({
  name,
  title,
  value,
  options,
  hideHeading = false,
  onChange,
}: {
  readonly name: string;
  readonly title: string;
  readonly value: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
    readonly disabled?: boolean;
  }[];
  readonly hideHeading?: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend
        className={hideHeading ? "sr-only" : "text-sm font-semibold text-text"}
      >
        {title}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={`inline-flex min-h-touch items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text has-checked:border-primary/40 has-checked:bg-accent-surface has-focus-visible:ring-2 has-focus-visible:ring-ring ${
              option.disabled
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer hover:bg-raised"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
              className="size-4 shrink-0 accent-primary"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function LocalChoiceFilter({
  name,
  title,
  searchLabel,
  value,
  values,
  hideHeading = false,
  onChange,
}: {
  readonly name: string;
  readonly title: string;
  readonly searchLabel: string;
  readonly value: string;
  readonly values: readonly string[];
  readonly hideHeading?: boolean;
  readonly onChange: (value: string) => void;
}) {
  const t = useTranslations("AiUsage");
  const [search, setSearch] = useState("");
  const allOptions = uniqueValues(values, value);
  if (allOptions.length <= SHORT_RADIO_LIMIT) {
    return (
      <RadioChoiceGroup
        name={name}
        title={title}
        value={value}
        hideHeading={hideHeading}
        options={[
          { value: "", label: t("all") },
          ...allOptions.map((item) => ({ value: item, label: item })),
        ]}
        onChange={onChange}
      />
    );
  }
  const needle = search.trim().toLocaleLowerCase();
  const matches = needle
    ? allOptions.filter((item) => item.toLocaleLowerCase().includes(needle))
    : allOptions;
  const selectedExcluded = Boolean(value) && !matches.includes(value);
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend
        className={hideHeading ? "sr-only" : "text-sm font-semibold text-text"}
      >
        {title}
      </legend>
      <CollectionToolbar
        value={search}
        onValueChange={setSearch}
        searchLabel={searchLabel}
        clearLabel={t("clearSearch")}
      />
      <div
        role="radiogroup"
        aria-label={title}
        className="max-h-52 divide-y divide-border overflow-y-auto rounded-md border border-border bg-surface"
      >
        <label className="flex min-h-touch cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-text hover:bg-raised has-checked:bg-accent-surface has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-inset">
          <input
            type="radio"
            name={name}
            value=""
            checked={value === ""}
            onChange={() => onChange("")}
            className="size-4 shrink-0 accent-primary"
          />
          <span className="min-w-0 break-words">{t("all")}</span>
        </label>
        {selectedExcluded ? (
          <label className="flex min-h-touch cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-text hover:bg-raised has-checked:bg-accent-surface has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-inset">
            <input
              type="radio"
              name={name}
              value={value}
              checked
              onChange={() => onChange(value)}
              className="size-4 shrink-0 accent-primary"
            />
            <span className="min-w-0 break-words">{value}</span>
          </label>
        ) : null}
        {matches.map((item) => (
          <label
            key={item}
            className="flex min-h-touch cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-text hover:bg-raised has-checked:bg-accent-surface has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-inset"
          >
            <input
              type="radio"
              name={name}
              value={item}
              checked={value === item}
              onChange={() => onChange(item)}
              className="size-4 shrink-0 accent-primary"
            />
            <span className="min-w-0 break-words">{item}</span>
          </label>
        ))}
        {matches.length === 0 ? (
          <p role="status" className="px-3 py-2 text-sm text-muted">
            {t("optionsNoMatch")}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}

/**
 * Period shortcut, filter sheet trigger, applied condition chips and the
 * answered range in the organization's timezone. Compound filter changes stay
 * in a draft until Apply; Cancel, Escape, close or Back discards them.
 */
export function UsageToolbar({
  period,
  dates,
  range,
  timezone,
  now,
  filters,
  onApply,
  options,
  featureLabel,
}: {
  readonly period: Period;
  readonly dates: DateRange | null;
  /** The range the report currently answers, used as the date defaults. */
  readonly range: DateRange | null;
  /** The organization timezone the range is in, once the report answers. */
  readonly timezone: string | null;
  /** Report clock instant in ms, aligned with the screen's refresh tick. */
  readonly now: number;
  readonly filters: UsageFilters;
  readonly onApply: (criteria: UsageCriteria) => void;
  readonly options: Options | null;
  readonly featureLabel: (feature: Feature) => string;
}) {
  const t = useTranslations("AiUsage"),
    locale = useLocale();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<EditorScope>("all");
  const [draft, setDraft] = useState<DraftState>(() => ({
    period,
    from: dates?.from ?? range?.from ?? "",
    to: dates?.to ?? range?.to ?? "",
    filters,
  }));
  const [rememberedUsers, setRememberedUsers] = useState<
    Readonly<Record<string, string>>
  >({});
  const [rememberedWarehouses, setRememberedWarehouses] = useState<
    Readonly<Record<string, string>>
  >({});
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const filterTriggerRef = useRef<HTMLButtonElement | null>(null);

  const conditionCount = activeConditionCount(period, filters);

  const reportUser = options?.users.find((u) => u.id === filters.actorUserId);
  const reportWarehouse = options?.warehouses.find(
    (w) => w.id === filters.warehouseId,
  );
  const resolved = useDimensionLabels(
    filters.actorUserId && !reportUser && !rememberedUsers[filters.actorUserId]
      ? [filters.actorUserId]
      : [],
    filters.warehouseId &&
      !reportWarehouse &&
      !rememberedWarehouses[filters.warehouseId]
      ? [filters.warehouseId]
      : [],
  );

  const periodText = (
    targetPeriod: Period,
    targetDates: DateRange | null,
  ): string => {
    if (targetPeriod === "custom") {
      const from = targetDates?.from ?? range?.from ?? "";
      const to = targetDates?.to ?? range?.to ?? "";
      return from && to ? formatDateRangeLabel(from, to, locale) : t("custom");
    }
    if (targetPeriod === "today") return t("today");
    if (targetPeriod === "week") return t("week");
    return t("month");
  };

  function buildInitialDraft(): DraftState {
    const preset =
      period === "custom" ? null : presetDateRange(period, timezone, now);
    const from =
      period === "custom" && dates
        ? dates.from
        : (range?.from ?? preset?.from ?? "");
    const to =
      period === "custom" && dates ? dates.to : (range?.to ?? preset?.to ?? "");
    return { period, from, to, filters };
  }

  function openEditor(nextScope: EditorScope, trigger: HTMLElement | null) {
    returnFocusRef.current = trigger;
    setScope(nextScope);
    setDraft(buildInitialDraft());
    setOpen(true);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && !open) setDraft(buildInitialDraft());
    setOpen(nextOpen);
  }

  function setDraftPeriod(nextPeriod: Period) {
    if (nextPeriod === "custom") {
      setDraft((current) => ({ ...current, period: "custom" }));
      return;
    }
    const preset = presetDateRange(nextPeriod, timezone, now);
    setDraft((current) => ({
      ...current,
      period: nextPeriod,
      ...(preset ? { from: preset.from, to: preset.to } : {}),
    }));
  }

  function setDraftDate(field: "from" | "to", value: string) {
    setDraft((current) => ({
      ...current,
      period: "custom",
      [field]: value,
    }));
  }

  function setDraftFilters(patch: Partial<UsageFilters>) {
    setDraft((current) => ({
      ...current,
      filters: { ...current.filters, ...patch },
    }));
  }

  const periodErrorCode =
    draft.period === "custom" ? validateDateRange(draft.from, draft.to) : null;
  const periodError =
    periodErrorCode === "required"
      ? t("dateRequired")
      : periodErrorCode === "format"
        ? t("dateFormat")
        : periodErrorCode === "order"
          ? t("dateOrder")
          : periodErrorCode === "limit"
            ? t("dateRangeLimit")
            : null;

  const weekUnavailable = !presetDateRange("week", timezone, now);
  const applyDisabled =
    Boolean(periodError) || (draft.period === "week" && weekUnavailable);

  function handleApply(event: FormEvent) {
    event.preventDefault();
    if (applyDisabled) return;
    const from = draft.from.trim(),
      to = draft.to.trim();
    const nextDates = draft.period === "custom" ? { from, to } : null;
    onApply({
      period: draft.period,
      dates: nextDates,
      filters: draft.filters,
    });
    setOpen(false);
  }

  function clearCondition(key: ConditionKey) {
    if (key === "period") {
      onApply({ period: "month", dates: null, filters });
    } else {
      onApply({ period, dates, filters: { ...filters, [key]: "" } });
    }
    filterTriggerRef.current?.focus();
  }

  function clearAll() {
    onApply(DEFAULT_CRITERIA);
    filterTriggerRef.current?.focus();
  }

  const userLabel = filters.actorUserId
    ? (reportUser?.name ??
      rememberedUsers[filters.actorUserId] ??
      resolved.user(filters.actorUserId) ??
      (resolved.loading ? "…" : t("unknownUser")))
    : "";
  const warehouseLabel = filters.warehouseId
    ? (reportWarehouse?.name ??
      rememberedWarehouses[filters.warehouseId] ??
      resolved.warehouse(filters.warehouseId) ??
      (resolved.loading ? "…" : t("unknownWarehouse")))
    : "";

  const chips: readonly {
    readonly key: ConditionKey;
    readonly field: string;
    readonly value: string;
  }[] = [
    ...(filters.feature
      ? [
          {
            key: "feature" as const,
            field: t("feature"),
            value: featureLabel(filters.feature),
          },
        ]
      : []),
    ...(filters.actorUserId
      ? [{ key: "actorUserId" as const, field: t("user"), value: userLabel }]
      : []),
    ...(filters.warehouseId
      ? [
          {
            key: "warehouseId" as const,
            field: t("warehouse"),
            value: warehouseLabel,
          },
        ]
      : []),
    ...(filters.requestedModel
      ? [
          {
            key: "requestedModel" as const,
            field: t("model"),
            value: filters.requestedModel,
          },
        ]
      : []),
    ...(filters.environment
      ? [
          {
            key: "environment" as const,
            field: t("environment"),
            value: filters.environment,
          },
        ]
      : []),
  ];

  const sectionTitle: Readonly<Record<EditorScope, string>> = {
    all: t("filtersTitle"),
    period: t("period"),
    feature: t("feature"),
    actorUserId: t("user"),
    warehouseId: t("warehouse"),
    requestedModel: t("model"),
    environment: t("environment"),
  };

  const periodLabel = periodText(period, dates);
  const showAnsweredRange =
    range &&
    (period !== "custom" ||
      range.from !== dates?.from ||
      range.to !== dates?.to);
  const singleSection = scope !== "all";
  const showSection = (key: ConditionKey) => scope === "all" || scope === key;
  const highlightRange =
    isIsoDate(draft.from) && isIsoDate(draft.to) && draft.from <= draft.to
      ? { rangeStart: draft.from, rangeEnd: draft.to }
      : {};

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-3">
        <div className="inline-flex max-w-full items-center">
          <Button
            type="button"
            variant="outline"
            aria-label={
              period !== "month"
                ? t("editFilter", { field: t("period"), value: periodLabel })
                : undefined
            }
            aria-haspopup="dialog"
            onClick={(event) => openEditor("period", event.currentTarget)}
            className="max-w-full justify-start text-left"
          >
            <CalendarDays
              aria-hidden="true"
              className="size-4 shrink-0 text-muted"
            />
            <span className="truncate">
              {t("period")} · {periodLabel}
            </span>
          </Button>
          {period !== "month" && (
            <ClearFilterButton
              label={t("removeFilter", { field: t("period") })}
              onClick={() => clearCondition("period")}
            />
          )}
        </div>
        <div className="inline-flex items-center">
          <FilterTrigger
            ref={filterTriggerRef}
            label={t("filters")}
            count={conditionCount}
            aria-haspopup="dialog"
            onClick={(event) => openEditor("all", event.currentTarget)}
          />
          {conditionCount > 1 ? (
            <ClearFilterButton
              label={t("filtersClearAll")}
              onClick={clearAll}
            />
          ) : null}
        </div>
        {range ? (
          <p
            className="order-last flex w-full flex-wrap items-center gap-x-2 text-sm text-muted tabular-nums sm:order-none sm:ml-auto sm:w-auto sm:justify-end"
            data-testid="usage-range"
          >
            {showAnsweredRange && (
              <span>{formatDateRangeLabel(range.from, range.to, locale)}</span>
            )}
            {timezone ? (
              <>
                {showAnsweredRange && <span aria-hidden="true">·</span>}
                <span>{timezone}</span>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      {activeFilterCount(filters) > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={t("activeFilters")}
        >
          {chips.map((chip) => (
            <AppliedFilterChip
              key={chip.key}
              label={
                <span>
                  <span className="font-medium">{chip.field}</span>{" "}
                  <span className="font-normal">{chip.value}</span>
                </span>
              }
              editLabel={t("editFilter", {
                field: chip.field,
                value: chip.value,
              })}
              removeLabel={t("removeFilter", { field: chip.field })}
              onEdit={() =>
                openEditor(
                  chip.key,
                  document.activeElement instanceof HTMLElement
                    ? document.activeElement
                    : null,
                )
              }
              onRemove={() => clearCondition(chip.key)}
            />
          ))}
        </div>
      ) : null}

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          closeLabel={t("filtersClose")}
          className="w-full gap-0 p-0 data-[side=right]:w-full sm:max-w-md"
          onCloseAutoFocus={(event) => {
            const target = returnFocusRef.current;
            returnFocusRef.current = null;
            if (target && target.isConnected) {
              event.preventDefault();
              target.focus();
            } else if (filterTriggerRef.current) {
              event.preventDefault();
              filterTriggerRef.current.focus();
            }
          }}
        >
          <SheetHeader className="shrink-0 border-b border-border px-4 py-3 pr-14">
            <SheetTitle>{sectionTitle[scope]}</SheetTitle>
            <SheetDescription className={singleSection ? "sr-only" : undefined}>
              {t("filtersDescription")}
            </SheetDescription>
          </SheetHeader>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleApply}>
            <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto px-4">
              {showSection("period") ? (
                <div className="space-y-3 py-4">
                  <RadioChoiceGroup
                    name="usage-filter-period"
                    title={t("period")}
                    value={draft.period}
                    hideHeading={singleSection}
                    options={PERIOD_OPTIONS.map((value) => ({
                      value,
                      label:
                        value === "month"
                          ? t("month")
                          : value === "today"
                            ? t("today")
                            : value === "week"
                              ? t("week")
                              : t("custom"),
                      disabled: value === "week" && weekUnavailable,
                    }))}
                    onChange={(value) => setDraftPeriod(value as Period)}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FilterDateField
                      id="usage-from"
                      label={t("from")}
                      value={draft.from}
                      onChange={(value) => setDraftDate("from", value)}
                      invalid={Boolean(periodError)}
                      describedBy={
                        periodError
                          ? "usage-period-hint usage-period-error"
                          : "usage-period-hint"
                      }
                      {...highlightRange}
                    />
                    <FilterDateField
                      id="usage-to"
                      label={t("to")}
                      value={draft.to}
                      onChange={(value) => setDraftDate("to", value)}
                      invalid={Boolean(periodError)}
                      describedBy={
                        periodError
                          ? "usage-period-hint usage-period-error"
                          : "usage-period-hint"
                      }
                      {...highlightRange}
                    />
                  </div>
                  <p id="usage-period-hint" className="text-xs text-muted">
                    {timezone
                      ? t("dateHint", { timezone })
                      : t("dateHintNoZone")}
                  </p>
                  {periodError ? (
                    <p
                      id="usage-period-error"
                      role="alert"
                      className="text-sm font-medium text-danger"
                    >
                      {periodError}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {showSection("feature") ? (
                <div className="py-4">
                  <RadioChoiceGroup
                    name="usage-filter-feature"
                    title={t("feature")}
                    value={draft.filters.feature}
                    hideHeading={singleSection}
                    options={[
                      { value: "", label: t("all") },
                      ...FEATURES.map((kind) => ({
                        value: kind,
                        label: featureLabel(kind),
                      })),
                    ]}
                    onChange={(value) =>
                      setDraftFilters({ feature: value as "" | Feature })
                    }
                  />
                </div>
              ) : null}
              {showSection("actorUserId") ? (
                <div className="py-4">
                  {/* Every member is reachable, not only those the report could label within its bounded lookup. */}
                  <DimensionFilter
                    kind="actor"
                    title={t("user")}
                    value={draft.filters.actorUserId}
                    knownLabel={
                      rememberedUsers[draft.filters.actorUserId] ??
                      options?.users.find(
                        (u) => u.id === draft.filters.actorUserId,
                      )?.name
                    }
                    hideHeading={singleSection}
                    onChange={(value, label) => {
                      if (value && label)
                        setRememberedUsers((current) =>
                          current[value] === label
                            ? current
                            : { ...current, [value]: label },
                        );
                      setDraftFilters({ actorUserId: value });
                    }}
                  />
                </div>
              ) : null}
              {showSection("warehouseId") ? (
                <div className="py-4">
                  <DimensionFilter
                    kind="warehouse"
                    title={t("warehouse")}
                    value={draft.filters.warehouseId}
                    knownLabel={
                      rememberedWarehouses[draft.filters.warehouseId] ??
                      options?.warehouses.find(
                        (w) => w.id === draft.filters.warehouseId,
                      )?.name
                    }
                    hideHeading={singleSection}
                    onChange={(value, label) => {
                      if (value && label)
                        setRememberedWarehouses((current) =>
                          current[value] === label
                            ? current
                            : { ...current, [value]: label },
                        );
                      setDraftFilters({ warehouseId: value });
                    }}
                  />
                </div>
              ) : null}
              {showSection("requestedModel") ? (
                <div className="py-4">
                  <LocalChoiceFilter
                    name="usage-filter-requestedModel"
                    title={t("model")}
                    searchLabel={t("searchModels")}
                    value={draft.filters.requestedModel}
                    values={options?.models ?? []}
                    hideHeading={singleSection}
                    onChange={(value) =>
                      setDraftFilters({ requestedModel: value })
                    }
                  />
                </div>
              ) : null}
              {showSection("environment") ? (
                <div className="py-4">
                  <LocalChoiceFilter
                    name="usage-filter-environment"
                    title={t("environment")}
                    searchLabel={t("searchEnvironments")}
                    value={draft.filters.environment}
                    values={options?.environments ?? []}
                    hideHeading={singleSection}
                    onChange={(value) =>
                      setDraftFilters({ environment: value })
                    }
                  />
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
              <SheetClose asChild>
                <Button type="button" variant="outline">
                  {t("filtersCancel")}
                </Button>
              </SheetClose>
              <Button type="submit" disabled={applyDisabled}>
                {t("filtersApply")}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
