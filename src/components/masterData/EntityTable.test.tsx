import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import { DataTable, type DataTableColumn } from "@/components/table/DataTable";

interface Row {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

const ROWS: readonly Row[] = [
  { id: "1", code: "STEEL-COIL", name: "เหล็กม้วนรีดร้อน" },
  { id: "2", code: "RESIN-HD", name: "เม็ดพลาสติก" },
];

const COLUMNS: readonly DataTableColumn<Row>[] = [
  { key: "code", header: "รหัส", rowHeader: true, render: (row) => row.code },
  { key: "name", header: "ชื่อ", render: (row) => row.name },
];

const CAPTION = "รายการทดสอบ 2 รายการ";

const renderTable = (
  props: Partial<Parameters<typeof DataTable<Row>>[0]> = {},
  locale: "th" | "en" = "th",
) =>
  renderWithIntl(
    <DataTable<Row>
      caption={CAPTION}
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(row) => row.id}
      {...props}
    />,
    { locale },
  );

const withAction = () => ({
  actionHeader: "การทำงาน",
  renderAction: (row: Row) => (
    <button type="button">{`เลือก ${row.code}`}</button>
  ),
});

describe("DataTable", () => {
  it("is a semantic table with a caption, column headers, and a row header", () => {
    renderTable();

    const table = screen.getByRole("table", { name: CAPTION });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(2);
    expect(within(table).getAllByRole("rowheader")).toHaveLength(ROWS.length);
    expect(
      within(table).getByRole("rowheader", { name: "STEEL-COIL" }),
    ).toBeInTheDocument();
  });

  it("puts the scroller in a named region a keyboard can reach", () => {
    renderTable();

    const region = screen.getByRole("region", { name: CAPTION });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("overflow-x-auto");
    expect(within(region).getByRole("table")).toBeInTheDocument();
  });

  it("tells a narrow screen that the columns continue past the edge", () => {
    renderTable();

    const hint = screen.getByText(
      "เลื่อนตารางไปทางซ้าย-ขวาเพื่อดูคอลัมน์ที่เหลือ",
    );

    expect(hint).toHaveClass("@2xl/table:hidden");
  });

  it("gives the hint in the active locale", () => {
    renderTable({}, "en");
    expect(
      screen.getByText(
        "Scroll the table sideways to see the remaining columns.",
      ),
    ).toBeInTheDocument();
  });

  it("pins the trailing action only when the table container is wide", () => {
    renderTable(withAction());

    const header = screen.getByRole("columnheader", { name: "การทำงาน" });
    expect(header).toHaveClass(
      "@2xl/table:sticky",
      "@2xl/table:right-0",
      "bg-surface",
    );
    expect(header).not.toHaveClass("sticky", "right-0");

    const action = screen.getByRole("button", { name: "เลือก STEEL-COIL" });
    const cell = action.closest("td");
    expect(cell).toHaveClass(
      "@2xl/table:sticky",
      "@2xl/table:right-0",
      "bg-surface",
    );
    expect(cell).not.toHaveClass("sticky", "right-0");
  });

  it("renders no action column when there is no action", () => {
    renderTable();

    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("keeps identifier columns on one line so scrolling is the only reflow", () => {
    renderTable();

    expect(screen.getByRole("rowheader", { name: "STEEL-COIL" })).toHaveClass(
      "whitespace-nowrap",
    );
  });
});
