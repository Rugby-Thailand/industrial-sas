import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import { BalancesTable } from "./BalancesTable";

import type { BalanceRow } from "@/lib/convex/ledgerApi";

const rows: readonly BalanceRow[] = [
  {
    bucketKey: "IB1|3:org|11:wh_bangpoo|14:item_steel_coil",
    stockStatus: "AVAILABLE",
    uom: "KG",
    minorUnits: 18_450_500,
  },
  {
    bucketKey: "IB1|3:org|11:wh_bangpoo|12:item_bolt_m8",
    stockStatus: "QC_HOLD",
    uom: "EA",
    minorUnits: 2_000_000,
  },
];

describe("BalancesTable", () => {
  it("is a real table with a caption and column headers", () => {
    renderWithIntl(<BalancesTable rows={rows} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "จำนวน" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(rows.length + 1);
  });

  it("renders quantities with the stored precision and no grouping separator", () => {
    renderWithIntl(<BalancesTable rows={rows} />);

    expect(screen.getByText("18450.500")).toBeInTheDocument();
    expect(screen.getByText("2000.000")).toBeInTheDocument();
  });

  it("names every stock status in words, never by colour alone", () => {
    // `INV-0010-07`. The badge tone is a second signal; this asserts the first
    // one exists, in Thai.
    renderWithIntl(<BalancesTable rows={rows} />);

    expect(screen.getByText("พร้อมใช้")).toBeInTheDocument();
    expect(screen.getByText("รอตรวจสอบคุณภาพ")).toBeInTheDocument();
  });

  it("renders the same statuses in English when the locale is English", () => {
    renderWithIntl(<BalancesTable rows={rows} />, { locale: "en" });

    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("QC hold")).toBeInTheDocument();
  });

  it("falls back to the raw code for a status the catalogue does not know", () => {
    // A server deployed ahead of the browser that is reading it. The code is the
    // same string the logs use, so it is reportable; a placeholder would not be.
    renderWithIntl(
      <BalancesTable
        rows={[{ ...rows[0]!, stockStatus: "SOME_FUTURE_STATUS" }]}
      />,
    );

    expect(screen.getByText("SOME_FUTURE_STATUS")).toBeInTheDocument();
  });

  it("keeps the full bucket key available even though it is abbreviated", () => {
    renderWithIntl(<BalancesTable rows={rows} />);

    const rowHeader = screen.getByTitle(rows[0]!.bucketKey);
    expect(rowHeader).toBeInTheDocument();
    expect(rowHeader.textContent).not.toBe(rows[0]!.bucketKey);
  });

  it("renders a zero balance as a quantity rather than as an absence", () => {
    renderWithIntl(<BalancesTable rows={[{ ...rows[0]!, minorUnits: 0 }]} />);

    const table = screen.getByRole("table");
    expect(within(table).getByText("0.000")).toBeInTheDocument();
  });

  it("renders an empty table without inventing a row", () => {
    renderWithIntl(<BalancesTable rows={[]} />);

    expect(screen.getAllByRole("row")).toHaveLength(1);
  });
});
