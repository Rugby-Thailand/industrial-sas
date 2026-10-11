import type { ReactNode } from "react";

export type BadgeTone =
  "neutral" | "accent" | "success" | "warning" | "danger" | "pending" | "muted";

const TONE_CLASSES: Readonly<Record<BadgeTone, string>> = {
  neutral: "border-border-strong bg-raised text-text",
  accent: "border-link bg-selected text-link",
  success: "border-badge-success bg-badge-success-surface text-badge-success",
  warning: "border-badge-warning bg-badge-warning-surface text-badge-warning",
  danger: "border-badge-danger bg-badge-danger-surface text-badge-danger",
  pending: "border-badge-pending bg-badge-pending-surface text-badge-pending",
  muted: "border-border-strong bg-raised text-muted",
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
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${TONE_CLASSES[tone]}`}
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
