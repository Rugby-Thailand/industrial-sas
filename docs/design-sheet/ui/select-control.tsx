// Adapted from the application's src/components/ui/SelectControl.tsx
// (2026-10-15): same value/options/placeholder/emptyLabel/disabled/invalid/
// describedBy contract and the same blank-value sentinel. Sheet-owned and
// unstyled; controls.css owns appearance.
//
// Deliberate preview difference: `pending` keeps the trigger focusable with
// its resting appearance (aria-busy + aria-disabled) and blocks opening and
// typeahead changes. The application currently disables the trigger.
"use client";

import { useId } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

export interface SelectControlOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

// Radix reserves an empty string for “no selection”; use a sentinel value.
const BLANK = "__blank__";
const fromInternal = (value: string): string => (value === BLANK ? "" : value);

export interface SelectControlProps {
  readonly id?: string;
  readonly value: string;
  readonly options: readonly SelectControlOption[];
  readonly onValueChange: (value: string) => void;
  readonly placeholder: string;
  readonly emptyLabel: string;
  readonly disabled?: boolean;
  readonly pending?: boolean;
  readonly required?: boolean;
  readonly invalid?: boolean;
  readonly describedBy?: string | undefined;
  readonly label?: string;
  readonly className?: string;
}

export function SelectControl({
  id,
  value,
  options,
  onValueChange,
  placeholder,
  emptyLabel,
  disabled = false,
  pending = false,
  required = false,
  invalid = false,
  describedBy,
  label,
  className,
}: SelectControlProps) {
  const emptyId = useId();
  const isEmpty = options.length === 0;
  const offersBlank = options.some((option) => option.value === "");
  const toInternal = (candidate: string): string =>
    candidate === "" && offersBlank ? BLANK : candidate;

  return (
    <Select
      value={toInternal(value)}
      onValueChange={(next) => {
        // A pending field is locked: closed-trigger typeahead must not change it.
        if (!pending) onValueChange(fromInternal(next));
      }}
      disabled={disabled || isEmpty}
      required={required}
      {...(pending ? { open: false } : {})}
    >
      <SelectTrigger
        {...(id === undefined ? {} : { id })}
        {...(label === undefined ? {} : { "aria-label": label })}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
        aria-invalid={invalid ? true : undefined}
        aria-required={required ? true : undefined}
        aria-busy={pending ? true : undefined}
        aria-disabled={pending ? true : undefined}
        {...(className === undefined ? {} : { className })}
      >
        <SelectValue placeholder={isEmpty ? emptyLabel : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {isEmpty ? (
          <p id={emptyId} data-slot="select-empty">
            {emptyLabel}
          </p>
        ) : (
          options.map((option) => (
            <SelectItem
              key={option.value}
              value={toInternal(option.value)}
              disabled={option.disabled === true}
              data-value={option.value}
            >
              {option.label}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
