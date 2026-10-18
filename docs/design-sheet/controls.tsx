import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { CalendarIcon, ClockIcon } from "lucide-react";
import { SelectControl } from "./ui/select-control";
import { Calendar, civilValue } from "./ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import "./controls.css";

/*
 * React islands for the standalone sheet. Hidden form sources keep the
 * existing synthetic draft handlers; the visible controls are shadcn/Radix
 * compositions. Source attributes describe each specimen's state:
 *   disabled, required, readonly, aria-invalid, aria-describedby,
 *   data-sheet-pending, data-sheet-readonly (select), data-sheet-clearable,
 *   data-sheet-min / data-sheet-max (example-only date bounds).
 */
type Source = HTMLInputElement | HTMLSelectElement;
type Entry = {
  source: Source;
  root: Root;
  host: HTMLElement;
  labels: HTMLLabelElement[];
};
const entries = new Map<Source, Entry>();

// A fixed synthetic "today" keeps the preview reproducible. The application
// supplies the organisation's business date instead of the browser clock.
export const PREVIEW_TODAY = "2026-10-14";

const copy = {
  en: {
    pickDate: "Pick a date",
    pickTime: "Pick a time",
    clearDate: "Clear date",
    clearTime: "Clear time",
    done: "Done",
    hour: "Hour",
    minute: "Minute",
    incomplete: "Choose both hour and minute.",
    noOptions: "No options",
  },
  th: {
    pickDate: "เลือกวันที่",
    pickTime: "เลือกเวลา",
    clearDate: "ล้างวันที่",
    clearTime: "ล้างเวลา",
    done: "เสร็จ",
    hour: "ชั่วโมง",
    minute: "นาที",
    incomplete: "เลือกทั้งชั่วโมงและนาที",
    noOptions: "ไม่มีตัวเลือก",
  },
};
type Copy = (typeof copy)["en"];

// Civil dates never pass through UTC. Locale changes display only, not the value.
export function parseCivilDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : undefined;
}

// Only complete 24-hour HH:mm is a time. Anything else is treated as empty.
export function parseTime(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? { hour: match[1] ?? "", minute: match[2] ?? "" } : undefined;
}

// Thai shows Buddhist years with Latin digits; values stay Gregorian.
export const formatCivilDate = (date: Date, thai: boolean) =>
  new Intl.DateTimeFormat(thai ? "th-TH-u-ca-buddhist-nu-latn" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);

