import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

import { type BadgeTone } from "./StatusBadge";

const TONE_CLASSES: Readonly<Record<BadgeTone, string>> = {
  neutral: "border-border-strong",
  accent: "border-link",
  success: "border-success",
  warning: "border-warning",
  danger: "border-danger",
  pending: "border-pending",
  muted: "border-border",
};

const TONE_TITLE_CLASSES: Readonly<Record<BadgeTone, string>> = {
  neutral: "text-text",
  accent: "text-link",
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
  className,
}: {
  readonly tone?: BadgeTone;
  readonly title: string;
  readonly body?: string;
  readonly role?: "status" | "alert";

  readonly testId?: string;

  readonly children?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      role={role}
      {...(testId === undefined ? {} : { "data-testid": testId })}
      className={cn("rounded-lg border border-l-4 bg-surface p-4", TONE_CLASSES[tone], className)}
    >
      <p className={`text-sm font-semibold ${TONE_TITLE_CLASSES[tone]}`}>
        {title}
      </p>
      {body === undefined ? null : (
        <p className="mt-1 text-sm leading-5 text-muted">{body}</p>
      )}
      {children === undefined ? null : <div className="mt-3">{children}</div>}
    </div>
  );
}

export function ErrorNotice({ message }: { readonly message?: string | null }) {
  return message ? <Notice tone="danger" title={message} role="alert" /> : null;
}
