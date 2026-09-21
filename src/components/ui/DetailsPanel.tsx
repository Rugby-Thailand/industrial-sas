"use client";

import type { ComponentProps, ReactNode } from "react";
import {
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/** Used inside Sheet so each workflow owns its trigger and open state. */
export function DetailsPanel({
  title,
  description,
  closeLabel,
  width = "default",
  children,
  onCloseAutoFocus,
}: {
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly closeLabel: string;
  readonly width?: "default" | "wide";
  readonly children: ReactNode;
  readonly onCloseAutoFocus?: ComponentProps<
    typeof SheetContent
  >["onCloseAutoFocus"];
}) {
  return (
    <SheetContent
      closeLabel={closeLabel}
      className={cn(
        "w-full overflow-y-auto p-4 data-[side=right]:w-full",
        width === "wide" ? "sm:max-w-xl" : "sm:max-w-md",
      )}
      {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
    >
      <SheetHeader className="p-0 pr-10">
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
      </SheetHeader>
      {children}
    </SheetContent>
  );
}
