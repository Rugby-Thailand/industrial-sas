"use client";

import type { ReactNode } from "react";

import { TableScroller } from "@/components/ui/TableScroller";

export interface ColumnSpec<Row> {
  readonly key: string;
  readonly header: string;

  readonly rowHeader?: boolean;

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

  readonly actionHeader?: string;
  readonly renderAction?: (row: Row) => ReactNode;
  readonly testId?: string;
}) {
  const hasActions = renderAction !== undefined && actionHeader !== undefined;

  return (
    <TableScroller
      label={caption}
      {...(testId === undefined ? {} : { testId })}
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
              <th
                scope="col"
                className="bg-surface px-4 py-2 font-semibold @2xl/table:sticky @2xl/table:right-0 @2xl/table:shadow-[inset_1px_0_0_0_var(--color-border)]"
              >
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
                    className="px-4 py-3 text-left font-mono text-xs font-normal whitespace-nowrap text-text"
                  >
                    {column.render(row)}
                  </th>
                ) : (
                  <td
                    key={column.key}
                    className={`px-4 py-3 ${
                      column.monospace === true
                        ? "font-mono text-xs whitespace-nowrap"
                        : ""
                    }`}
                  >
                    {column.render(row)}
                  </td>
                ),
              )}
              {hasActions ? (
                <td className="bg-surface px-4 py-3 @2xl/table:sticky @2xl/table:right-0 @2xl/table:shadow-[inset_1px_0_0_0_var(--color-border)]">
                  {renderAction(row)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}
