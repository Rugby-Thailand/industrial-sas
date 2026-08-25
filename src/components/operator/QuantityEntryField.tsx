"use client";

import { useId, type KeyboardEvent } from "react";

import { normalizeQuantityEntry } from "../../../convex/model/platform/quantityEntry";
import { Input } from "../ui/input";
import { SelectControl } from "../ui/SelectControl";

export interface QuantityEntryLabels {
  readonly quantityLabel: string;
  readonly uomLabel: string;
  readonly uomPlaceholder: string;

  readonly previewLabel: string;

  readonly errors: Readonly<Record<string, string>>;

  readonly genericError: string;
}

export interface QuantityEntryFieldProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly uom: string;
  readonly onUomChange: (uom: string) => void;

  readonly uomOptions: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly labels: QuantityEntryLabels;
  readonly disabled?: boolean;
  readonly testId?: string;
}

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

            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            disabled={disabled}
            aria-describedby={feedbackId}
            aria-invalid={invalid}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
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
