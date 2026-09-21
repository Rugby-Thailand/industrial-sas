import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const WIDTHS = {
  compact: "mx-auto w-full max-w-xl",
  form: "mx-auto w-full max-w-3xl",
  wide: "mx-auto w-full max-w-7xl",
  full: "w-full",
} as const;

export function PageContainer({
  className,
  size = "full",
  actionInset,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  readonly size?: keyof typeof WIDTHS;
  readonly actionInset?: "fixed" | "responsive";
}) {
  return (
    <div
      {...props}
      data-action-scope={actionInset ? "" : undefined}
      className={cn(
        "min-w-0 space-y-6",
        WIDTHS[size],
        actionInset && "pb-[var(--sticky-action-height,10rem)]",
        actionInset === "responsive" && "md:pb-0",
        className,
      )}
    />
  );
}
