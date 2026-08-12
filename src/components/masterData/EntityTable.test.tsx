import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import { EntityTable, type ColumnSpec } from "./EntityTable";

/**
 * The shared table structure, and the narrow-screen behaviour the audit asked
 * for.
 *
 * The structural assertions are here rather than repeated per entity because
 * the structure is what `EntityTable` exists to make uniform: one row header,
 * a caption, a column header for every column. The rest is the response to the
 * finding that a 360px viewport hid UOM, dates, and the action control with
 * nothing on screen saying they were there. jsdom lays nothing out, so what can
 * be asserted is the region, its name, its tab stop, the hint, and the classes
 * that pin the trailing column — which is the part that regresses silently.
 */

interface Row {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

const ROWS: readonly Row[] = [
  { id: "1", code: "STEEL-COIL", name: "เหล็กม้วนรีดร้อน" },
  { id: "2", code: "RESIN-HD", name: "เม็ดพลาสติก" },
];

const COLUMNS: readonly ColumnSpec<Row>[] = [
  { key: "code", header: "รหัส", rowHeader: true, render: (row) => row.code },
  { key: "name", header: "ชื่อ", render: (row) => row.name },
];

const CAPTION = "รายการทดสอบ 2 รายการ";

const renderTable = (
  props: Partial<Parameters<typeof EntityTable<Row>>[0]> = {},
  locale: "th" | "en" = "th",
) =>
  renderWithIntl(
    <EntityTable<Row>
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

describe("EntityTable", () => {
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
    /*
     * An `overflow-x-auto` box that no element inside can take focus is
     * unscrollable without a pointer (WCAG 2.2 2.1.1, axe
     * `scrollable-region-focusable`). The name is the caption, so the region
     * says which table it belongs to rather than "region".
     */
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
    // The handheld shell stays narrow in a desktop viewport, so this follows
    // the table container instead of the viewport.
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
    // An always-sticky cell hid the end of status and quantity values inside
    // the handheld shell. Container-query variants keep the narrow view honest.
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
    // A code that wraps mid-token is unreadable and unscannable; the table
    // scrolls instead (`UX §3`).
    renderTable();

    expect(screen.getByRole("rowheader", { name: "STEEL-COIL" })).toHaveClass(
      "whitespace-nowrap",
    );
  });
});
