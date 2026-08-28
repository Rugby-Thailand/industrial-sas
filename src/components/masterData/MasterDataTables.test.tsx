import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import { ItemsTable } from "./ItemsTable";
import { LocationsTable } from "./LocationsTable";

import {
  PREVIEW_ITEMS,
  previewLocationsFor,
} from "@tests/fixtures/data/masterData";

describe("ItemsTable", () => {
  it("is a real table with a caption and column headers", () => {
    renderWithIntl(<ItemsTable rows={PREVIEW_ITEMS} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "รหัสสินค้า" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(PREVIEW_ITEMS.length + 1);
  });

  it("renders Thai item names, which are the layout baseline", () => {
    renderWithIntl(<ItemsTable rows={PREVIEW_ITEMS} />);
    expect(screen.getByText("เหล็กม้วนรีดร้อน")).toBeInTheDocument();
  });

  it("keeps the SKU as a code identifier in both locales", () => {
    // `D-06`: code identifiers stay English. The SKU is the string an operator
    // scans and a supervisor searches, so it must not be translated.
    const thai = renderWithIntl(<ItemsTable rows={PREVIEW_ITEMS} />);
    expect(thai.getByText("STEEL-COIL")).toBeInTheDocument();
    thai.unmount();

    const english = renderWithIntl(<ItemsTable rows={PREVIEW_ITEMS} />, {
      locale: "en",
    });
    expect(english.getByText("STEEL-COIL")).toBeInTheDocument();
  });

  it("names the tracking mode in words and marks the disabled one", () => {
    // `LOT_SERIAL` flows are off (D-09), so an item in that mode cannot be
    // received today. That belongs on the row, not in a manual.
    renderWithIntl(
      <ItemsTable
        rows={[{ ...PREVIEW_ITEMS[0]!, trackingMode: "LOT_SERIAL" }]}
      />,
    );

    expect(
      screen.getByText("ล็อตและซีเรียล (ยังไม่เปิดใช้)"),
    ).toBeInTheDocument();
  });

  it("shows a deactivated item as such rather than hiding it", () => {
    renderWithIntl(<ItemsTable rows={PREVIEW_ITEMS} />);
    expect(screen.getByText("เลิกใช้")).toBeInTheDocument();
  });

  it("offers no control that could edit master data", () => {
    renderWithIntl(<ItemsTable rows={PREVIEW_ITEMS} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("renders an empty catalogue without inventing a row", () => {
    renderWithIntl(<ItemsTable rows={[]} />);
    expect(screen.getAllByRole("row")).toHaveLength(1);
  });
});

describe("LocationsTable", () => {
  const rows = previewLocationsFor("prv_wh_bangpoo");

  it("renders one warehouse's locations by code", () => {
    renderWithIntl(<LocationsTable rows={rows} />);

    expect(screen.getByText("A01-02-1")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(rows.length + 1);
  });

  it("does not repeat the warehouse on every row", () => {
    // The whole table is one warehouse's, chosen in the shell chrome. A column
    // would suggest the list could span sites, which it cannot.
    renderWithIntl(<LocationsTable rows={rows} />);
    expect(screen.queryByText("prv_wh_bangpoo")).toBeNull();
  });

  it("names each location type in the active locale", () => {
    renderWithIntl(<LocationsTable rows={rows} />);
    expect(screen.getAllByText("ช่องชั้นวาง").length).toBeGreaterThan(0);
    expect(screen.getByText("ท่ารับ-ส่ง")).toBeInTheDocument();
  });

  it("falls back to the raw code for a type the catalogue does not know", () => {
    renderWithIntl(
      <LocationsTable
        rows={[{ ...rows[0]!, locationType: "SOME_FUTURE_TYPE" }]}
      />,
    );
    expect(screen.getByText("SOME_FUTURE_TYPE")).toBeInTheDocument();
  });

  it("can place an interactive switch in the status column and icon actions separately", () => {
    renderWithIntl(
      <LocationsTable
        rows={[rows[0]!]}
        renderStatus={(row) => (
          <button type="button" aria-label={`toggle ${row.code}`} />
        )}
        renderAction={(row) => (
          <button type="button" aria-label={`map ${row.code}`} />
        )}
      />,
    );

    expect(
      screen.getByRole("button", { name: "toggle A01-02-1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "map A01-02-1" }),
    ).toBeInTheDocument();
  });
});
