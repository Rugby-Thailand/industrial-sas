/**
 * A persistent, titled message with a next action — the shape every non-happy
 * state on a warehouse screen takes.
 *
 * Not a toast. The UX plan (§2.4, §6) is explicit that a state an operator has
 * to act on stays on the page near what it refers to; a message that disappears
 * on a timer is unreadable to someone whose hands are busy and unavailable to
 * anyone who looked away.
 *
 * `role` is a parameter with a deliberate default of `"status"` (polite).
 * `"alert"` interrupts a screen reader mid-sentence, which is right for a
 * failure the operator must handle now and wrong for "loading" and "no rows" —
 * and a component that hard-coded `role="alert"` would make every empty table
 * shout.
 */
import type { ReactNode } from "react";

import { type BadgeTone } from "./StatusBadge";

const TONE_CLASSES: Readonly<Record<BadgeTone, string>> = {
  neutral: "border-border-strong",
  accent: "border-accent",
  success: "border-success",
  warning: "border-warning",
  danger: "border-danger",
  pending: "border-pending",
  muted: "border-border",
};

const TONE_TITLE_CLASSES: Readonly<Record<BadgeTone, string>> = {
  neutral: "text-text",
  accent: "text-accent",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  pending: "text-pending",
  muted: "text-muted",
};

export function Notice({
  tone = "neutral",
  title,
  body,
  role = "status",
  testId,
  children,
}: {
  readonly tone?: BadgeTone;
  readonly title: string;
  readonly body?: string;
  readonly role?: "status" | "alert";
  /** A stable hook for end-to-end assertions; never affects presentation. */
  readonly testId?: string;
  /** Actions, links, or detail. Rendered under the body. */
  readonly children?: ReactNode;
}) {
  return (
    <div
      role={role}
      {...(testId === undefined ? {} : { "data-testid": testId })}
      className={`rounded-lg border border-l-4 border-border bg-surface p-4 ${TONE_CLASSES[tone]}`}
    >
      <p className={`text-sm font-semibold ${TONE_TITLE_CLASSES[tone]}`}>
        {title}
      </p>
      {body === undefined ? null : (
        <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
      )}
      {children === undefined ? null : <div className="mt-3">{children}</div>}
    </div>
  );
}
