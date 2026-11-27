"use client";
import {
  cloneElement,
  isValidElement,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Popover } from "radix-ui";
import { ArrowDown, ArrowUp, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { SelectControl } from "@/components/ui/SelectControl";
import {
  CheckboxControl,
  choiceTargetClassName,
} from "@/components/ui/CheckboxControl";
import {
  Sheet,
  SheetTrigger,
  type SheetCompletionHandle,
} from "@/components/ui/sheet";
import { DetailsPanel } from "@/components/ui/DetailsPanel";
import { CollectionToolbar } from "@/components/system/CollectionToolbar";
import {
  AppliedFilterChip,
  ClearFilterButton,
  FilterTrigger,
} from "@/components/system/FilterActions";
import { useFGText } from "./shared";
import {
  activeConditions,
  clearColumn,
  clearCondition,
  clearConditions,
  columns,
  columnCount,
  columnSorts,
  conditionsOf,
  filtersValid,
  formatOptions,
  productStatuses,
  progressOptions,
  quantityNeedsUnit,
  rangeIssue,
  sortColumn,
  sortOptions,
  unitStatuses,
  type CatalogueFilters,
  type CatalogueTab,
  type FilterColumn,
  type FilterCondition,
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
    measurement: ["Measurement", "การวัดขนาด"],
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
              // Keep the control's own error wiring when the field has none.
              Object.fromEntries(
                Object.entries(field).filter(([, v]) => v !== undefined),
              ),
            )
          : children
      }
    </FormField>
  );
}
function RangeFields({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value: Range;
  error?: string | undefined;
  onChange: (value: Range) => void;
}) {
  const { t } = useFGText();
  const errorId = useId();
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
              inputMode="decimal"
              value={value[k]}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => onChange({ ...value, [k]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
function ConditionFields({
  condition,
  tab,
  filters: f,
  units,
  onChange,
}: FilterControlsProps & { condition: FilterCondition }) {
  const { t, tr } = useFGText();
  const name = useId();
  const update = (value: Partial<CatalogueFilters>) =>
    onChange({ ...f, ...value });
  const rangeError = (r: Range) => {
    const issue = rangeIssue(r);
    return issue === "number"
      ? t("copy.enter-zero-or-a-positive-number")
      : issue === "order"
        ? t("copy.maximum-must-be-at-least-the-minimum")
        : undefined;
  };
  const choices = (
    key: "formats" | "progress" | "statuses",
    options: string[],
  ) => (
    <div className="grid gap-1">
      {options.map((value) => (
        <label key={value} className={choiceTargetClassName}>
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
  if (condition === "record")
    return (
      <Field
        label={
          tab === "products"
            ? t("copy.name-or-sku")
            : t("copy.storage-unit-code-product-or-sku")
        }
      >
        <Input
          value={f.record}
          maxLength={200}
          onChange={(e) => update({ record: e.target.value })}
        />
      </Field>
    );
  if (condition === "quantity")
    return (
      <div className="space-y-4">
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
          error={
            rangeError(f.quantity) ??
            (quantityNeedsUnit(f)
              ? t("copy.choose-a-counting-unit-to-apply-this-range")
              : undefined)
          }
          onChange={(quantity) => update({ quantity })}
        />
        <p className="text-xs text-muted">
          {t(
            "copy.choose-a-counting-unit-before-setting-a-range-sorting-groups-different-u",
          )}
        </p>
      </div>
    );
  if (condition === "format") return choices("formats", formatOptions);
  if (condition === "progress")
    return (
      <div className="space-y-2">
        {choices("progress", progressOptions)}
        <p className="text-xs text-muted">
          {t(
            "copy.matches-products-with-at-least-one-unit-in-any-selected-state",
          )}
        </p>
      </div>
    );
  if (condition === "status")
    return choices(
      "statuses",
      tab === "products" ? productStatuses : unitStatuses,
    );
  if (condition === "lot")
    return (
      <Field label={t("copy.lot-contains")}>
        <Input
          value={f.lot}
          maxLength={200}
          onChange={(e) => update({ lot: e.target.value })}
        />
      </Field>
    );
  if (condition === "measurement")
    return (
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">{t("copy.measurement")}</legend>
        {["", "measured", "unmeasured"].map((value) => (
          <label key={value} className={choiceTargetClassName}>
            <input
              type="radio"
              name={name}
              className="size-4 shrink-0 accent-primary focus-ring"
              checked={f.measurement === value}
              onChange={() => update({ measurement: value })}
            />
            {value ? filterLabel(value, tab, tr) : t("copy.all")}
          </label>
        ))}
      </fieldset>
    );
  return (
    <RangeFields
      label={filterLabel(condition, tab, tr)}
      value={f[condition]}
      error={rangeError(f[condition])}
      onChange={(range) => update({ [condition]: range })}
    />
  );
}
function SortSelect({
  label,
  tab,
  column,
  value,
  onChange,
}: {
  label: string;
  tab: CatalogueTab;
  /** A table column limits the choices to that column's own sorts. */
  column?: FilterColumn;
  value: string;
  onChange: (sort: string) => void;
}) {
  const { t, tr } = useFGText();
  return (
    <SelectControl
      label={label}
      value={value}
      onValueChange={onChange}
      options={[
        { value: "", label: t("copy.default-order") },
        ...(column ? columnSorts(column, tab) : sortOptions(tab)).flatMap(
          (key) =>
            (["asc", "desc"] as const).map((direction) => ({
              value: `${key}:${direction}`,
              label: `${filterLabel(key, tab, tr)} · ${
                direction === "asc" ? t("copy.ascending") : t("copy.descending")
              }`,
            })),
        ),
      ]}
      placeholder={t("copy.default-order")}
      emptyLabel={t("copy.no-sort-options-available")}
    />
  );
}
/** The table column shortcut keeps that column's own sort beside its filters. */
type EditorScope =
  { column: FilterColumn } | { condition: FilterCondition } | "all";
function FilterEditor({
  scope,
  tab,
  filters,
  units,
  onChange,
  onClose,
}: FilterControlsProps & { scope: EditorScope; onClose: () => void }) {
  const { t, tr } = useFGText();
  const [draft, setDraft] = useState(filters);
  const invalid = !filtersValid(draft);
  const fields = (c: FilterCondition) => (
    <ConditionFields
      condition={c}
      tab={tab}
      filters={draft}
      units={units}
      onChange={setDraft}
    />
  );
  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) onChange(draft);
      }}
    >
      <div className="min-h-0 space-y-4 overflow-y-auto">
        {scope === "all" ? (
          columns(tab).map((c) => (
            <fieldset
              key={c}
              className="min-w-0 space-y-3 rounded-lg border border-border p-3"
            >
              <legend className="px-1 text-sm font-semibold">
                {filterLabel(c, tab, tr)}
              </legend>
              {conditionsOf(c).map((condition) => (
                <div key={condition}>{fields(condition)}</div>
              ))}
            </fieldset>
          ))
        ) : "condition" in scope ? (
          fields(scope.condition)
        ) : (
          <div className="min-w-0 space-y-4">
            {conditionsOf(scope.column).map((condition) => (
              <div key={condition}>{fields(condition)}</div>
            ))}
            <Field label={t("copy.sort-by")}>
              <SortSelect
                label={t("copy.sort-by")}
                tab={tab}
                column={scope.column}
                value={
                  sortColumn(draft.sort) === scope.column ? draft.sort : ""
                }
                onChange={(sort) => setDraft({ ...draft, sort })}
              />
            </Field>
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-border bg-popover pt-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            setDraft(
              scope === "all"
                ? clearConditions(draft)
                : "condition" in scope
                  ? clearCondition(draft, scope.condition)
                  : clearColumn(draft, scope.column),
            )
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
              scope={{ column }}
              onChange={(next) => {
                props.onChange(next);
                setOpen(false);
              }}
              onClose={() => setOpen(false)}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
function conditionText(
  f: CatalogueFilters,
  c: FilterCondition,
  tab: CatalogueTab,
  tr: Tr,
) {
  const range = (r: Range) =>
    r.min && r.max
      ? `${r.min}–${r.max}`
      : r.min
        ? `≥ ${r.min}`
        : r.max
          ? `≤ ${r.max}`
          : "";
  const names = (values: string[]) =>
    values.map((v) => filterLabel(v, tab, tr)).join(", ");
  if (c === "record" || c === "lot") return f[c];
  if (c === "quantity") return `${range(f.quantity)} ${f.unit}`.trim();
  if (c === "format") return names(f.formats);
  if (c === "progress") return names(f.progress);
  if (c === "status") return names(f.statuses);
  if (c === "measurement") return filterLabel(f.measurement, tab, tr);
  return `${range(f[c])} m`;
}
/**
 * The catalogue toolbar: search with its own clear action, the condition
 * count, a collective clear for two or more conditions, and one chip per
 * applied condition. Clearing filters keeps search, sort and layout.
 */
export function CatalogueFilterBar({
  search,
  onSearchChange,
  actions,
  ...props
}: FilterControlsProps & {
  search: string;
  onSearchChange: (search: string) => void;
  /** Sort and layout controls, which are not filter conditions. */
  actions?: ReactNode;
}) {
  const { t, tr } = useFGText();
  const [editing, setEditing] = useState<FilterCondition | "all" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const completion = useRef<SheetCompletionHandle>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const { tab, filters: f } = props;
  const applied = activeConditions(f, tab);
  const remove = (next: CatalogueFilters) => {
    props.onChange(next);
    trigger.current?.focus();
  };
  return (
    <>
      <CollectionToolbar
        className="mb-4"
        searchType="text"
        value={search}
        onValueChange={onSearchChange}
        searchLabel={t("copy.search-finished-goods")}
        placeholder={
          tab === "products"
            ? t("copy.search-name-or-sku")
            : t("copy.search-unit-code-product-sku-or-lot")
        }
        clearLabel={t("copy.clear-search-414314")}
        actions={
          <>
            <div className="flex items-center gap-1">
              <Sheet
                completionRef={completion}
                open={editing !== null}
                onOpenChange={(open) => {
                  if (open) {
                    returnFocus.current = null;
                    setEditing("all");
                  } else setEditing(null);
                }}
              >
                <SheetTrigger asChild>
                  <FilterTrigger
                    ref={trigger}
                    label={t("copy.filters")}
                    count={applied.length}
                  />
                </SheetTrigger>
                <DetailsPanel
                  title={
                    editing && editing !== "all"
                      ? filterLabel(editing, tab, tr)
                      : t("copy.filters")
                  }
                  description={t(
                    "copy.different-columns-combine-select-any-matching-value-within-a-column",
                  )}
                  closeLabel={t("copy.close")}
                  onCloseAutoFocus={(event) => {
                    if (returnFocus.current?.isConnected) {
                      event.preventDefault();
                      returnFocus.current.focus();
                    }
                  }}
                >
                  {editing !== null && (
                    <FilterEditor
                      {...props}
                      scope={editing === "all" ? "all" : { condition: editing }}
                      onChange={(next) =>
                        completion.current?.complete(() => props.onChange(next))
                      }
                      onClose={() =>
                        completion.current?.complete(() => setEditing(null))
                      }
                    />
                  )}
                </DetailsPanel>
              </Sheet>
              {applied.length > 1 && (
                <ClearFilterButton
                  label={t("copy.clear-all-filters")}
                  onClick={() => remove(clearConditions(f))}
                />
              )}
            </div>
            {actions}
          </>
        }
      />
      {applied.length > 0 && (
        <div
          className="mb-4 flex flex-wrap items-center gap-2"
          aria-label={t("copy.active-filters")}
          role="group"
        >
          {applied.map((c) => {
            const label = filterLabel(c, tab, tr);
            const value = conditionText(f, c, tab, tr);
            return (
              <AppliedFilterChip
                key={c}
                label={
                  <>
                    <span className="font-medium">{label}:</span> {value}
                  </>
                }
                editLabel={t("copy.edit-filter-value", { label, value })}
                removeLabel={t("copy.remove-filter", { label })}
                onEdit={() => {
                  returnFocus.current =
                    document.activeElement instanceof HTMLElement
                      ? document.activeElement
                      : null;
                  setEditing(c);
                }}
                onRemove={() => remove(clearCondition(f, c))}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
/** One sort for the whole tab; table column shortcuts offer their own. */
export function CatalogueSort({
  tab,
  value,
  onChange,
}: {
  tab: CatalogueTab;
  value: string;
  onChange: (sort: string) => void;
}) {
  const { t } = useFGText();
  return (
    <div className="w-56 max-w-full">
      <SortSelect
        label={t("copy.sort-order")}
        tab={tab}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
