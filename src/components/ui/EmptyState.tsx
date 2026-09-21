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
}: {
  readonly icon?: ReactNode;
  readonly title: string;
  readonly body?: ReactNode;

  readonly action?: ReactNode;

  readonly testId?: string;
}) {
  return (
    <Empty
      role="status"
      className="min-h-40 border border-dashed border-border-strong bg-surface py-8"
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      <EmptyHeader>
        {icon === undefined ? null : (
          <div className="text-muted" aria-hidden="true">
            {icon}
          </div>
        )}
        <EmptyTitle className="text-base font-semibold text-text">
          {title}
        </EmptyTitle>
        {body === undefined ? null : (
          <EmptyDescription className="leading-relaxed text-muted">
            {body}
          </EmptyDescription>
        )}
      </EmptyHeader>
      {action === undefined ? null : <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
