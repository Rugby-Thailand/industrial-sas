import type { ReactNode } from "react";

export type BadgeTone =
  "neutral" | "accent" | "success" | "warning" | "danger" | "pending" | "muted";

const TONE_CLASSES: Readonly<Record<BadgeTone, string>> = {
  neutral: "border-border-strong text-text",
  accent: "border-accent text-accent",
  success: "border-success text-success",
  warning: "border-warning text-warning",
  danger: "border-danger text-danger",
  pending: "border-pending text-pending",
  muted: "border-border-strong text-muted",
};

const TONE_GLYPHS: Readonly<Record<BadgeTone, string>> = {
  neutral: "■",
  accent: "◆",
  success: "●",
  warning: "▲",
  danger: "✕",
  pending: "◐",
  muted: "○",
};

export function StatusBadge({
  tone,
  label,
  title,
  icon,
  children,
}: {
  readonly tone: BadgeTone;

  readonly label: string;

  readonly title?: string;

  readonly icon?: ReactNode;

  readonly children?: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border bg-surface px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${TONE_CLASSES[tone]}`}
      {...(title === undefined ? {} : { title })}
    >
      <span aria-hidden="true" className="shrink-0">
        {icon ?? TONE_GLYPHS[tone]}
      </span>
      <span>{label}</span>
      {children}
    </span>
  );
}
