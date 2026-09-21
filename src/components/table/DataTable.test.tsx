import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { DataTable } from "./DataTable";

type Row = { id: string; name: string };
const columns = [
  { key: "name", header: "Name", render: (row: Row) => row.name },
] as const;

describe("DataTable", () => {
  it("renders the localized empty state inside one scroll region", () => {
    renderWithIntl(
      <DataTable<Row>
        caption="Products"
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
      />,
      { locale: "en" },
    );

    expect(screen.getByRole("status")).toHaveTextContent("No data");
    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(screen.getByRole("region")).toHaveClass("overflow-x-auto");
  });

  it("exposes sortable column state through aria-sort", () => {
    renderWithIntl(
      <DataTable<Row>
        caption="Products"
        columns={columns}
        rows={[{ id: "1", name: "Widget" }]}
        rowKey={(row) => row.id}
        sortColumn="name"
        sortDirection="ascending"
        sortableHeader={(column) => (
          <button type="button">{column.header}</button>
        )}
      />,
      { locale: "en" },
    );

    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });
});
