import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface DescriptionItem {
  /** Stable key; defaults to the label when it is a string. */
  readonly id?: string;
  readonly label: ReactNode;
  readonly value: ReactNode;
}

const GRID_COLUMNS = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
} as const;

/**
 * Labelled facts for summaries and inspectors.
 * - `rows`: label beside value from `sm` (label above it on phones).
 * - `dense`: label beside value at every width, for narrow evidence cards.
 * - `grid`: small label above each value in 2–4 columns (metrics).
 * - `stat`: a statistic strip; values are large tabular figures.
 * Callers supply the values, including units, already formatted.
 */
export function DescriptionList({
  items,
  layout = "rows",
  columns = 2,
  label,
  className,
}: {
  readonly items: readonly DescriptionItem[];
  readonly layout?: "rows" | "dense" | "grid" | "stat";
  readonly columns?: keyof typeof GRID_COLUMNS;
  /** Accessible name when the list stands alone (for example a stat strip). */
  readonly label?: string;
  readonly className?: string;
}) {
  const stacked = layout === "grid" || layout === "stat";
  return (
    <dl
      {...(label === undefined ? {} : { "aria-label": label })}
      className={cn(
        "min-w-0 text-sm",
        layout === "rows" &&
          "grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_minmax(0,1fr)]",
        layout === "dense" &&
          "grid grid-cols-[minmax(5.5rem,max-content)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5",
        stacked && cn("grid gap-x-4 gap-y-3", GRID_COLUMNS[columns]),
        className,
      )}
    >
      {items.map((item, index) => {
        const key =
          item.id ??
          (typeof item.label === "string" ? item.label : String(index));
        return stacked ? (
          <div key={key} className="min-w-0">
            <dt className="text-xs leading-[1.125rem] break-words text-muted">
              {item.label}
            </dt>
            <dd
              className={cn(
                "mt-1 min-w-0 break-words text-text tabular-nums",
                layout === "stat"
                  ? "text-2xl leading-8 font-semibold"
                  : "font-semibold",
              )}
            >
              {item.value}
            </dd>
          </div>
        ) : (
          <div key={key} className="contents">
            <dt className="break-words text-muted">{item.label}</dt>
            <dd className="min-w-0 font-medium break-words text-text">
              {item.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
