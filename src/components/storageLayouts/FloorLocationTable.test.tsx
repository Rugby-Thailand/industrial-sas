import { chooseOption } from "@tests/fixtures/select-control";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  LocationOnlyPlacementRow,
  StorageStackPlacementRow,
  StorageZoneRow,
} from "@/lib/convex/storageLayoutApi";
import { FloorLocationTable } from "./FloorLocationTable";

const intl = vi.hoisted(() => ({ locale: "en" }));
vi.mock("next-intl", () => ({ useLocale: () => intl.locale }));
const select = vi.fn();
const zones: readonly StorageZoneRow[] = Array.from(
  { length: 260 },
  (_, index) => ({
    zoneId: `zone-${index + 1}`,
    locationId: `location-${index + 1}`,
    code: `Z${index + 1}`,
    label: `Location ${260 - index}`,
    qrValue: `qr-${index + 1}`,
    mode: "SIMPLE",
    xMm: index * 1000,
    yMm: 0,
    widthMm: 2500,
    depthMm: 4000,
    maxStackHeightMm: 3000,
    positions: [],
    placements: [],
  }),
);
function placement(
  id: string,
  handlingUnitId: string,
  status: "STORED" | "RESERVED",
): StorageStackPlacementRow {
  return {
    placementId: id,
    handlingUnitId,
    status,
    lpn: handlingUnitId,
    levelIndex: 1,
    widthMm: 1000,
    depthMm: 1000,
    heightMm: 1000,
    orientation: "DEFAULT",
    placedAt: 1,
  };
}
function locationOnly(
  id: string,
  status: "STORED" | "RESERVED" | "RELEASED",
): LocationOnlyPlacementRow {
  return {
    mode: "LOCATION_ONLY",
    placementId: id,
    handlingUnitId: id,
    lpn: id,
    assignmentId: "assignment",
    sequence: 1,
    positionCode: "position",
    status,
  };
}
const rows = () =>
  within(screen.getByRole("table")).getAllByRole("row").slice(1);
const firstCode = () => within(rows()[0]!).getAllByRole("cell")[0]?.textContent;
beforeEach(() => {
  intl.locale = "en";
  select.mockReset();
});

