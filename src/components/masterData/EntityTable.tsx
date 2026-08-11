"use client";

/**
 * A master-data collection, as a semantic table.
 *
 * `ItemsTable` and `LocationsTable` were written one at a time and stayed that
 * way; six more written the same way would be six more chances to forget a
 * `scope`, a caption, or the row header that makes a screen reader announce
 * which row it is reading. The structure is the part that must not vary, so the
 * structure is here and only the columns are per-entity.
 *
 * Two rules the column model enforces rather than documents:
 *
 * - **Exactly one column is the row header.** `<th scope="row">` is what turns
 *   a grid of cells into rows an assistive technology can navigate; a table
 *   with none reads as an undifferentiated block.
 * - **Every column has a header string.** There is no way to express a column
 *   with an empty `<th>`, which is the most common way a table quietly becomes
 *   unnavigable.
 *
 * The wrapper scrolls horizontally rather than letting columns collapse. A
 * quantity or a code that has been squeezed to two characters is worse than one
 * an operator has to scroll to (`UX §3`).
 */
import type { ReactNode } from "react";

export interface ColumnSpec<Row> {
  /** Stable key. Never rendered. */
  readonly key: string;
  readonly header: string;
  /** The identifying column, rendered as `<th scope="row">`. Exactly one. */
  readonly rowHeader?: boolean;
  /** Code identifiers are monospaced; names, which may be Thai, are not. */
  readonly monospace?: boolean;
  readonly render: (row: Row) => ReactNode;
}

export function EntityTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  actionHeader,
  renderAction,
  testId,
}: {
  readonly caption: string;
  readonly columns: readonly ColumnSpec<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  /** The header for the trailing control column, when there is one. */
  readonly actionHeader?: string;
  readonly renderAction?: (row: Row) => ReactNode;
  readonly testId?: string;
}) {
  const hasActions = renderAction !== undefined && actionHeader !== undefined;

  return (
    <div
      className="overflow-x-auto rounded-lg border border-border bg-surface"
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      <table className="w-full border-collapse text-sm">
        <caption className="px-4 py-3 text-left text-sm text-muted">
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-border-strong text-left">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="px-4 py-2 font-semibold"
              >
                {column.header}
              </th>
            ))}
            {hasActions ? (
              <th scope="col" className="px-4 py-2 font-semibold">
                {actionHeader}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-border last:border-0"
            >
              {columns.map((column) =>
                column.rowHeader === true ? (
                  <th
                    key={column.key}
                    scope="row"
                    className="px-4 py-3 text-left font-mono text-xs font-normal text-text"
                  >
                    {column.render(row)}
                  </th>
                ) : (
                  <td
                    key={column.key}
                    className={`px-4 py-3 ${
                      column.monospace === true ? "font-mono text-xs" : ""
                    }`}
                  >
                    {column.render(row)}
                  </td>
                ),
              )}
              {hasActions ? (
                <td className="px-4 py-3">{renderAction(row)}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
