import type { ReactNode } from "react";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export function EmptyState({
  title,
  body,
  action,
  testId,
}: {
  readonly title: string;
  readonly body?: string;

  readonly action?: ReactNode;

  readonly testId?: string;
}) {
  return (
    <Empty
      role="status"
      className="border border-dashed border-border-strong bg-surface"
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      <EmptyHeader>
        <EmptyTitle className="text-sm font-semibold text-text">
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
