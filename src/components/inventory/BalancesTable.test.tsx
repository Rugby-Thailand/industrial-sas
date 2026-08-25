import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { encodeBucketKey } from "../../../convex/model/inventory/stockIdentity";
import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import { BalancesTable } from "./BalancesTable";

import type { BalanceRow } from "@/lib/convex/ledgerApi";

const keyFor = (bucket: {
  readonly itemId: string;
  readonly locationId: string;
  readonly lotId?: string;
  readonly stockStatus: "AVAILABLE" | "QC_HOLD";
}): string => {
  const encoded = encodeBucketKey({
    orgId: "org_fixture",
    warehouseId: "wh_bangpoo",
    itemId: bucket.itemId,
    location: { kind: "PHYSICAL", locationId: bucket.locationId },
    ...(bucket.lotId === undefined ? {} : { lotId: bucket.lotId }),
    stockStatus: bucket.stockStatus,
  });
  if (!encoded.ok) throw new Error(JSON.stringify(encoded.error));
  return encoded.value;
};

const rows: readonly BalanceRow[] = [
  {
    bucketKey: keyFor({
      itemId: "item_steel_coil",
      locationId: "loc_A01-02-1",
      lotId: "lot_2607B",
      stockStatus: "AVAILABLE",
    }),
    stockStatus: "AVAILABLE",
    uom: "KG",
    minorUnits: 18_450_500,
  },
  {
    bucketKey: keyFor({
      itemId: "item_bolt_m8",
      locationId: "loc_B04-11-3",
      stockStatus: "QC_HOLD",
    }),
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
    renderWithIntl(
      <BalancesTable
        rows={[{ ...rows[0]!, stockStatus: "SOME_FUTURE_STATUS" }]}
      />,
    );

    expect(screen.getByText("SOME_FUTURE_STATUS")).toBeInTheDocument();
  });

  it("names each dimension of the bucket, whole and labelled", () => {
    renderWithIntl(<BalancesTable rows={rows} />);

    expect(screen.getByText("item_steel_coil")).toBeInTheDocument();
    expect(screen.getByText("loc_A01-02-1")).toBeInTheDocument();
    expect(screen.getByText("lot_2607B")).toBeInTheDocument();
    expect(screen.getAllByText("สินค้า")).toHaveLength(rows.length);
  });

  it("omits a dimension the bucket does not have", () => {
    renderWithIntl(<BalancesTable rows={rows} />);

    expect(screen.getAllByText("ล็อต")).toHaveLength(1);
    expect(screen.queryByText("หมายเลขซีเรียล")).not.toBeInTheDocument();
  });

  it("tells two buckets apart when only their lot differs", () => {
    const first = keyFor({
      itemId: "item_steel_coil",
      locationId: "loc_A01-02-1",
      lotId: "lot_2607B",
      stockStatus: "AVAILABLE",
    });
    const second = keyFor({
      itemId: "item_steel_coil",
      locationId: "loc_A01-02-1",
      lotId: "lot_2608C",
      stockStatus: "AVAILABLE",
    });

    renderWithIntl(
      <BalancesTable
        rows={[
          { ...rows[0]!, bucketKey: first },
          { ...rows[0]!, bucketKey: second },
        ]}
      />,
    );

    const [, firstRow, secondRow] = screen.getAllByRole("row");
    expect(firstRow?.textContent).not.toBe(secondRow?.textContent);
    expect(screen.getByText("lot_2607B")).toBeInTheDocument();
    expect(screen.getByText("lot_2608C")).toBeInTheDocument();
  });

  it("shows a key it cannot decode as itself, rather than as a guess", () => {
    const malformed = "IB1|3:org|11:wh_bangpoo";
    renderWithIntl(
      <BalancesTable rows={[{ ...rows[0]!, bucketKey: malformed }]} />,
    );

    expect(screen.getByText(malformed)).toBeInTheDocument();
    expect(screen.getByText("รหัสถังสต็อก")).toBeInTheDocument();
  });

  it("counts one row as one row in English", () => {
    renderWithIntl(<BalancesTable rows={[rows[0]!]} />, { locale: "en" });

    expect(screen.getByText("1 balance row")).toBeInTheDocument();
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

  it("puts the scroller in a named region a keyboard can reach", () => {
    renderWithIntl(<BalancesTable rows={rows} />);

    const caption = "ยอดคงเหลือ 2 รายการ";
    const region = screen.getByRole("region", { name: caption });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("overflow-x-auto");
    expect(
      within(region).getByRole("table", { name: caption }),
    ).toBeInTheDocument();
  });

  it("tells a narrow screen that the columns continue past the edge", () => {
    renderWithIntl(<BalancesTable rows={rows} />);

    const hint = screen.getByText(
      "เลื่อนตารางไปทางซ้าย-ขวาเพื่อดูคอลัมน์ที่เหลือ",
    );
    expect(hint).toHaveClass("@2xl/table:hidden");
  });
});
