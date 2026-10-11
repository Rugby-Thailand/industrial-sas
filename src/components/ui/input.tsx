import * as React from "react";

import { cn } from "@/lib/utils";

/** Shared touch field, compact only on a desktop with a fine primary pointer. */
export const fieldControlClassName = cn(
  "min-h-touch w-full min-w-0 rounded-md border border-input bg-surface px-3 py-2 text-base text-text transition-colors",
  "placeholder:text-muted",
  "disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled-surface disabled:text-disabled",
  "focus-field",
  "aria-invalid:border-destructive",
  "dense:min-h-control dense:py-1.5 dense:text-sm",
);

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(fieldControlClassName, className)}
      {...props}
    />
  );
}

export { Input };
