"use client";

/**
 * The one quantity input every operator surface uses (`FF-P1-10`, `ADR-0004`,
 * `ADR-0010`).
 *
 * What makes this shared rather than a styled `<input>`:
 *
 * - **The entry unit is explicit and beside the number.** An operator counting
 *   cases must say so; a screen that assumed the base unit would turn three
 *   cases into three eaches, silently, on a stock count.
 * - **The keypad is the numeric one.** `inputMode="decimal"` with a gloved
 *   thumb on a handheld, not a full keyboard.
 * - **Thai digits are read, not refused.** `๑๒` is twelve. The preview under
 *   the field shows what the server will understand, so an operator sees the
 *   normalization *before* they confirm rather than after.
 * - **Nothing is converted here.** The preview is the parsed decimal in the
 *   entry unit; the conversion to base units happens server-side through the
 *   item's own profile. A browser that converted would be a second, unversioned
 *   copy of the conversion table.
 * - **Enter never submits.** A keyboard-wedge scanner appends Enter, and a
 *   field that submitted on it would post whatever half-typed number was on
 *   screen when the operator scanned the next label
 *   (`ADR-0009`, plan §17). The key is swallowed here, and the confirm control
 *   is a separate deliberate press.
 *
 * The parsing is the server's own kernel, imported rather than re-implemented:
 * `convex/model/platform/quantityEntry.ts` decides what `1,200` and `๑๒.๕`
 * mean, so the preview cannot disagree with the refusal.
 */
import { useId, type KeyboardEvent } from "react";

import { normalizeQuantityEntry } from "../../../convex/model/platform/quantityEntry";
import { Input } from "../ui/input";
import { SelectControl } from "../ui/SelectControl";

export interface QuantityEntryLabels {
  readonly quantityLabel: string;
  readonly uomLabel: string;
  readonly uomPlaceholder: string;
  /** "This is what the server will read", above the parsed preview. */
  readonly previewLabel: string;
  /** One message per refusal code the parser can produce. */
  readonly errors: Readonly<Record<string, string>>;
  /** Shown when the parser produced a code this screen has no message for. */
  readonly genericError: string;
}

export interface QuantityEntryFieldProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly uom: string;
  readonly onUomChange: (uom: string) => void;
  /** The units this item declares. The base unit is always among them. */
  readonly uomOptions: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly labels: QuantityEntryLabels;
  readonly disabled?: boolean;
  readonly testId?: string;
}

/**
 * Render the field, its unit, and the parsed preview or the reason there is
 * none.
 *
 * The preview and the error occupy the same region and are announced politely:
 * a quantity being retyped must not interrupt a screen reader mid-word, and the
 * operator is looking at the field they are typing in.
 */
export function QuantityEntryField({
  value,
  onValueChange,
  uom,
  onUomChange,
  uomOptions,
  labels,
  disabled = false,
  testId,
}: QuantityEntryFieldProps) {
  const fieldId = useId();
  const uomId = useId();
  const feedbackId = useId();

  const trimmed = value.trim();
  const parsed = trimmed.length === 0 ? null : normalizeQuantityEntry(value);
  const invalid = parsed !== null && !parsed.ok;
  const message = !invalid
    ? null
    : (labels.errors[(parsed as { error: { code: string } }).error.code] ??
      labels.genericError);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-32 flex-1 flex-col gap-1">
          <label htmlFor={fieldId} className="text-xs font-semibold text-muted">
            {labels.quantityLabel}
          </label>
          <Input
            id={fieldId}
            /*
             * `text` rather than `number`: a numeric input strips what it
             * cannot parse, and a Thai digit is exactly that. The keypad comes
             * from `inputMode`, which is the part an operator's thumb cares
             * about.
             */
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            disabled={disabled}
            aria-describedby={feedbackId}
            aria-invalid={invalid}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              // A wedge scanner ends every scan with Enter. Swallowing it here
              // is what stops the next scan from submitting this number.
              if (event.key === "Enter") event.preventDefault();
            }}
            className="h-12 text-lg"
            {...(testId === undefined ? {} : { "data-testid": testId })}
          />
        </div>
        <div className="flex min-w-28 flex-col gap-1">
          <label htmlFor={uomId} className="text-xs font-semibold text-muted">
            {labels.uomLabel}
          </label>
          <SelectControl
            id={uomId}
            name="entryUom"
            value={uom}
            options={uomOptions}
            onValueChange={onUomChange}
            placeholder={labels.uomPlaceholder}
            emptyLabel={labels.uomPlaceholder}
            disabled={disabled}
            label={labels.uomLabel}
            {...(testId === undefined ? {} : { testId: `${testId}-uom` })}
          />
        </div>
      </div>
      <p
        id={feedbackId}
        role="status"
        className={`text-sm ${invalid ? "text-danger" : "text-muted"}`}
        data-testid={testId === undefined ? undefined : `${testId}-feedback`}
      >
        {message ??
          (parsed !== null && parsed.ok
            ? `${labels.previewLabel} ${parsed.value} ${uom}`
            : "")}
      </p>
    </div>
  );
}
