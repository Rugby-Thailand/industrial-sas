"use client";

import { useId } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

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

  readonly name?: string;
  readonly value: string;
  readonly options: readonly SelectControlOption[];
  readonly onValueChange: (value: string) => void;

  readonly placeholder: string;

  readonly emptyLabel: string;
  readonly disabled?: boolean;

  readonly pending?: boolean;
  readonly required?: boolean;
  readonly invalid?: boolean;
  readonly describedBy?: string;

  readonly label?: string;
  readonly size?: "default" | "compact";
  readonly className?: string;
  readonly testId?: string;
}

export function SelectControl({
  id,
  name,
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
  size = "default",
  className,
  testId,
}: SelectControlProps) {
  const emptyId = useId();
  const isEmpty = options.length === 0;

  const closed = disabled || pending || isEmpty;

  const offersBlank = options.some((option) => option.value === "");
  const toInternal = (candidate: string): string =>
    candidate === "" && offersBlank ? BLANK : candidate;

  return (
    <Select
      value={toInternal(value)}
      onValueChange={(next) => onValueChange(fromInternal(next))}
      disabled={closed}
      required={required}
      {...(name === undefined ? {} : { name })}
    >
      <SelectTrigger
        {...(id === undefined ? {} : { id })}
        {...(label === undefined ? {} : { "aria-label": label })}
        {...(describedBy === undefined || describedBy === ""
          ? {}
          : { "aria-describedby": describedBy })}
        aria-invalid={invalid ? true : undefined}
        aria-required={required ? true : undefined}
        aria-busy={pending ? true : undefined}
        className={cn(
          size === "compact" && "h-8 min-h-8! px-3 py-0 text-xs",
          className,
        )}
        {...(testId === undefined ? {} : { "data-testid": testId })}
      >
        <SelectValue placeholder={isEmpty ? emptyLabel : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {isEmpty ? (
          <p id={emptyId} className="px-3 py-2 text-sm text-muted">
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
