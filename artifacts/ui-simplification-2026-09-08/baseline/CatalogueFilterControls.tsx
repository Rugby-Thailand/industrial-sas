"use client";
import { useId, useState, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { ArrowDown, ArrowUp, Filter, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
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
  units: string[];
  onChange: (filters: CatalogueFilters) => void;
};
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}
const selectClass =
  "h-10 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm text-text";
function RangeFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Range;
  onChange: (value: Range) => void;
}) {
  const { tr } = useFGText();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        {(["min", "max"] as const).map((k) => (
          <Field
            key={k}
            label={
              k === "min" ? tr("Minimum", "ต่ำสุด") : tr("Maximum", "สูงสุด")
            }
          >
            <Input
              aria-label={`${label} ${k === "min" ? tr("minimum", "ต่ำสุด") : tr("maximum", "สูงสุด")}`}
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
  const { tr } = useFGText();
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
          className="flex min-h-9 cursor-pointer items-center gap-2 text-sm"
        >
          <input
            type="checkbox"
            className="size-4 accent-primary"
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
        <Field label={tr("Name or SKU", "ชื่อหรือรหัสสินค้า")}>
          <Input
            value={f.record}
            maxLength={200}
            onChange={(e) => update({ record: e.target.value })}
          />
        </Field>
      )}
      {column === "quantity" && (
        <>
          <Field label={tr("Counting unit", "หน่วยนับ")}>
            <select
              className={selectClass}
              value={f.unit}
              onChange={(e) =>
                update({
                  unit: e.target.value,
                  ...(!e.target.value
                    ? { quantity: { min: "", max: "" } }
                    : {}),
                })
              }
            >
              <option value="">{tr("All units", "ทุกหน่วยนับ")}</option>
              {[...new Set([...units, ...(f.unit ? [f.unit] : [])])].map(
                (u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ),
              )}
            </select>
          </Field>
          <RangeFields
            label={tr("Quantity", "จำนวน")}
            value={f.quantity}
            onChange={(quantity) => update({ quantity })}
          />
          <p className="text-xs text-muted">
            {tr(
              "Choose a counting unit before setting a range. Sorting groups different units separately.",
              "เลือกหน่วยนับก่อนกำหนดช่วงจำนวน การเรียงจำนวนจะแยกกลุ่มตามหน่วยนับ",
            )}
          </p>
        </>
      )}
      {column === "format" && choices("formats", formatOptions)}
      {column === "progress" && (
        <>
          {choices("progress", progressOptions)}
          <p className="text-xs text-muted">
            {tr(
              "Matches products with at least one unit in any selected state.",
              "แสดงสินค้าที่มีอย่างน้อยหนึ่งหน่วยตรงกับสถานะที่เลือก",
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
        <Field label={tr("Lot contains", "ล็อตมีข้อความ")}>
          <Input
            value={f.lot}
            maxLength={200}
            onChange={(e) => update({ lot: e.target.value })}
          />
        </Field>
      )}
      {column === "dimensions" && (
        <>
          <Field label={tr("Measurement", "การวัดขนาด")}>
            <select
              className={selectClass}
              value={f.measurement}
              onChange={(e) => update({ measurement: e.target.value })}
            >
              <option value="">{tr("All", "ทั้งหมด")}</option>
              {["measured", "unmeasured"].map((v) => (
                <option key={v} value={v}>
                  {filterLabel(v, tab, tr)}
                </option>
              ))}
            </select>
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
      <Field label={tr("Sort by", "เรียงตาม")}>
        <select
          className={selectClass}
          value={sortColumn(f.sort) === column ? f.sort : ""}
          onChange={(e) => update({ sort: e.target.value })}
        >
          <option value="">{tr("Default order", "ลำดับเริ่มต้น")}</option>
          {columnSorts(column, tab).flatMap((key) =>
            (["asc", "desc"] as const).map((direction) => (
              <option key={`${key}:${direction}`} value={`${key}:${direction}`}>
                {filterLabel(key, tab, tr)} ·{" "}
                {direction === "asc"
                  ? tr("Ascending", "น้อยไปมาก / ก–ฮ")
                  : tr("Descending", "มากไปน้อย / ฮ–ก")}
              </option>
            )),
          )}
        </select>
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
  const { tr } = useFGText();
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
          {tr(
            "Use non-negative numbers, minimum ≤ maximum, and choose a counting unit for quantity ranges.",
            "ระบุตัวเลขตั้งแต่ศูนย์ขึ้นไป โดยค่าต่ำสุดไม่เกินค่าสูงสุด และเลือกหน่วยนับสำหรับช่วงจำนวน",
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
          {tr("Reset", "รีเซ็ต")}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tr("Cancel", "ยกเลิก")}
          </Button>
          <Button type="submit" disabled={invalid}>
            {tr("Apply", "ใช้ตัวกรอง")}
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
  const { tr } = useFGText();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const count = columnCount(props.filters, column);
  const sorted = sortColumn(props.filters.sort) === column;
  return (
    <div className="flex items-center gap-1">
      <span>{children}</span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            className={`inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-md hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-ring ${count || sorted ? "text-primary" : "text-muted"}`}
            aria-label={`${tr("Filter and sort", "กรองและเรียง")} ${filterLabel(column, props.tab, tr)}`}
            title={`${tr("Filter and sort", "กรองและเรียง")} ${filterLabel(column, props.tab, tr)}`}
          >
            <Filter className="size-3.5" aria-hidden="true" />
            {count > 0 && <span className="text-xs">{count}</span>}
            {sorted &&
              (props.filters.sort.endsWith(":desc") ? (
                <ArrowDown className="size-3" aria-hidden="true" />
              ) : (
                <ArrowUp className="size-3" aria-hidden="true" />
              ))}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            collisionPadding={12}
            aria-labelledby={titleId}
            className="z-50 flex max-h-[min(80dvh,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
          >
            <h2 id={titleId} className="mb-4 shrink-0 font-semibold">
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
  const { tr } = useFGText();
  const [open, setOpen] = useState(false);
  const count = columns(props.tab).reduce(
    (n, c) => n + columnCount(props.filters, c),
    0,
  );
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className={count ? "text-primary" : ""}>
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          {tr("Filters", "ตัวกรอง")}
          {count > 0 ? ` (${count})` : ""}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        closeLabel={tr("Close", "ปิด")}
        className="max-w-md p-4 data-[side=right]:w-full"
      >
        <SheetHeader className="p-0 pr-10">
          <SheetTitle>
            {tr("Filters and sorting", "ตัวกรองและการเรียง")}
          </SheetTitle>
          <SheetDescription>
            {tr(
              "Different columns combine. Select any matching value within a column.",
              "ใช้เงื่อนไขทุกคอลัมน์ร่วมกัน โดยตรงกับตัวเลือกใดตัวเลือกหนึ่งภายในคอลัมน์",
            )}
          </SheetDescription>
        </SheetHeader>
        <FilterEditor {...props} onClose={() => setOpen(false)} />
      </SheetContent>
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
  const { tr } = useFGText();
  const f = props.filters;
  const chip = (label: string, remove: () => void) => (
    <button
      key={label}
      onClick={remove}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-left text-xs text-text hover:bg-primary/20"
      aria-label={`${tr("Remove filter", "ลบตัวกรอง")} ${label}`}
    >
      <span className="break-words">{label}</span>
      <X className="size-3 shrink-0" aria-hidden="true" />
    </button>
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
      aria-label={tr("Active filters", "ตัวกรองที่ใช้")}
      role="group"
    >
      {search && chip(`${tr("Search", "ค้นหา")}: ${search}`, onClearSearch)}
      {columns(props.tab)
        .filter((c) => columnCount(f, c))
        .map((c) =>
          chip(`${filterLabel(c, props.tab, tr)}: ${content(c)}`, () =>
            props.onChange(clearColumn(f, c)),
          ),
        )}
      {f.sort &&
        chip(
          `${tr("Sort", "เรียง")}: ${filterLabel(f.sort.split(":")[0] ?? "", props.tab, tr)} ${f.sort.endsWith(":desc") ? "↓" : "↑"}`,
          () => props.onChange({ ...f, sort: "" }),
        )}
      <Button variant="ghost" size="sm" onClick={onClearAll}>
        {tr("Clear all", "ล้างทั้งหมด")}
      </Button>
    </div>
  );
}
