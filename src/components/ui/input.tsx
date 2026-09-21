import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "min-h-touch w-full min-w-0 rounded-md border border-input bg-surface px-3 py-2 text-base text-text transition-colors outline-none",
        "placeholder:text-muted",
        "disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled-surface disabled:text-disabled",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        "md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
