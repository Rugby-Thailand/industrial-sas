"use client";

/**
 * A labelled group that is collapsed until the operator asks for it.
 *
 * One idiom for every "advanced / more / secondary" group in the app: an
 * icon-led toggle row with `aria-expanded`/`aria-controls`, an optional muted
 * badge (e.g. "Defaults"), and a chevron that flips. Progressive disclosure is
 * for *infrequent* content only — errors and the current required action must
 * never live behind this component, and a caller whose server blames a field
 * inside the panel must force it open via the controlled `open` prop.
 *
 * Controlled when `open` is given, uncontrolled (starting collapsed) otherwise.
 */
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
  /** Small muted chip after the label, e.g. "Defaults". */
  readonly badge?: string;
  /** Controlled open state; omit to start collapsed and self-manage. */
  readonly open?: boolean;
  readonly onToggle?: (open: boolean) => void;
  /** Extra classes on the revealed panel, e.g. a grid. */
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
