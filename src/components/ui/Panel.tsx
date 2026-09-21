import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({
  children,
  className,
  as: Element = "section",
  ...props
}: HTMLAttributes<HTMLElement> & {
  children?: ReactNode;
  as?: "div" | "section" | "li" | "p" | "form";
}) {
  return (
    <Element
      className={cn(
        "rounded-xl border border-border bg-surface p-4",
        className,
      )}
      {...props}
    >
      {children}
    </Element>
  );
}
