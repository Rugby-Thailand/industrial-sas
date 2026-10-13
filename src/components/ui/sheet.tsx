"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  useCompletionHandle,
  type DialogCompletionHandle,
} from "@/components/ui/dialog";
import { XIcon } from "lucide-react";
import { useBackDisclosure } from "@/hooks/useBackDisclosure";
import { DraftForegroundContext } from "@/components/providers/draftGuard";

/** Same contract as a Dialog's: the sheet's entry is consumed first. */
export type SheetCompletionHandle = DialogCompletionHandle;

/**
 * Open a successor foreground (an editor, Search) from a Sheet only once the
 * sheet has consumed its own history entry and finished closing. Opening on
 * close focus alone lets the successor push its entry while the sheet's native
 * Back is pending; that one pop then restores both and leaves a duplicate page
 * entry. Opening on the pop alone stacks it on a sheet that still owns focus.
 *
 * One close serves one successor: a repeated request while it is pending
 * replaces the successor rather than queueing a second. Unmounting (a route
 * change during the exit animation) drops it.
 *
 * `close` closes the sheet's state if its entry was already gone. The
 * SheetContent's `onCloseAutoFocus` calls `closeFocus` first: true means a
 * handoff owns focus. `cancel` drops a handoff that no longer applies.
 */
export function useSheetHandoff(
  completionRef: React.RefObject<SheetCompletionHandle | null>,
  close: () => void,
) {
  const successor = React.useRef<(() => void) | null>(null);
  const consumed = React.useRef(false);
  const closed = React.useRef(false);
  // Identifies one handoff; a cancelled one's late completion is ignored.
  const generation = React.useRef(0);
  const latestClose = React.useRef(close);
  React.useLayoutEffect(() => {
    latestClose.current = close;
  });
  const cancel = React.useCallback(() => {
    generation.current += 1;
    successor.current = null;
    consumed.current = false;
    closed.current = false;
  }, []);
  React.useEffect(() => cancel, [cancel]);
  const settle = React.useCallback(() => {
    const run = successor.current;
    if (run === null || !consumed.current || !closed.current) return;
    cancel();
    run();
  }, [cancel]);
  const handOff = React.useCallback(
    (run: () => void) => {
      successor.current = run;
      const current = generation.current;
      // While its traversal is in flight, `complete` ignores a repeat; after a
      // refused traversal (a pending write kept the sheet) it starts again.
      completionRef.current?.complete(
        () => {
          if (current !== generation.current || successor.current === null)
            return;
          consumed.current = true;
          // Normally already closed by its own Back; never left open otherwise.
          latestClose.current();
          settle();
        },
        () => {
          // A refused handoff cannot claim focus on a later manual close.
          if (current === generation.current) cancel();
        },
      );
    },
    [completionRef, settle, cancel],
  );
  const closeFocus = React.useCallback(
    (event: Event) => {
      if (successor.current === null) return false;
      event.preventDefault();
      closed.current = true;
      settle();
      return true;
    },
    [settle],
  );
  return { handOff, cancel, closeFocus };
}

function Sheet({
  open,
  defaultOpen = false,
  onOpenChange,
  backPending = false,
  completionRef,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Root> & {
  backPending?: boolean;
  completionRef?: React.Ref<SheetCompletionHandle>;
}) {
  const [local, setLocal] = React.useState(defaultOpen);
  const disclosure = useBackDisclosure(
    open ?? local,
    (next) => {
      setLocal(next);
      onOpenChange?.(next);
    },
    { blocked: backPending },
  );
  useCompletionHandle(completionRef, disclosure.complete);
  return (
    <DraftForegroundContext.Provider value={disclosure.scope}>
      <SheetPrimitive.Root
        data-slot="sheet"
        {...props}
        open={open ?? local}
        onOpenChange={disclosure.onOpenChange}
      />
    </DraftForegroundContext.Provider>
  );
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/55 duration-150 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  closeLabel = "Close",
  size = "md",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;

  closeLabel?: string;
  size?: "sm" | "md" | "lg" | "wide";
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition duration-200 ease-in-out data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-open:animate-in data-open:fade-in-0 data-[side=bottom]:data-open:slide-in-from-bottom-10 data-[side=left]:data-open:slide-in-from-left-10 data-[side=right]:data-open:slide-in-from-right-10 data-[side=top]:data-open:slide-in-from-top-10 data-closed:animate-out data-closed:fade-out-0 data-[side=bottom]:data-closed:slide-out-to-bottom-10 data-[side=left]:data-closed:slide-out-to-left-10 data-[side=right]:data-closed:slide-out-to-right-10 data-[side=top]:data-closed:slide-out-to-top-10",
          {
            "data-[side=left]:w-1/2 data-[side=right]:w-1/2": size === "sm",
            "data-[side=left]:w-3/4 data-[side=right]:w-3/4": size === "md",
            "data-[side=left]:w-5/6 data-[side=right]:w-5/6": size === "lg",
            "data-[side=left]:w-[min(96vw,72rem)] data-[side=right]:w-[min(96vw,72rem)]":
              size === "wide",
          },
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-3 right-3"
              size="icon"
            >
              <XIcon />
              <span className="sr-only">{closeLabel}</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-lg leading-7 font-semibold text-text", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm leading-5 text-muted", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
};
