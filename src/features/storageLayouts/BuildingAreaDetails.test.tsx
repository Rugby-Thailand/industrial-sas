import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import {
  BuildingAreaDetails,
  BuildingUsageContent,
} from "./BuildingAreaDetails";
import type {
  StorageBuildingDetail,
  StorageBuildingRow,
} from "@/lib/convex/storageLayoutApi";
import { chooseOption } from "@tests/fixtures/select-control";

const query = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: unknown) => query(args),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props} />
  ),
}));
const building: StorageBuildingRow = {
  buildingId: "b1",
  warehouseId: "w1",
  code: "B1",
  name: "Building 1",
  widthMm: 10000,
  depthMm: 8000,
  defaultFloorHeightMm: 4000,
  floorCount: 1,
  totalHeightMm: 4000,
  grossAreaSqMm: 80000000,
  usableAreaSqMm: 64000000,
  reservedAreaSqMm: 16000000,
  status: "ACTIVE",
  version: 1,
};
const detail: Extract<StorageBuildingDetail, { found: true }> = {
  found: true,
  building,
  floors: [
    {
      floorId: "f1",
      floorNumber: 1,
      grossAreaSqMm: 80000000,
      usableAreaSqMm: 64000000,
      reservedAreaSqMm: 16000000,
      version: 1,
      reservedBlocks: [],
      storageZones: [
        {
          zoneId: "z1",
          locationId: "l1",
          code: "ZONE-A",
          label: "Area A",
          mode: "SIMPLE",
          qrValue: "z",
          xMm: 0,
          yMm: 0,
          widthMm: 8000,
          depthMm: 8000,
          maxStackHeightMm: 4000,
          positions: [],
          placements: [
            {
              placementId: "p1",
              handlingUnitId: "pallet1",
              lpn: "P-001",
              productName: "Cartons",
              productSku: "BOX",
              quantity: 10,
              unit: "PCS",
              levelIndex: 1,
              xMm: 0,
              yMm: 0,
              zMm: 0,
              widthMm: 8000,
              depthMm: 8000,
              heightMm: 1000,
              status: "STORED",
              orientation: "DEFAULT",
              placedAt: 0,
              positionCode: "POS-1",
            },
            {
              placementId: "p2",
              handlingUnitId: "pallet2",
              lpn: "P-002",
              productName: "Cartons",
              levelIndex: 2,
              xMm: 0,
              yMm: 0,
              zMm: 1000,
              widthMm: 1000,
              depthMm: 1000,
              heightMm: 1000,
              status: "RESERVED",
              orientation: "DEFAULT",
              placedAt: 0,
              moveRole: "TARGET",
            },
          ],
        },
      ],
    },
  ],
};

function wrap(children: React.ReactNode, locale = "en") {
  return (
    <NextIntlClientProvider locale={locale} messages={{}}>
      {children}
    </NextIntlClientProvider>
  );
}
describe("building space drilldown", () => {
  it("loads only after opening, supports Escape and returns focus", async () => {
    query.mockImplementation((args) =>
      args === "skip" ? undefined : { ok: true, value: detail },
    );
    const user = userEvent.setup();
    render(wrap(<BuildingAreaDetails building={building} />));
    expect(query).toHaveBeenLastCalledWith("skip");
    const trigger = screen.getByRole("button", {
      name: "View space details · Building 1",
    });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(query).toHaveBeenLastCalledWith({
      warehouseId: "w1",
      buildingId: "b1",
    });
    expect(screen.getByRole("link", { name: "P-001" })).toHaveAttribute(
      "href",
      "/finished-goods/pallets/pallet1",
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
  it.each(["th", "en"])(
    "shows full-space pie, locations and status filtering in %s",
    (locale) => {
      render(wrap(<BuildingUsageContent detail={detail} />, locale));
      expect(screen.getByRole("img")).toHaveAccessibleName(
        locale === "th"
          ? "ว่าง 0 ตร.ม. · จัดเก็บแล้ว 64 ตร.ม. · จองแล้ว 0 ตร.ม. · ใช้งานไม่ได้ 16 ตร.ม."
          : "Free 0 m² · Stored 64 m² · Reserved 0 m² · Unavailable 16 m²",
      );
      const table = screen.getByRole("table");
      expect(within(table).getAllByRole("row")).toHaveLength(3);
      expect(within(table).getByText("BOX · 10 PCS")).toBeVisible();
      chooseOption(
        locale === "th" ? "สถานะ" : "Status",
        locale === "th" ? "จองแล้ว" : "Reserved",
      );
      expect(within(table).queryByText("P-001")).not.toBeInTheDocument();
      expect(within(table).getByText("P-002")).toBeVisible();
    },
  );
  it("handles buildings without inventory", () => {
    render(wrap(<BuildingUsageContent detail={{ ...detail, floors: [] }} />));
    expect(screen.getByText("No inventory in this status")).toBeVisible();
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Free 64 m² · Stored 0 m² · Reserved 0 m² · Unavailable 16 m²",
    );
  });
});
