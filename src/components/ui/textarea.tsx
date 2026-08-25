import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-touch w-full rounded-md border border-input bg-surface px-3 py-2 text-base text-text transition-colors outline-none",
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

export { Textarea };
