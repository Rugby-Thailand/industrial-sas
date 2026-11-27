"use client";

import { Funnel, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type IconActionProps = Omit<ComponentProps<typeof IconButton>, "children">;

export function FilterTrigger({
  label,
  count,
  className,
  ...props
}: IconActionProps & { count: number }) {
  return (
    <IconButton
      {...props}
      label={count ? `${label} (${count})` : label}
      variant="ghost"
      className={cn("relative", className)}
    >
      <Funnel aria-hidden="true" />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0 right-0 min-w-4 rounded-full bg-primary px-1 text-center text-[0.6875rem] leading-4 font-semibold text-primary-foreground tabular-nums"
        >
          {count}
        </span>
      )}
    </IconButton>
  );
}

export function ClearFilterButton(props: IconActionProps) {
  return (
    <IconButton {...props} variant="ghost">
      <X aria-hidden="true" />
    </IconButton>
  );
}

export function AppliedFilterChip({
  label,
  editLabel,
  removeLabel,
  onEdit,
  onRemove,
}: {
  label: ReactNode;
  editLabel: string;
  removeLabel: string;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex max-w-full items-stretch rounded-md border border-border bg-accent-surface">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={editLabel}
        title={editLabel}
        onClick={onEdit}
        className="min-w-0 shrink rounded-r-none text-left wrap-anywhere whitespace-normal"
      >
        {label}
      </Button>
      <ClearFilterButton
        label={removeLabel}
        onClick={onRemove}
        className="rounded-l-none border-l-border"
      />
    </span>
  );
}
