import type { ReactNode } from "react";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export function EmptyState({
  icon,
  title,
  body,
  action,
  testId,
  compact = false,
  announce = true,
}: {
  readonly icon?: ReactNode;
  readonly title: string;
  readonly body?: ReactNode;

  readonly action?: ReactNode;

  readonly testId?: string;
  readonly compact?: boolean;
  readonly announce?: boolean;
}) {
  return (
    <Empty
      role={announce ? "status" : undefined}
      className={
        compact
          ? "items-start justify-start gap-1 rounded-none border-0 px-0 py-2 text-start text-wrap"
          : "min-h-40 border border-dashed border-border-strong bg-surface py-8"
      }
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      <EmptyHeader className={compact ? "max-w-none items-start gap-0.5" : ""}>
        {icon === undefined ? null : (
          <div className="text-muted" aria-hidden="true">
            {icon}
          </div>
        )}
        <EmptyTitle
          className={
            compact
              ? "font-semibold text-text"
              : "text-base font-semibold text-text"
          }
        >
          {title}
        </EmptyTitle>
        {body === undefined ? null : (
          <EmptyDescription className="leading-relaxed text-muted">
            {body}
          </EmptyDescription>
        )}
      </EmptyHeader>
      {action === undefined ? null : (
        <EmptyContent className={compact ? "w-auto items-start" : ""}>
          {action}
        </EmptyContent>
      )}
    </Empty>
  );
}
