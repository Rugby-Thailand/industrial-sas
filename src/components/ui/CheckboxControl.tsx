import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function CheckboxControl({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} type="checkbox" className={cn("size-4 accent-link", className)} />;
}