describe("FloorLocationTable", () => {
  it("shares search, sorting and pagination between table and grid", () => {
    render(
      <FloorLocationTable
        zones={zones}
        onSelect={select}
        actions={<button type="button">Add location</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Add location" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(25);
    expect(
      screen.getByRole("button", {
        name: "Select location Z26 · Location 235",
      }),
    ).toBeVisible();
    chooseOption("Sort by", "Location name");
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    expect(
      screen.getByRole("columnheader", { name: "Location name" }),
    ).toHaveAttribute("aria-sort", "ascending");
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "qr-260" },
    });
    expect(rows()).toHaveLength(1);
    expect(firstCode()).toBe("Z260");
  });

  it("filters known inventory, clears excluded selection and restores rows", () => {
    const clear = vi.fn();
    const candidates = [
      zones[0]!,
      { ...zones[1]!, placements: [placement("p", "u", "STORED")] },
      { ...zones[2]!, unmeasuredPalletCount: 2 },
    ];
    render(
      <FloorLocationTable
        zones={candidates}
        selectedId="zone-2"
        onSelect={select}
        onClearSelection={clear}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filter locations" }));
    fireEvent.click(screen.getByRole("button", { name: "Empty" }));
    expect(rows()).toHaveLength(1);
    expect(firstCode()).toBe("Z1");
    expect(clear).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(rows()).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Unmeasured" }));
    expect(firstCode()).toBe("Z3");
    fireEvent.click(screen.getByRole("button", { name: "Stored" }));
    expect(rows()).toHaveLength(2);
  });

  it("forwards controlled search edits and preserves selected grid actions", async () => {
    const searchChange = vi.fn();
    render(
      <FloorLocationTable
        zones={[zones[204]!]}
        search="Z205"
        onSearchChange={searchChange}
        selectedId="zone-205"
        onSelect={select}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Z9" },
    });
    expect(searchChange).toHaveBeenCalledWith("Z9");
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    const selected = screen.getByRole("button", {
      name: "Select location Z205 · Location 56",
    });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    selected.focus();
    await userEvent.setup().keyboard("{Enter}");
    expect(select).toHaveBeenCalledWith("zone-205");
  });

  it("keeps parent-filtered multiword results and never submits search", async () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const change = vi.fn();
    render(
      <form onSubmit={submit}>
        <FloorLocationTable
          zones={[zones[0]!]}
          search="Z1 Location 260"
          onSearchChange={change}
          onSelect={select}
        />
      </form>,
    );
    expect(firstCode()).toBe("Z1");
    screen.getByRole("searchbox").focus();
    await userEvent.setup().keyboard("{Enter}");
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(change).toHaveBeenCalledWith("");
  });

  it("paginates hundreds of zones without changing their order or geometry", () => {
    const original = JSON.stringify(zones);
    render(<FloorLocationTable zones={zones} onSelect={select} />);
    expect(rows()).toHaveLength(25);
    expect(firstCode()).toBe("Z1");
    expect(screen.getByRole("status")).toHaveTextContent(
      "1–25 of 260 locations",
    );
    expect(
      screen.getByRole("button", { name: "Previous page" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(firstCode()).toBe("Z26");
    chooseOption("Rows per page", "100");
    expect(rows()).toHaveLength(100);
    expect(firstCode()).toBe("Z1");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(rows()).toHaveLength(60);
    expect(screen.getByRole("status")).toHaveTextContent(
      "201–260 of 260 locations",
    );
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(select).not.toHaveBeenCalled();
    expect(JSON.stringify(zones)).toBe(original);
  });

  it("does not submit a containing floor form when sorting or paging", async () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <FloorLocationTable zones={zones} onSelect={select} />
      </form>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    await user.click(screen.getByRole("button", { name: "Code" }));
    await user.click(within(rows()[0]!).getByRole("button"));
    expect(submit).not.toHaveBeenCalled();
  });

  it("sorts natural codes, names and unit totals with stable code/id ties", () => {
    const candidates = [
      { ...zones[0]!, zoneId: "b", code: "Z2", label: "Same", palletCount: 3 },
      { ...zones[0]!, zoneId: "a", code: "Z2", label: "Same", palletCount: 3 },
      {
        ...zones[0]!,
        zoneId: "c",
        code: "Z10",
        label: "Ahead",
        palletCount: 1,
      },
    ];
    render(<FloorLocationTable zones={candidates} onSelect={select} />);
    fireEvent.click(within(rows()[0]!).getByRole("button"));
    expect(select).toHaveBeenLastCalledWith("a");
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(firstCode()).toBe("Z10");
    expect(screen.getByRole("columnheader", { name: "Code" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    fireEvent.click(screen.getByRole("button", { name: "Location name" }));
    expect(firstCode()).toBe("Z10");
    fireEvent.click(screen.getByRole("button", { name: "Units" }));
    expect(firstCode()).toBe("Z10");
    fireEvent.click(screen.getByRole("button", { name: "Units" }));
    fireEvent.click(within(rows()[0]!).getByRole("button"));
    expect(select).toHaveBeenLastCalledWith("a");
  });

  it("reveals off-page map selection and retains it while paging, sorting and resizing", () => {
    const view = render(<FloorLocationTable zones={zones} onSelect={select} />);
    view.rerender(
      <FloorLocationTable
        zones={zones}
        selectedId="zone-205"
        onSelect={select}
      />,
    );
    const selected = screen.getByRole("button", {
      name: "Select location Z205 · Location 56",
    });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("201–225");
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(
      screen.queryByRole("button", {
        name: "Select location Z205 · Location 56",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(
      screen.getByRole("button", {
        name: "Select location Z205 · Location 56",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Location name" }));
    expect(
      screen.getByRole("button", {
        name: "Select location Z205 · Location 56",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    chooseOption("Rows per page", "50");
    expect(rows()).toHaveLength(50);
    expect(
      screen.getByRole("button", {
        name: "Select location Z205 · Location 56",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(select).not.toHaveBeenCalled();
  });

  it("clamps pages after filtering and keeps an absent selected id unchanged", () => {
    const view = render(
      <FloorLocationTable
        zones={zones}
        selectedId="zone-205"
        onSelect={select}
      />,
    );
    view.rerender(
      <FloorLocationTable
        zones={zones.slice(0, 3)}
        selectedId="zone-205"
        onSelect={select}
      />,
    );
    expect(rows()).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent("1–3 of 3");
    expect(select).not.toHaveBeenCalled();
    view.rerender(
      <FloorLocationTable zones={[]} selectedId="zone-205" onSelect={select} />,
    );
    expect(screen.getByText("No storage locations match")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("0–0 of 0");
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("counts distinct units across geometry, move reservations and location-only stock", () => {
    const zone: StorageZoneRow = {
      ...zones[0]!,
      placements: [
        placement("stored", "unit1", "STORED"),
        placement("hold", "unit1", "RESERVED"),
      ],
      locationOnlyPlacements: [
        locationOnly("unmeasured", "STORED"),
        locationOnly("released", "RELEASED"),
      ],
      unmeasuredPalletCount: 1,
      palletCount: 2,
    };
    render(<FloorLocationTable zones={[zone]} onSelect={select} />);
    expect(
      within(rows()[0]!)
        .getAllByRole("cell")
        .slice(2)
        .map((cell) => cell.textContent),
    ).toEqual(["2.5 × 4 × 3", "2", "2", "1", "1"]);
    expect(screen.queryByText(/known minimum/)).not.toBeInTheDocument();
  });

  it("does not report zero occupancy when unmeasured details are missing", () => {
    const zone: StorageZoneRow = {
      ...zones[0]!,
      placements: [placement("measured", "unit1", "STORED")],
      unmeasuredPalletCount: 3,
      palletCount: 4,
    };
    const view = render(
      <FloorLocationTable zones={[zone]} onSelect={select} />,
    );
    expect(
      within(rows()[0]!)
        .getAllByRole("cell")
        .slice(3)
        .map((cell) => cell.textContent),
    ).toEqual(["4", "≥ 1", "≥ 0", "3"]);
    expect(screen.getByText(/known minimum/)).toBeVisible();
    const { palletCount: _total, ...partial } = zone;
    view.rerender(<FloorLocationTable zones={[partial]} onSelect={select} />);
    expect(within(rows()[0]!).getAllByRole("cell")[3]).toHaveTextContent("≥ 3");
  });

  it("keeps the complete Thai label available and provides named keyboard controls", async () => {
    intl.locale = "th";
    const label =
      "พื้นที่จัดเก็บสินค้าที่มีชื่อยาวมากเพื่อใช้ตรวจสอบการแสดงข้อความโดยไม่ตัดทิ้ง";
    render(
      <FloorLocationTable
        zones={[{ ...zones[0]!, label }]}
        onSelect={select}
      />,
    );
    expect(screen.getByText(label)).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "รายการต่อหน้า" }),
    ).toBeVisible();
    const button = screen.getByRole("button", {
      name: `เลือกจุดจัดเก็บ Z1 · ${label}`,
    });
    button.focus();
    await userEvent.setup().keyboard("{Enter}");
    expect(select).toHaveBeenCalledExactlyOnceWith("zone-1");
    expect(
      screen.getByRole("region", { name: "รายการจุดจัดเก็บ" }),
    ).toHaveAttribute("tabindex", "0");
  });
});
