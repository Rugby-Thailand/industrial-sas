"use client";

/**
 * The box a wide table lives in, and the three things that make scrolling it
 * honest.
 *
 * Every collection in this application is a real `<table>` whose columns are
 * allowed to be wider than a 360px viewport, because a quantity or a code
 * squeezed to two characters is worse than one an operator has to scroll to
 * (`UX §3`). That decision is only defensible if the scrolling is reachable and
 * visible, so this component carries all three parts of it in one place:
 *
 * - **The scroller is a focusable, named region.** Without `tabindex` a keyboard
 *   cannot scroll an `overflow-x-auto` box at all (WCAG 2.2 2.1.1, axe
 *   `scrollable-region-focusable`). The name is the table's caption, so the
 *   region announces which table it belongs to rather than "region".
 * - **A narrow container says so in words.** The handheld shell remains 448px
 *   wide even when it is previewed in a desktop viewport, so a viewport media
 *   query cannot tell us whether the table still scrolls. The cue follows this
 *   container instead and stays visible until the table has desktop-room.
 * - **The frame is one shape.** The rounded border and surface come from here,
 *   so the master-data tables and the inventory tables cannot drift apart.
 *
 * It exists as its own component rather than inside `EntityTable` because the
 * two inventory tables are not `EntityTable`s — they render their own thead for
 * a right-aligned quantity and a stacked bucket identity — and they were the
 * tables the audit found with no keyboard-reachable scroller and no cue at all.
 * A copy of the markup in each would have been a third place for the region to
 * go missing.
 *
 * `Table` is a chrome namespace, like `Panel` and `Pagination`, for the reason
 * `EntityTable` documents: this renders on nearly every screen, so a domain
 * namespace here would be paid for by all of them (`@/i18n/clientMessages`).
 */
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

export function TableScroller({
  label,
  testId,
  children,
}: {
  /** The accessible name of the scrollable region: the table's caption. */
  readonly label: string;
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  const t = useTranslations("Table");

  return (
    <div
      className="@container/table overflow-hidden rounded-lg border border-border bg-surface"
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className="overflow-x-auto"
      >
        {children}
      </div>
      <p className="border-t border-border px-4 py-2 text-xs text-muted @2xl/table:hidden">
        {t("scrollHint")}
      </p>
    </div>
  );
}
