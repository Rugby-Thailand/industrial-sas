"use client";

import { ChevronDown, type LucideIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

export function CollapsibleSection({
  label,
  icon: Icon,
  badge,
  open: controlledOpen,
  onToggle,
  contentClassName,
  children,
  testId,
}: {
  readonly label: string;
  readonly icon?: LucideIcon;

  readonly badge?: string;

  readonly open?: boolean;
  readonly onToggle?: (open: boolean) => void;

  readonly contentClassName?: string;
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  const panelId = useId();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;

  const toggle = () => {
    const next = !open;
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onToggle?.(next);
  };

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="flex min-h-touch w-full items-center gap-2 rounded-md px-3 text-sm font-medium text-text outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        {...(testId === undefined ? {} : { "data-testid": testId })}
      >
        {Icon === undefined ? null : (
          <Icon aria-hidden="true" className="size-4 text-muted" />
        )}
        {label}
        {badge === undefined ? null : (
          <span className="rounded-full bg-raised px-2 py-0.5 text-xs font-normal text-muted">
            {badge}
          </span>
        )}
        <ChevronDown
          aria-hidden="true"
          className={`ml-auto size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div
          id={panelId}
          className={`border-t border-border p-3 ${contentClassName ?? ""}`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
