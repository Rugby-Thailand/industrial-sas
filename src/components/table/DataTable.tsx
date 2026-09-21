"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { TableScroller } from "@/components/ui/TableScroller";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  readonly emptyState?: ReactNode;
  readonly stickyAction?: boolean;
  readonly sortableHeader?: (column: DataTableColumn<Row>) => ReactNode;
  readonly sortColumn?: string;
  readonly sortDirection?: "ascending" | "descending" | "none";
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
  emptyState,
  stickyAction = true,
  sortableHeader,
  sortColumn,
  sortDirection = "none",
}: DataTableProps<Row>) {
  const hasActions = renderAction !== undefined && actionHeader !== undefined;
  const t = useTranslations("Panel");

  return (
    <TableScroller
      label={caption}
      {...(testId === undefined ? {} : { testId })}
    >
      <Table scroll={false} className={cn("border-collapse", tableClassName)}>
        <TableCaption className="px-4 py-3 text-left">{caption}</TableCaption>
        <TableHeader>
          <TableRow className="border-b border-border-strong text-left">
            {columns.map((column) => (
              <TableHead
                key={column.key}
                scope="col"
                aria-sort={sortColumn === column.key ? sortDirection : "none"}
                className={cn(
                  "px-4 py-2 font-semibold",
                  alignmentClass[column.align ?? "left"],
                  "whitespace-nowrap",
                )}
              >
                {sortableHeader ? sortableHeader(column) : column.header}
              </TableHead>
            ))}
            {hasActions ? (
              <TableHead
                scope="col"
                className={cn(
                  "bg-surface px-4 py-2 font-semibold whitespace-nowrap",
                  stickyAction &&
                    "@2xl/table:sticky @2xl/table:right-0 @2xl/table:shadow-[inset_1px_0_0_0_var(--color-border)]",
                )}
              >
                {actionHeader}
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length + (hasActions ? 1 : 0)}>
                {emptyState ?? (
                  <EmptyState title={t("empty")} body={t("emptyHint")} />
                )}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
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
                    <TableHead
                      key={column.key}
                      scope="row"
                      className={cn(className, "font-normal")}
                    >
                      {column.render(row)}
                    </TableHead>
                  ) : (
                    <TableCell key={column.key} className={className}>
                      {column.render(row)}
                    </TableCell>
                  );
                })}
                {hasActions ? (
                  <TableCell
                    className={cn(
                      "bg-surface px-4 py-3 align-middle whitespace-nowrap",
                      stickyAction &&
                        "@2xl/table:sticky @2xl/table:right-0 @2xl/table:shadow-[inset_1px_0_0_0_var(--color-border)]",
                    )}
                  >
                    {renderAction(row)}
                  </TableCell>
                ) : null}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableScroller>
  );
}
