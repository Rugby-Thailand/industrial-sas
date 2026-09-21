"use client";

import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";

/** Keep camera controls together; secondary actions collapse by scene width. */
export function SceneToolbar({
  title,
  primary,
  secondary,
  moreLabel,
}: {
  title: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  moreLabel: string;
}) {
  return (
    <div className="@container/scene-toolbar min-w-0">
      <div className="flex min-h-12 flex-wrap items-center gap-x-2 gap-y-2 py-1 [&_button]:min-h-12 [&_button]:min-w-12 [&_button]:px-2 [&_button]:text-xs">
        <div className="min-w-0 flex-1 text-sm font-semibold @max-[480px]/scene-toolbar:basis-full">
          {title}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {primary}
        </div>
        {secondary && (
          <>
            <div className="hidden flex-wrap items-center gap-1 border-l border-border pl-2 @min-[540px]/scene-toolbar:flex">
              {secondary}
            </div>
            <div className="@min-[540px]/scene-toolbar:hidden">
              <Popover.Root>
                <Popover.Trigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={moreLabel}
                    title={moreLabel}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    align="end"
                    sideOffset={4}
                    aria-label={moreLabel}
                    className="z-50 flex max-w-[calc(100vw-2rem)] flex-wrap gap-2 rounded-lg border border-border bg-surface p-2 shadow-lg [&_button]:min-h-12 [&_button]:min-w-12"
                  >
                    {secondary}
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
