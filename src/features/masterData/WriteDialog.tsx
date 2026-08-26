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
  readonly size?: "compact" | "wide" | "workspace";
  readonly triggerVariant?: ComponentProps<typeof Button>["variant"];
  readonly showPlus?: boolean;
  readonly testId?: string;
  readonly closeOnSaved?: boolean;
}

const dialogSize = {
  compact: "max-w-2xl",
  wide: "max-w-5xl",
  workspace:
    "h-[calc(100dvh-1rem)] !max-h-[calc(100dvh-1rem)] !max-w-none sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:!max-h-[calc(100dvh-2rem)]",
} as const;

export function WriteDialog({
  triggerLabel,
  title = triggerLabel,
  description,
  closeLabel,
  children,
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        closeLabel={closeLabel}
        className={cn(
          dialogSize[size],
          size === "workspace"
            ? "grid grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0"
            : "gap-4",
        )}
        {...(testId === undefined ? {} : { "data-testid": testId })}
      >
        <DialogHeader
          className={cn(
            size === "workspace" &&
              "border-b border-border px-5 py-4 pr-14 sm:px-6",
          )}
        >
          <DialogTitle>{title}</DialogTitle>
          {description === undefined ? null : (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        <div
          className={cn(
            size === "workspace" && "min-h-0 overflow-y-auto px-4 pb-6 sm:px-6",
          )}
        >
          {body}
        </div>
      </DialogContent>
    </Dialog>
  );
}
