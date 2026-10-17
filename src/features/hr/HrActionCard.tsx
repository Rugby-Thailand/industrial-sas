"use client";

import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import { panelClassName } from "@/components/ui/Panel";
import { cn } from "@/lib/utils";

interface ActionCardContent {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly description?: ReactNode;
  readonly value?: ReactNode;
}

type ActionCardProps = ActionCardContent &
  (
    | {
        readonly href: string;
        readonly onClick?: never;
        readonly selected?: never;
      }
    | {
        readonly href?: never;
        readonly onClick: () => void;
        readonly selected?: boolean;
      }
    | {
        readonly href?: never;
        readonly onClick?: never;
        readonly selected?: never;
      }
  );

/** One task anatomy for employee shortcuts and inspectable attendance totals. */
export function HrActionCard({
  icon: Icon,
  label,
  description,
  value,
  href,
  onClick,
  selected,
}: ActionCardProps) {
  const interactive = href !== undefined || onClick !== undefined;
  const classes = cn(
    panelClassName({ padding: "compact" }),
    "flex min-h-touch w-full items-center gap-3 text-left",
    interactive && "focus-ring transition-colors hover:bg-raised",
    selected &&
      "bg-accent-surface text-selected-foreground hover:bg-accent-surface",
  );
  const content = (
    <>
      <span
        aria-hidden="true"
        className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-raised text-link"
      >
        <Icon className="size-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-text">{label}</span>
        {description === undefined ? null : (
          <span className="block text-xs leading-relaxed wrap-anywhere text-muted">
            {description}
          </span>
        )}
      </span>
      {value === undefined ? null : (
        <span className="shrink-0 text-lg font-semibold text-text tabular-nums">
          {value}
        </span>
      )}
      {href === undefined ? null : (
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted"
        />
      )}
    </>
  );
  if (href !== undefined)
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  if (onClick !== undefined)
    return (
      <button
        type="button"
        className={classes}
        aria-pressed={selected ?? false}
        onClick={onClick}
      >
        {content}
      </button>
    );
  return <div className={classes}>{content}</div>;
}
