"use client";

import type { ReactNode } from "react";

import { TableScroller } from "@/components/ui/TableScroller";
import { cn } from "@/lib/utils";

export interface DataTableColumn<Row> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: Row) => ReactNode;
  readonly rowHeader?: boolean;
  readonly monospace?: boolean;
  readonly align?: "left" | "center" | "right";
  readonly cellClassName?: string;
}

export interface DataTableProps<Row> {
  readonly caption: string;
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  readonly actionHeader?: string;
  readonly renderAction?: (row: Row) => ReactNode;
  readonly testId?: string;
  readonly tableClassName?: string;
}

const alignmentClass = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
} as const;

export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  actionHeader,
  renderAction,
  testId,
  tableClassName,
}: DataTableProps<Row>) {
  const hasActions = renderAction !== undefined && actionHeader !== undefined;

  return (
    <TableScroller
      label={caption}
      {...(testId === undefined ? {} : { testId })}
    >
      <table className={cn("w-full border-collapse text-sm", tableClassName)}>
        <caption className="px-4 py-3 text-left text-sm text-muted">
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-border-strong text-left">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "px-4 py-2 font-semibold",
                  alignmentClass[column.align ?? "left"],
                  "whitespace-nowrap",
                )}
              >
                {column.header}
              </th>
            ))}
            {hasActions ? (
              <th
                scope="col"
                className="bg-surface px-4 py-2 font-semibold whitespace-nowrap @2xl/table:sticky @2xl/table:right-0 @2xl/table:shadow-[inset_1px_0_0_0_var(--color-border)]"
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
              {columns.map((column) => {
                const className = cn(
                  "px-4 py-3",
                  alignmentClass[column.align ?? "left"],
                  "align-top",
                  column.monospace === true &&
                    "font-mono text-xs whitespace-nowrap",
                  column.rowHeader === true &&
                    column.monospace !== false &&
                    "font-mono text-xs whitespace-nowrap",
                  column.cellClassName,
                );

                return column.rowHeader === true ? (
                  <th
                    key={column.key}
                    scope="row"
                    className={cn(className, "font-normal")}
                  >
                    {column.render(row)}
                  </th>
                ) : (
                  <td key={column.key} className={className}>
                    {column.render(row)}
                  </td>
                );
              })}
              {hasActions ? (
                <td className="bg-surface px-4 py-3 align-middle whitespace-nowrap @2xl/table:sticky @2xl/table:right-0 @2xl/table:shadow-[inset_1px_0_0_0_var(--color-border)]">
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