function commit(source: Source, value: string) {
  // Existing specimen listeners own the draft. Finish React's event before a
  // language/state change replaces and unmounts the surrounding vanilla HTML.
  queueMicrotask(() => {
    if (!source.isConnected) return;
    source.value = value;
    source.dispatchEvent(
      new Event(source instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
    refresh();
  });
}

type Field = {
  id: string;
  label: string;
  thai: boolean;
  value: string;
  disabled: boolean;
  pending: boolean;
  invalid: boolean;
  required: boolean;
  clearable: boolean;
  describedBy: string | undefined;
  min: string | undefined;
  max: string | undefined;
  onCommit: (value: string) => void;
};

/* Shared trigger attributes; Radix PopoverTrigger adds haspopup/expanded. */
function triggerProps(field: Field, text: string, empty: boolean) {
  return {
    type: "button" as const,
    id: field.id,
    className: "sheet-field-trigger",
    disabled: field.disabled,
    "aria-label": `${field.label}: ${text}`,
    ...(field.describedBy ? { "aria-describedby": field.describedBy } : {}),
    ...(field.invalid ? { "aria-invalid": true as const } : {}),
    ...(field.pending
      ? { "aria-busy": true as const, "aria-disabled": true as const }
      : {}),
    ...(empty ? { "data-placeholder": "" } : {}),
  };
}

function ReadOnlyField({
  field,
  text,
  icon,
}: {
  field: Field;
  text: string;
  icon?: "date" | "time";
}) {
  return (
    <span className="sheet-readonly-field">
      <input
        id={field.id}
        type="text"
        readOnly
        value={text}
        className="sheet-field-trigger sheet-readonly"
        {...(field.describedBy
          ? { "aria-describedby": field.describedBy }
          : {})}
      />
      {icon === "date" ? <CalendarIcon aria-hidden="true" /> : null}
      {icon === "time" ? <ClockIcon aria-hidden="true" /> : null}
    </span>
  );
}

function DateField({ field, t }: { field: Field; t: Copy }) {
  const [open, setOpen] = useState(false);
  const locked = field.disabled || field.pending;
  // A field that becomes locked closes; its popup never reopens by itself.
  if (locked && open) setOpen(false);
  const date = parseCivilDate(field.value);
  const today = parseCivilDate(PREVIEW_TODAY) ?? new Date(2026, 9, 14, 12);
  const min = parseCivilDate(field.min ?? "");
  const max = parseCivilDate(field.max ?? "");
  const bounds = [
    ...(min ? [{ before: min }] : []),
    ...(max ? [{ after: max }] : []),
  ];
  const text = date ? formatCivilDate(date, field.thai) : t.pickDate;
  return (
    <Popover open={open} onOpenChange={(next) => setOpen(next && !locked)}>
      <PopoverTrigger asChild>
        <button {...triggerProps(field, text, !date)}>
          <span>{text}</span>
          <CalendarIcon aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="sheet-picker-content"
        collisionPadding={12}
        aria-label={field.label}
      >
        <Calendar
          thai={field.thai}
          selected={date}
          defaultMonth={date ?? min ?? today}
          today={today}
          autoFocus
          {...(bounds.length ? { disabled: bounds } : {})}
          {...(min ? { startMonth: min } : {})}
          {...(max ? { endMonth: max } : {})}
          onSelect={(next) => {
            field.onCommit(civilValue(next));
            setOpen(false);
          }}
        />
        {field.clearable && date ? (
          <button
            type="button"
            className="btn quiet sheet-picker-clear"
            onClick={() => {
              field.onCommit("");
              setOpen(false);
            }}
          >
            {t.clearDate}
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

const timeOptions = (count: number) =>
  Array.from({ length: count }, (_, i) => {
    const value = String(i).padStart(2, "0");
    return { value, label: value };
  });
const HOURS = timeOptions(24);
const MINUTES = timeOptions(60);

function TimeField({ field, t }: { field: Field; t: Copy }) {
  const [open, setOpen] = useState(false);
  // Hour and minute are a popup draft. Only Done commits; Escape, an outside
  // click or a lock discards it, and the next open starts from the value.
  const [draft, setDraft] = useState({ hour: "", minute: "" });
  const locked = field.disabled || field.pending;
  if (locked && open) setOpen(false);
  const committed = parseTime(field.value);
  const text = committed ? `${committed.hour}:${committed.minute}` : t.pickTime;
  const complete = draft.hour !== "" && draft.minute !== "";
  const statusId = `${field.id}-status`;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next && !locked) setDraft(committed ?? { hour: "", minute: "" });
        setOpen(next && !locked);
      }}
    >
      <PopoverTrigger asChild>
        <button {...triggerProps(field, text, !committed)}>
          <span>{text}</span>
          <ClockIcon aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="sheet-picker-content"
        collisionPadding={12}
        aria-label={field.label}
      >
        <div className="sheet-time-fields">
          <div>
            <label htmlFor={`${field.id}-hour`}>{t.hour}</label>
            <SelectControl
              id={`${field.id}-hour`}
              value={draft.hour}
              options={HOURS}
              onValueChange={(hour) => setDraft((d) => ({ ...d, hour }))}
              placeholder="HH"
              emptyLabel={t.noOptions}
              className="sheet-field-trigger"
            />
          </div>
          <span aria-hidden="true">:</span>
          <div>
            <label htmlFor={`${field.id}-minute`}>{t.minute}</label>
            <SelectControl
              id={`${field.id}-minute`}
              value={draft.minute}
              options={MINUTES}
              onValueChange={(minute) => setDraft((d) => ({ ...d, minute }))}
              placeholder="mm"
              emptyLabel={t.noOptions}
              className="sheet-field-trigger"
            />
          </div>
        </div>
        <p id={statusId} className="sheet-time-status">
          {complete ? "" : t.incomplete}
        </p>
        <div className="sheet-picker-actions">
          {field.clearable && committed ? (
            <button
              type="button"
              className="btn quiet"
              onClick={() => {
                field.onCommit("");
                setOpen(false);
              }}
            >
              {t.clearTime}
            </button>
          ) : null}
          <button
            type="button"
            className="btn outline"
            disabled={!complete}
            {...(complete ? {} : { "aria-describedby": statusId })}
            onClick={() => {
              if (!complete) return;
              field.onCommit(`${draft.hour}:${draft.minute}`);
              setOpen(false);
            }}
          >
            {t.done}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function renderEntry({ source, root, labels }: Entry) {
  const label = labels
    .map((el) => el.textContent?.trim())
    .filter(Boolean)
    .join(" ");
  const thai = document.documentElement.lang === "th";
  const t = copy[thai ? "th" : "en"];
  const readOnly =
    source instanceof HTMLSelectElement
      ? source.dataset.sheetReadonly !== undefined
      : source.readOnly;
  const field: Field = {
    id: `${source.id}-control`,
    label,
    thai,
    value: source.value,
    disabled: source.disabled,
    pending: source.dataset.sheetPending !== undefined,
    invalid: source.getAttribute("aria-invalid") === "true",
    required: source.required,
    clearable: source.dataset.sheetClearable !== undefined,
    describedBy: source.getAttribute("aria-describedby") ?? undefined,
    min: source.dataset.sheetMin,
    max: source.dataset.sheetMax,
    onCommit: (value) => commit(source, value),
  };
  let element;
  if (source instanceof HTMLSelectElement) {
    element = readOnly ? (
      <ReadOnlyField
        field={field}
        text={source.selectedOptions[0]?.text ?? ""}
      />
    ) : (
      <SelectControl
        id={field.id}
        value={source.value}
        options={Array.from(source.options, (option) => ({
          value: option.value,
          label: option.text,
          disabled: option.disabled,
        }))}
        onValueChange={field.onCommit}
        placeholder={label}
        emptyLabel={t.noOptions}
        disabled={field.disabled}
        pending={field.pending}
        required={field.required}
        invalid={field.invalid}
        describedBy={field.describedBy}
        className="sheet-field-trigger"
      />
    );
  } else if (source.dataset.sheetTime !== undefined) {
    const time = parseTime(source.value);
    element = readOnly ? (
      <ReadOnlyField
        field={field}
        text={time ? `${time.hour}:${time.minute}` : ""}
        icon="time"
      />
    ) : (
      <TimeField field={field} t={t} />
    );
  } else {
    const date = parseCivilDate(source.value);
    element = readOnly ? (
      <ReadOnlyField
        field={field}
        text={date ? formatCivilDate(date, thai) : ""}
        icon="date"
      />
    ) : (
      <DateField field={field} t={t} />
    );
  }
  flushSync(() => root.render(element));
}

function mount(scope: ParentNode = document) {
  for (const source of scope.querySelectorAll<Source>(
    ".select-input > select, input[data-sheet-date], input[data-sheet-time]",
  )) {
    if (entries.has(source)) continue;
    const labels = Array.from(source.labels ?? []);
    source.hidden = true;
    source.tabIndex = -1;
    source.setAttribute("aria-hidden", "true");
    const host = document.createElement("span");
    host.className = "sheet-control-root";
    source.after(host);
    for (const label of labels) label.htmlFor = `${source.id}-control`;
    const entry = { source, labels, host, root: createRoot(host) };
    entries.set(source, entry);
    renderEntry(entry);
  }
}
function unmount(scope: ParentNode) {
  for (const [source, entry] of entries) {
    if (scope.contains(source)) {
      flushSync(() => entry.root.unmount());
      entry.host.remove();
      entries.delete(source);
    }
  }
}
function refresh() {
  for (const entry of entries.values())
    if (entry.source.isConnected) renderEntry(entry);
}
declare global {
  interface Window {
    sheetControls?: {
      mount: typeof mount;
      unmount: typeof unmount;
      refresh: typeof refresh;
    };
  }
}
window.sheetControls = { mount, unmount, refresh };
mount();
// A successful mount uses the React controls. If this script fails,
// review.js keeps native pickers hidden and presents labelled read-only values.
document.documentElement.classList.add("sheet-controls-ready");
