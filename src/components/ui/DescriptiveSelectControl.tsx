"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface DescriptiveSelectOption {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

export function DescriptiveSelectControl({
  id,
  value,
  options,
  placeholder,
  className,
  onValueChange,
}: {
  readonly id: string;
  readonly value: string;
  readonly options: readonly DescriptiveSelectOption[];
  readonly placeholder: string;
  readonly className?: string;
  readonly onValueChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className={cn("[&_small]:hidden", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper">
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            data-value={option.value}
          >
            <span className="flex flex-col items-start gap-0.5 py-0.5">
              <span className="font-medium">{option.label}</span>
              <small className="text-xs leading-snug text-current opacity-70">
                {option.description}
              </small>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
