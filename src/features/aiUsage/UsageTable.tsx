"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { FileText } from "lucide-react";

/** One column header; `numeric` columns align right. */
export interface UsageColumn {
  readonly key: string;
  readonly label: ReactNode;
  readonly numeric?: boolean;
  readonly className?: string;
}

export const CELL = "px-3 py-3 align-top first:pl-2 last:pr-2 sm:px-4";
export const NUMERIC = "text-right tabular-nums";

/**
 * A report table that keeps its column headers in every state and scrolls
 * horizontally inside its own section on narrow screens, never widening the
 * page. The scroll region is focusable so keyboard users can scroll it.
 */
export function UsageTable({
  label,
  columns,
  minWidth,
  empty,
  status,
  children,
}: {
  readonly label: string;
  readonly columns: readonly UsageColumn[];
  /** Tailwind min-width class that triggers horizontal scroll. */
  readonly minWidth: string;
  /** Shown as one centred row when there is nothing to list. */
  readonly empty?: ReactNode;
  /** A loading message shown as one row instead of data. */
  readonly status?: ReactNode;
  readonly children?: ReactNode;
}) {
  const t = useTranslations("AiUsage");
  return (
    <div
      role="region"
      aria-label={t("scrollTable", { name: label })}
      tabIndex={0}
      className="usage-scroll -mx-1 min-w-0 overflow-x-auto border-b border-border px-1 pb-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <table className={`w-full ${minWidth} text-sm`}>
        <caption className="sr-only">{label}</caption>
        <thead className="border-b border-border text-left text-muted">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`${CELL} py-2.5 font-normal whitespace-nowrap ${
                  column.numeric ? "text-right" : ""
                } ${column.className ?? ""}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {status !== undefined ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-sm text-muted"
              >
                <span role="status">{status}</span>
              </td>
            </tr>
          ) : empty !== undefined ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8">
                <EmptyMessage>{empty}</EmptyMessage>
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

/** The centred document icon and message of an empty table. */
function EmptyMessage({ children }: { readonly children: ReactNode }) {
  return (
    // Sticky centring keeps the message in view while the table scrolls.
    <span className="sticky left-1/2 flex w-max max-w-[calc(100vw-4rem)] -translate-x-1/2 flex-col items-center gap-2 text-center text-sm text-muted">
      <FileText aria-hidden="true" className="size-7 stroke-[1.5]" />
      <span>{children}</span>
    </span>
  );
}
