"use client";

import { Plus } from "lucide-react";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface WriteSurfaceContextValue {
  readonly embedded: true;
  readonly closeOnSaved: boolean;
  readonly complete: () => void;
}

const WriteSurfaceContext = createContext<WriteSurfaceContextValue | null>(
  null,
);

export function useWriteSurface(): WriteSurfaceContextValue | null {
  return useContext(WriteSurfaceContext);
}

export interface WriteDialogProps {
  readonly triggerLabel: string;
  readonly title?: string;
  readonly description?: string;
  readonly closeLabel: string;
  readonly children: ReactNode;
  readonly surface?: "dialog" | "sheet";
  readonly size?: "compact" | "wide" | "workspace";
  readonly triggerVariant?: ComponentProps<typeof Button>["variant"];
  readonly showPlus?: boolean;
  readonly testId?: string;
  readonly closeOnSaved?: boolean;
}

const dialogSize = {
  compact: "max-w-2xl",
  wide: "max-w-5xl",
  workspace: "max-w-[calc(100vw-2rem)] xl:max-w-7xl",
} as const;

const sheetSize = {
  compact: "overflow-y-auto sm:max-w-xl",
  wide: "overflow-y-auto sm:max-w-3xl lg:max-w-5xl",
  workspace: "overflow-y-auto sm:max-w-[min(92vw,90rem)]",
} as const;

export function WriteDialog({
  triggerLabel,
  title = triggerLabel,
  description,
  closeLabel,
  children,
  surface = "dialog",
  size = "compact",
  triggerVariant = "default",
  showPlus = true,
  testId,
  closeOnSaved = true,
}: WriteDialogProps) {
  const [open, setOpen] = useState(false);
  const context = useMemo<WriteSurfaceContextValue>(
    () => ({
      embedded: true,
      closeOnSaved,
      complete: () => setOpen(false),
    }),
    [closeOnSaved],
  );
  const trigger = (
    <Button
      type="button"
      variant={triggerVariant}
      className="shrink-0 gap-2"
      {...(testId === undefined ? {} : { "data-testid": `${testId}-trigger` })}
    >
      {showPlus ? <Plus aria-hidden="true" className="size-4" /> : null}
      {triggerLabel}
    </Button>
  );
  const body = (
    <WriteSurfaceContext.Provider value={context}>
      {children}
    </WriteSurfaceContext.Provider>
  );

  if (surface === "sheet") {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          side="right"
          closeLabel={closeLabel}
          className={sheetSize[size]}
          {...(testId === undefined ? {} : { "data-testid": testId })}
        >
          <SheetHeader className="border-b border-border pr-12">
            <SheetTitle>{title}</SheetTitle>
            {description === undefined ? null : (
              <SheetDescription>{description}</SheetDescription>
            )}
          </SheetHeader>
          <div className="px-4 pb-6">{body}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        closeLabel={closeLabel}
        className={cn(dialogSize[size], "gap-4")}
        {...(testId === undefined ? {} : { "data-testid": testId })}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description === undefined ? null : (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
