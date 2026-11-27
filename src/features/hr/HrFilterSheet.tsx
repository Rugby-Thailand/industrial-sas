"use client";

import { useTranslations } from "next-intl";
import { useRef, type ReactNode, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  type SheetCompletionHandle,
} from "@/components/ui/sheet";

export function HrFilterSheet({
  open,
  onOpenChange,
  title,
  focus,
  trigger,
  onApply,
  applyDisabled,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly focus: RefObject<string>;
  readonly trigger: ReactNode;
  readonly onApply: () => void;
  readonly applyDisabled?: boolean;
  readonly children: ReactNode;
}) {
  const t = useTranslations("Hr.filterControls");
  const completion = useRef<SheetCompletionHandle | null>(null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} completionRef={completion}>
      {trigger}
      <SheetContent
        className="max-w-md gap-0 data-[side=right]:w-full"
        closeLabel={t("close")}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          const id = focus.current;
          const target =
            document.getElementById(`${id}-search`) ??
            document.getElementById(id);
          if (!target) return;
          const selected =
            target instanceof HTMLInputElement && target.type === "radio"
              ? target
                  .closest("fieldset")
                  ?.querySelector<HTMLInputElement>("input:checked")
              : undefined;
          event.preventDefault();
          (selected ?? target).focus();
        }}
      >
        <SheetHeader className="shrink-0 border-b border-border pr-14">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!applyDisabled) completion.current?.complete(onApply);
          }}
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            {children}
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-border p-4">
            <SheetClose asChild>
              <Button type="button" variant="ghost">
                {t("cancel")}
              </Button>
            </SheetClose>
            <Button type="submit" disabled={applyDisabled}>
              {t("apply")}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
