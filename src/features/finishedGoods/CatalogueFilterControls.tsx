"use client";
import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactNode,
} from "react";
import { Popover } from "radix-ui";
import { ArrowDown, ArrowUp, Filter, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { SelectControl } from "@/components/ui/SelectControl";
import { CheckboxControl } from "@/components/ui/CheckboxControl";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { DetailsPanel } from "@/components/ui/DetailsPanel";
import { useFGText } from "./shared";
import {
  clearColumn,
  columnCount,
  columns,
  columnSorts,
  filtersValid,
  formatOptions,
  newFilters,
  productStatuses,
  progressOptions,
  sortColumn,
  unitStatuses,
  type CatalogueFilters,
  type CatalogueTab,
  type FilterColumn,
  type Range,
} from "./catalogueFilters";

type Tr = (en: string, th: string) => string;
export function filterLabel(key: string, tab: CatalogueTab, tr: Tr): string {
  const labels: Record<string, [string, string]> = {
    record:
      tab === "products"
        ? ["Product", "สินค้า"]
        : ["Storage unit", "หน่วยจัดเก็บ"],
    quantity: ["Quantity", "จำนวน"],
    format: ["Format", "รูปแบบ"],
    progress: ["Progress", "ความคืบหน้า"],
    status: ["Status", "สถานะ"],
    dimensions: ["Dimensions (m)", "ขนาด (ม.)"],
    lot: ["Lot", "ล็อต"],
    name: ["Product name", "ชื่อสินค้า"],
    sku: ["SKU", "รหัสสินค้า"],
    code: ["Storage unit code", "รหัสหน่วยจัดเก็บ"],
    length: ["Length (m)", "ความยาว (ม.)"],
    width: ["Width (m)", "ความกว้าง (ม.)"],
    height: ["Height (m)", "ความสูง (ม.)"],
    stored: ["Stored", "จัดเก็บแล้ว"],
    awaitingStorage: ["Awaiting storage", "รอจัดเก็บ"],
    awaitingMeasurement: ["Awaiting measurement", "รอวัดขนาด"],
    moving: ["Moving", "กำลังย้าย"],
    empty: ["No units", "ยังไม่มีหน่วยจัดเก็บ"],
    PALLET: ["Pallets", "พาเลท"],
    BOX: ["Boxes", "กล่อง"],
    OTHER: ["Other storage units", "หน่วยจัดเก็บอื่น"],
    DRAFT: ["Draft", "ฉบับร่าง"],
    ACTIVE: ["Ready", "พร้อมใช้งาน"],
    AWAITING_MEASUREMENT: ["Awaiting measurement", "รอวัดขนาด"],
    AWAITING_PLACEMENT: ["Awaiting placement", "รอเลือกจุดจัดเก็บ"],
    RESERVED: ["Reserved", "จองแล้ว"],
    STORED: ["Stored", "จัดเก็บแล้ว"],
    MOVE_RESERVED: ["Move prepared", "เตรียมย้ายแล้ว"],
    IN_TRANSIT: ["Moving", "กำลังย้าย"],
    measured: ["Measured", "วัดขนาดแล้ว"],
    unmeasured: ["Not measured", "ยังไม่ได้วัด"],
  };
  const pair = labels[key];
  return pair ? tr(...pair) : key;
}
export type FilterControlsProps = {
  tab: CatalogueTab;
  filters: CatalogueFilters;
  units: readonly string[];
  onChange: (filters: CatalogueFilters) => void;
};
function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <FormField id={id} label={label}>
      {(field) =>
        isValidElement(children)
          ? cloneElement(
              children as React.ReactElement<Record<string, unknown>>,
              field,
            )
          : children
      }
    </FormField>
  );
}
function RangeFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Range;
  onChange: (value: Range) => void;
}) {
  const { t } = useFGText();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        {(["min", "max"] as const).map((k) => (
          <Field
            key={k}
            label={k === "min" ? t("copy.minimum") : t("copy.maximum")}
          >
            <Input
              aria-label={`${label} ${k === "min" ? t("copy.minimum-bf020a") : t("copy.maximum-3f2718")}`}
              type="number"
              min="0"
              step="any"
              value={value[k]}
              onChange={(e) => onChange({ ...value, [k]: e.target.value })}
            />
          </Field>
        ))}
      </div>
    </fieldset>
  );
}
function FilterFields({
  column,
  tab,
  filters: f,
  units,
  onChange,
}: FilterControlsProps & { column: FilterColumn }) {
  const { t, tr } = useFGText();
  const update = (value: Partial<CatalogueFilters>) =>
    onChange({ ...f, ...value });
  const choices = (
    key: "formats" | "progress" | "statuses",
    options: string[],
  ) => (
    <div className="grid gap-2">
      {options.map((value) => (
        <label
          key={value}
          className="flex min-h-touch cursor-pointer items-center gap-2 text-sm"
        >
          <CheckboxControl
            className="accent-primary"
            checked={f[key].includes(value)}
            onChange={(e) =>
              update({
                [key]: e.target.checked
                  ? [...f[key], value]
                  : f[key].filter((v) => v !== value),
              })
            }
          />
          {filterLabel(value, tab, tr)}
        </label>
      ))}
    </div>
  );
  return (
    <div className="space-y-4">
      {column === "record" && (
        <Field label={t("copy.name-or-sku")}>
          <Input
            value={f.record}
            maxLength={200}
            onChange={(e) => update({ record: e.target.value })}
          />
        </Field>
      )}
      {column === "quantity" && (
        <>
          <Field label={t("copy.counting-unit")}>
            <SelectControl
              label={t("copy.counting-unit")}
              value={f.unit}
              onValueChange={(unit) =>
                update({
                  unit,
                  ...(!unit ? { quantity: { min: "", max: "" } } : {}),
                })
              }
              options={[
                { value: "", label: t("copy.all-units") },
                ...[...new Set([...units, ...(f.unit ? [f.unit] : [])])].map(
                  (unit) => ({ value: unit, label: unit }),
                ),
              ]}
              placeholder={t("copy.all-units")}
              emptyLabel={t("copy.no-units-available")}
            />
          </Field>
          <RangeFields
            label={t("copy.quantity")}
            value={f.quantity}
            onChange={(quantity) => update({ quantity })}
          />
          <p className="text-xs text-muted">
            {t(
              "copy.choose-a-counting-unit-before-setting-a-range-sorting-groups-different-u",
            )}
          </p>
        </>
      )}
      {column === "format" && choices("formats", formatOptions)}
      {column === "progress" && (
        <>
          {choices("progress", progressOptions)}
          <p className="text-xs text-muted">
            {t(
              "copy.matches-products-with-at-least-one-unit-in-any-selected-state",
            )}
          </p>
        </>
      )}
      {column === "status" &&
        choices(
          "statuses",
          tab === "products" ? productStatuses : unitStatuses,
        )}
      {column === "lot" && (
        <Field label={t("copy.lot-contains")}>
          <Input
            value={f.lot}
            maxLength={200}
            onChange={(e) => update({ lot: e.target.value })}
          />
        </Field>
      )}
      {column === "dimensions" && (
        <>
          <Field label={t("copy.measurement")}>
            <SelectControl
              label={t("copy.measurement")}
              value={f.measurement}
              onValueChange={(measurement) => update({ measurement })}
              options={[
                { value: "", label: t("copy.all") },
                ...["measured", "unmeasured"].map((value) => ({
                  value,
                  label: filterLabel(value, tab, tr),
                })),
              ]}
              placeholder={t("copy.all")}
              emptyLabel={t("copy.no-measurements-available")}
            />
          </Field>
          {(["length", "width", "height"] as const).map((key) => (
            <RangeFields
              key={key}
              label={filterLabel(key, tab, tr)}
              value={f[key]}
              onChange={(range) => update({ [key]: range })}
            />
          ))}
        </>
      )}
      <Field label={t("copy.sort-by")}>
        <SelectControl
          label={t("copy.sort-by")}
          value={sortColumn(f.sort) === column ? f.sort : ""}
          onValueChange={(sort) => update({ sort })}
          options={[
            { value: "", label: t("copy.default-order") },
            ...columnSorts(column, tab).flatMap((key) =>
              (["asc", "desc"] as const).map((direction) => ({
                value: `${key}:${direction}`,
                label: `${filterLabel(key, tab, tr)} · ${
                  direction === "asc"
                    ? t("copy.ascending")
                    : t("copy.descending")
                }`,
              })),
            ),
          ]}
          placeholder={t("copy.default-order")}
          emptyLabel={t("copy.no-sort-options-available")}
        />
      </Field>
    </div>
  );
}
function FilterEditor({
  column,
  tab,
  filters,
  units,
  onChange,
  onClose,
}: FilterControlsProps & { column?: FilterColumn; onClose: () => void }) {
  const { t, tr } = useFGText();
  const [draft, setDraft] = useState(filters);
  const invalid = !filtersValid(draft);
  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) {
          onChange(draft);
          onClose();
        }
      }}
    >
      <div className="min-h-0 space-y-4 overflow-y-auto">
        {(column ? [column] : columns(tab)).map((c) => (
          <fieldset
            key={c}
            className={
              column
                ? "min-w-0"
                : "min-w-0 space-y-3 rounded-lg border border-border p-3"
            }
          >
            {!column && (
              <legend className="px-1 text-sm font-semibold">
                {filterLabel(c, tab, tr)}
              </legend>
            )}
            <FilterFields
              column={c}
              tab={tab}
              filters={draft}
              units={units}
              onChange={setDraft}
            />
          </fieldset>
        ))}
      </div>
      {invalid && (
        <p role="alert" className="text-sm text-danger">
          {t(
            "copy.use-non-negative-numbers-minimum-maximum-and-choose-a-counting-unit-for-",
          )}
        </p>
      )}
      <div className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-border bg-popover pt-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            setDraft(column ? clearColumn(draft, column) : newFilters())
          }
        >
          {t("copy.reset")}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("copy.cancel")}
          </Button>
          <Button type="submit" disabled={invalid}>
            {t("copy.apply")}
          </Button>
        </div>
      </div>
    </form>
  );
}
export function ColumnFilter({
  column,
  children,
  ...props
}: FilterControlsProps & { column: FilterColumn; children: ReactNode }) {
  const { t, tr } = useFGText();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const count = columnCount(props.filters, column);
  const sorted = sortColumn(props.filters.sort) === column;
  return (
    <div className="flex items-center gap-1">
      <span>{children}</span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button
            type="button"
            variant={count || sorted ? "active" : "ghost"}
            size="icon"
            className="inline-flex min-h-touch min-w-touch shrink-0 items-center justify-center gap-1 rounded-md focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={`${t("copy.filter-and-sort")} ${filterLabel(column, props.tab, tr)}`}
            title={`${t("copy.filter-and-sort")} ${filterLabel(column, props.tab, tr)}`}
          >
            <Filter className="size-3.5" aria-hidden="true" />
            {count > 0 && <span className="text-xs">{count}</span>}
            {sorted &&
              (props.filters.sort.endsWith(":desc") ? (
                <ArrowDown className="size-3" aria-hidden="true" />
              ) : (
                <ArrowUp className="size-3" aria-hidden="true" />
              ))}
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            collisionPadding={12}
            aria-labelledby={titleId}
            className="z-50 flex max-h-[min(80dvh,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
          >
            <h2
              id={titleId}
              className="mb-4 shrink-0 text-lg leading-7 font-semibold"
            >
              {filterLabel(column, props.tab, tr)}
            </h2>
            <FilterEditor
              {...props}
              column={column}
              onClose={() => setOpen(false)}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
export function CatalogueFiltersButton(props: FilterControlsProps) {
  const { t } = useFGText();
  const [open, setOpen] = useState(false);
  const count = columns(props.tab).reduce(
    (n, c) => n + columnCount(props.filters, c),
    0,
  );
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className={count ? "text-link" : ""}>
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          {t("copy.filters")}
          {count > 0 ? ` (${count})` : ""}
        </Button>
      </SheetTrigger>
      <DetailsPanel
        title={t("copy.filters-and-sorting")}
        description={t(
          "copy.different-columns-combine-select-any-matching-value-within-a-column",
        )}
        closeLabel={t("copy.close")}
      >
        <FilterEditor {...props} onClose={() => setOpen(false)} />
      </DetailsPanel>
    </Sheet>
  );
}
export function FilterChips({
  search,
  onClearSearch,
  onClearAll,
  ...props
}: FilterControlsProps & {
  search: string;
  onClearSearch: () => void;
  onClearAll: () => void;
}) {
  const { t, tr } = useFGText();
  const f = props.filters;
  const chip = (label: string, remove: () => void) => (
    <Button
      type="button"
      variant="ghost"
      size="touch"
      key={label}
      onClick={remove}
      className="inline-flex min-h-touch max-w-full items-center gap-2 rounded-full border border-border-strong bg-selected px-3 py-2 text-left text-xs text-selected-foreground outline-none hover:border-link focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${t("copy.remove-filter")} ${label}`}
    >
      <span className="break-words">{label}</span>
      <X className="size-3 shrink-0" aria-hidden="true" />
    </Button>
  );
  const rangeText = (r: Range) => `${r.min || "0"}–${r.max || "∞"}`;
  const content = (c: FilterColumn) =>
    c === "record"
      ? f.record
      : c === "quantity"
        ? `${f.quantity.min || f.quantity.max ? rangeText(f.quantity) + " " : ""}${f.unit}`
        : c === "lot"
          ? f.lot
          : c === "format"
            ? f.formats.map((v) => filterLabel(v, props.tab, tr)).join(", ")
            : c === "progress"
              ? f.progress.map((v) => filterLabel(v, props.tab, tr)).join(", ")
              : c === "status"
                ? f.statuses
                    .map((v) => filterLabel(v, props.tab, tr))
                    .join(", ")
                : [
                    f.measurement
                      ? filterLabel(f.measurement, props.tab, tr)
                      : "",
                    ...(["length", "width", "height"] as const)
                      .filter((k) => f[k].min || f[k].max)
                      .map(
                        (k) =>
                          `${filterLabel(k, props.tab, tr)} ${rangeText(f[k])}`,
                      ),
                  ]
                    .filter(Boolean)
                    .join(", ");
  if (!search && !columns(props.tab).some((c) => columnCount(f, c)) && !f.sort)
    return null;
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2"
      aria-label={t("copy.active-filters")}
      role="group"
    >
      {search && chip(`${t("copy.search")}: ${search}`, onClearSearch)}
      {columns(props.tab)
        .filter((c) => columnCount(f, c))
        .map((c) =>
          chip(`${filterLabel(c, props.tab, tr)}: ${content(c)}`, () =>
            props.onChange(clearColumn(f, c)),
          ),
        )}
      {f.sort &&
        chip(
          `${t("copy.sort")}: ${filterLabel(f.sort.split(":")[0] ?? "", props.tab, tr)} ${f.sort.endsWith(":desc") ? "↓" : "↑"}`,
          () => props.onChange({ ...f, sort: "" }),
        )}
      <Button variant="ghost" size="sm" onClick={onClearAll}>
        {t("copy.clear-all")}
      </Button>
    </div>
  );
}
