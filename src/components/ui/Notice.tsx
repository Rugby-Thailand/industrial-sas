import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

import { type BadgeTone } from "./StatusBadge";

const TONE_SURFACE: Readonly<Record<BadgeTone, string>> = {
  neutral: "bg-surface",
  accent: "bg-accent-surface",
  success: "bg-success-surface",
  warning: "bg-warning-surface",
  danger: "bg-danger-surface",
  pending: "bg-pending-surface",
  muted: "bg-surface",
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
  layout,
  action,
  children,
  className,
}: {
  readonly tone?: BadgeTone;
  readonly title: string;
  readonly body?: string;
  readonly role?: "status" | "alert";
  readonly testId?: string;
  readonly layout?: "inline" | "row" | "panel";
  readonly action?: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  const hasDetails = children != null && children !== false;
  const presentation = layout ?? (hasDetails ? "panel" : "row");
  const hasAction = action != null && action !== false;
  return (
    <div
      role={hasAction ? undefined : role}
      {...(testId === undefined ? {} : { "data-testid": testId })}
      className={cn(
        "min-w-0 text-sm",
        presentation === "inline"
          ? "py-1"
          : cn(
              "rounded-lg border border-border px-3",
              TONE_SURFACE[tone],
              presentation === "panel" ? "py-3" : hasAction ? "py-0.5" : "py-2",
            ),
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <div
          role={hasAction ? role : undefined}
          className="min-w-0 flex-[1_1_10rem] wrap-anywhere"
        >
          <p
            className={cn("leading-5 font-semibold", TONE_TITLE_CLASSES[tone])}
          >
            {title}
          </p>
          {body ? <p className="leading-5 text-text">{body}</p> : null}
        </div>
        {hasAction ? (
          <div className="max-w-full [&_a]:whitespace-normal [&_button]:whitespace-normal">
            {action}
          </div>
        ) : null}
      </div>
      {hasDetails ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

export function ErrorNotice({ message }: { readonly message?: string | null }) {
  return message ? (
    <Notice layout="inline" tone="danger" title={message} role="alert" />
  ) : null;
}
