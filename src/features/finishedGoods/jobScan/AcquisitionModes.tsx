"use client";

import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AcquisitionMode {
  readonly key: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Omitted for a one-shot action that opens no panel. */
  readonly pressed?: boolean;
  readonly onSelect: () => void;
}

/** One row of ways to acquire a value; at most one mode panel is pressed. */
export function AcquisitionModes({
  label,
  modes,
}: {
  label: string;
  modes: readonly AcquisitionMode[];
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "grid gap-2",
        modes.length >= 3 ? "grid-cols-3" : "grid-cols-2",
      )}
    >
      {modes.map(({ key, label: name, icon: Icon, pressed, onSelect }) => (
        <Button
          key={key}
          type="button"
          variant={pressed ? "default" : "outline"}
          aria-pressed={pressed}
          className="min-h-14 min-w-0 flex-col gap-1 px-1 text-xs whitespace-normal sm:min-h-12 sm:flex-row sm:gap-2 sm:px-3 sm:text-sm"
          onClick={onSelect}
        >
          <Icon className="size-5 sm:size-4" aria-hidden="true" />
          {name}
        </Button>
      ))}
    </div>
  );
}
