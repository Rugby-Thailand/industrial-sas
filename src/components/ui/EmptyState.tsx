/**
 * "There is nothing here", said in a way an operator can act on.
 *
 * Distinct from `Notice` on purpose. A notice is a message *about* content that
 * exists elsewhere on the screen; this replaces the content. The visual
 * difference — a dashed outline where rows would have been, rather than a solid
 * bordered card beside them — is what tells a supervisor at a glance that the
 * read succeeded and returned nothing, as opposed to failing.
 *
 * That distinction is the one this component exists to protect: **an empty
 * result and a refused read must never look the same**. A denial rendered as an
 * empty table is a supervisor concluding the warehouse is empty. Refusals go
 * through `LedgerPanelStatus`, which is loud, `role="alert"`, and quotes a
 * request ID; this is quiet and polite.
 *
 * `action` is where "no rows *yet*" becomes a next step — the link that creates
 * the first one, or the control that clears the filter that hid them all. The
 * research note is specific that "no stock" and "no results for these filters"
 * are different sentences with different actions, and this component takes both
 * as parameters rather than guessing.
 */
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
  /** A next step: a link that creates the first row, or clears a filter. */
  readonly action?: ReactNode;
  /** A stable hook for end-to-end assertions; never affects presentation. */
  readonly testId?: string;
}) {
  return (
    <Empty
      /*
       * Polite, not assertive. An empty table is a result, and `role="alert"`
       * here would interrupt a screen reader mid-sentence on every screen that
       * has nothing on it yet.
       */
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
