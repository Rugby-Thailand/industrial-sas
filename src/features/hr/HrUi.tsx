"use client";

/**
 * HR-scoped presentation primitives: the toolbar, statistic strip, recorded
 * time cell, disclosure and identity mark shared by the HR screens. Self-contained (no
 * HR data hooks) so every screen can compose them without new behaviour.
 */
import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "pending";

const TONE_SURFACE: Readonly<Record<Tone, string>> = {
  neutral: "border-border bg-surface",
  accent: "border-link/30 bg-accent-surface",
  success: "border-success/40 bg-success-surface",
  warning: "border-warning/50 bg-warning-surface",
  danger: "border-danger/50 bg-danger-surface",
  pending: "border-pending/40 bg-pending-surface",
};

const TONE_TEXT: Readonly<Record<Tone, string>> = {
  neutral: "text-text",
  accent: "text-link",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  pending: "text-pending",
};

/** A grouped filter/action bar; wraps on narrow screens. */
export function HrToolbar({
  children,
  label,
  className,
}: {
  readonly children: ReactNode;
  readonly label?: string | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <div
      role={label === undefined ? undefined : "group"}
      aria-label={label}
      className={cn(
        "flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface HrStat {
  readonly label: string;
  readonly value: ReactNode;
  readonly tone?: Tone;
  /** The focal figure; shown larger and first on narrow screens. */
  readonly focal?: boolean;
}

/** Compact statistic strip: one focal figure plus small honest counts. */
export function HrStatStrip({
  items,
  label,
  compact = false,
}: {
  readonly items: readonly HrStat[];
  readonly label: string;
  /** Small secondary counts: several per row even on phones. */
  readonly compact?: boolean;
}) {
  return (
    <dl
      aria-label={label}
      className={cn(
        "grid gap-2",
        compact
          ? "grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))]"
          : "grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))]",
      )}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className={cn(
            "min-w-0 rounded-lg border",
            compact ? "px-2.5 py-1.5" : "px-3 py-2",
            TONE_SURFACE[item.tone ?? "neutral"],
            item.focal && "col-span-2 sm:col-span-1",
          )}
        >
          <dt className="truncate text-xs text-muted">{item.label}</dt>
          <dd
            className={cn(
              "font-semibold tabular-nums",
              TONE_TEXT[item.tone ?? "neutral"],
              item.focal
                ? "text-2xl leading-8"
                : compact
                  ? "text-base leading-6"
                  : "text-lg leading-7",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One recorded time (clock-in/out) shown as a prominent receipt cell. */
export function HrTimeCell({
  label,
  value,
  hint,
  recorded,
  testId,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: ReactNode;
  readonly recorded: boolean;
  readonly testId?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border p-3 sm:p-4",
        recorded
          ? "border-success/40 bg-success-surface"
          : "border-dashed border-border-strong bg-raised",
      )}
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      <p className="text-xs font-medium text-muted">{label}</p>
      <p
        className={cn(
          "font-mono text-3xl leading-10 font-semibold tabular-nums sm:text-4xl sm:leading-[3rem]",
          recorded ? "text-text" : "text-muted",
        )}
      >
        {value}
      </p>
      {hint === undefined ? null : <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** A tone pill for the current state of a record. */
export function HrStateChip({
  tone,
  children,
  testId,
}: {
  readonly tone: Tone;
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold whitespace-nowrap",
        TONE_SURFACE[tone],
        TONE_TEXT[tone],
      )}
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      <span aria-hidden="true" className="size-2 rounded-full bg-current" />
      {children}
    </span>
  );
}

/** Initials mark for a person; decorative, the name is always shown too. */
export function HrInitials({
  name,
  size = "md",
}: {
  readonly name: string;
  readonly size?: "sm" | "md" | "lg";
}) {
  const initials =
    name
      .replace(/\(.*?\)/g, "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => [...part][0] ?? "")
      .join("")
      .toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-accent-surface font-semibold text-link",
        size === "sm" && "size-8 text-xs",
        size === "md" && "size-10 text-sm",
        size === "lg" && "size-14 text-lg",
      )}
    >
      {initials}
    </span>
  );
}

/** A section heading row with an optional action, for sections inside a page. */
export function HrSectionHeader({
  id,
  title,
  description,
  action,
}: {
  readonly id?: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 id={id} className="text-lg leading-7 font-semibold text-text">
          {title}
        </h2>
        {description === undefined ? null : (
          <p className="text-sm text-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/**
 * A labelled show/hide section for secondary detail. The content stays
 * mounted while closed, so a form inside keeps its typed draft and its
 * unsaved-work guard. Pass `open` to follow a URL or other outside state.
 */
export function HrDisclosure({
  label,
  badge,
  open: controlledOpen,
  defaultOpen = false,
  onToggle,
  id,
  className,
  contentClassName,
  testId,
  children,
}: {
  readonly label: string;
  /** A short count or state beside the label. */
  readonly badge?: ReactNode;
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean;
  readonly onToggle?: (open: boolean) => void;
  /** Placed on the wrapper, e.g. a deep-link focus target. */
  readonly id?: string;
  readonly className?: string | undefined;
  readonly contentClassName?: string | undefined;
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  const panelId = useId();
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  return (
    <div id={id} className={cn("rounded-lg", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (controlledOpen === undefined) setLocalOpen(!open);
          onToggle?.(!open);
        }}
        className="flex min-h-touch w-full items-center gap-2 rounded-lg py-2 text-left text-sm font-semibold text-text outline-none hover:text-link focus-visible:ring-3 focus-visible:ring-ring"
        {...(testId === undefined ? {} : { "data-testid": testId })}
      >
        <span className="min-w-0 break-words">{label}</span>
        {badge === undefined ? null : (
          <span className="rounded-full bg-raised px-2 py-0.5 text-xs font-normal text-muted tabular-nums">
            {badge}
          </span>
        )}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "ml-auto size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      <div
        id={panelId}
        role="group"
        aria-label={label}
        hidden={!open}
        className={cn("pt-2 pb-1", contentClassName)}
      >
        {children}
      </div>
    </div>
  );
}
