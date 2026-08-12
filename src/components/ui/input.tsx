import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The shadcn/Radix Input, sized for a gloved hand.
 *
 * `min-h-touch` replaces the registry's fixed 32-pixel height, and the control
 * keeps `text-base` below the `md` breakpoint so a handheld never renders form
 * text below 16 pixels — the size at which mobile browsers stop zooming on
 * focus and at which the repository's own type scale starts.
 *
 * No `inputMode`, `autoCapitalize`, or `enterKeyHint` default is set here. A
 * keyboard-wedge scanner types into whatever is focused, and a primitive that
 * silently forced a numeric keypad would be deciding for the scan-target fields
 * whose call sites already make that choice deliberately.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "min-h-touch w-full min-w-0 rounded-md border border-input bg-surface px-3 py-2 text-base text-text transition-colors outline-none",
        "placeholder:text-muted",
        "disabled:cursor-not-allowed disabled:border-border disabled:text-disabled",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        "md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
