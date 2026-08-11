/**
 * A state, rendered as a glyph *and* a word.
 *
 * `INV-0010-07` and the UX plan (§2.4) both say the same thing: no state is
 * communicated by colour alone. This component makes that structural rather than
 * a habit — the label is a required prop, so a caller cannot produce a
 * colour-only badge by omitting it, and the glyph is a second non-colour signal
 * for anyone who reads shape faster than text in bad lighting.
 *
 * The glyph is `aria-hidden`: a screen reader announces the label, and reading
 * "black circle available" helps nobody.
 */
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

/**
 * The default glyph per tone. Distinguishable by shape at a glance and by name
 * to nobody — which is why it is hidden from assistive technology.
 */
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
  children,
}: {
  readonly tone: BadgeTone;
  /** The word. Required: a badge with no text is a colour-only state. */
  readonly label: string;
  /** Optional longer explanation, surfaced as the element's tooltip. */
  readonly title?: string;
  /** Optional trailing detail rendered inside the badge. */
  readonly children?: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border bg-surface px-2.5 py-1 text-xs font-semibold ${TONE_CLASSES[tone]}`}
      {...(title === undefined ? {} : { title })}
    >
      <span aria-hidden="true">{TONE_GLYPHS[tone]}</span>
      <span>{label}</span>
      {children}
    </span>
  );
}
