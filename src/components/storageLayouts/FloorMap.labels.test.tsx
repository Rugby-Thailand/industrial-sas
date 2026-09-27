import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { FloorMap } from "./FloorMap";
import { floorMapDemo } from "./storageFloorDemoData";

vi.mock("@/hooks/useCanManage", () => ({
  useCanManage: () => false,
}));
vi.mock("@/i18n/navigation", () => ({ Link: "a" }));

beforeEach(() => localStorage.clear());

function renderMap(floorNumber = 1) {
  return renderWithIntl(
    <FloorMap {...floorMapDemo(false, false)} floorNumber={floorNumber} />,
    { locale: "en", workspace: false },
  );
}

describe("floor location labels", () => {
  it("keeps dense area names out of the overview and groups the legend", () => {
    const data = floorMapDemo(false, false);
    const blocks = Array.from({ length: 36 }, (_, index) => ({
      xMm: index * 500,
      yMm: 0,
      widthMm: 300,
      depthMm: 800,
      label: `Door ${index + 1}`,
      color: "#8ebbb2",
    }));
    const view = renderWithIntl(<FloorMap {...data} blocks={blocks} />, {
      locale: "en",
      workspace: false,
    });
    const map = screen.getByRole("group", { name: "Interactive floor map" });
    expect(screen.getByRole("button", { name: "2D plan" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(map.querySelectorAll("[data-floor-callout]")).toHaveLength(0);
    expect(map.querySelectorAll("[data-unavailable-area] text")).toHaveLength(
      0,
    );
    const areas = screen.getByText("Map areas (36)").closest("details");
    expect(areas).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Map areas (36)"));
    expect(screen.getByText("Door · 36")).toBeVisible();
    fireEvent.click(screen.getByText("All area names (36)"));
    expect(view.container).toHaveTextContent("Door 36");
  });

  it.each(["PD", "F1", "F2", "SB"])(
    "treats %s cells as selectable floor locations without individual overview callouts",
    (prefix) => {
      const data = floorMapDemo(false, false);
      const zones = Array.from({ length: 15 }, (_, index) => {
        const row = Math.floor(index / 5);
        const column = index % 5;
        const code = `${prefix}-L1-${15 - index}`;
        return {
          ...data.zones[0]!,
          zoneId: code,
          locationId: code,
          code,
          label: code,
          mode: "SIMPLE" as const,
          xMm: column * 1884,
          yMm: row * 1483,
          widthMm: 1884,
          depthMm: row === 2 ? 1184 : 1183,
          positions: [],
          placements: [],
        };
      });
      const view = renderWithIntl(
        <FloorMap
          {...data}
          widthMm={9420}
          depthMm={4150}
          zones={zones}
          blocks={[
            {
              xMm: 0,
              yMm: 1183,
              widthMm: 9420,
              depthMm: 300,
              label: "Aisle 0.30 m",
              color: "#FFB68E",
            },
            {
              xMm: 0,
              yMm: 2666,
              widthMm: 9420,
              depthMm: 300,
              label: "Aisle 0.30 m",
              color: "#FFB68E",
            },
          ]}
        />,
        { locale: "en", workspace: false },
      );
      const map = screen.getByRole("group", { name: "Interactive floor map" });
      expect(screen.getByRole("button", { name: "2D plan" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(map).toHaveAttribute("viewBox", "0 80 920 500");
      expect(map.querySelectorAll("[data-pd-cell-code]")).toHaveLength(15);
      expect(
        map.querySelectorAll('[data-map-zone-id][tabindex="0"]'),
      ).toHaveLength(1);
      expect(map.querySelectorAll("[data-floor-callout]")).toHaveLength(0);
      expect(map.querySelectorAll("[data-unavailable-area] text")).toHaveLength(
        0,
      );
      expect(
        [...map.querySelectorAll("text")].some(
          (label) => label.textContent === `${prefix}-L1`,
        ),
      ).toBe(true);
      expect(view.container).toHaveTextContent(
        "15 storage positions in 1 group",
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Show detailed labels" }),
      );
      expect(
        [...map.querySelectorAll("text")].some(
          (label) => label.textContent === `${prefix}-L1`,
        ),
      ).toBe(true);
      fireEvent.keyDown(
        within(map).getByRole("button", {
          name: `Select location ${prefix}-L1-15`,
        }),
        { key: "ArrowRight" },
      );
      expect(
        within(map).getByRole("button", {
          name: `Select location ${prefix}-L1-14`,
        }),
      ).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(
        within(map).getByRole("button", {
          name: `Select location ${prefix}-L1-15`,
        }),
      );
      expect(
        [...map.querySelectorAll("text")].some(
          (label) => label.textContent === "15",
        ),
      ).toBe(true);
      const selectedCell = map.querySelector(
        `g[aria-label="Select location ${prefix}-L1-15"] [data-pd-cell-code]`,
      );
      expect(selectedCell).not.toBeNull();
      expect(
        view.container.querySelectorAll("[data-detail-position-code]"),
      ).toHaveLength(15);
      expect(
        view.container.querySelectorAll('[data-detail-aisle-width-mm="300"]'),
      ).toHaveLength(2);
      fireEvent.click(
        screen.getByRole("button", { name: "Show detailed labels" }),
      );
    },
  );

  it("keeps compact group markers visible on narrow F1 groups", () => {
    const data = floorMapDemo(false, false);
    const widths = [2800, 1470, 2800];
    const groups = ["F1-L11", "F1-L26", "F1-L27"];
    const zones = groups.map((group, index) => {
      const code = `${group}-1`;
      return {
        ...data.zones[0]!,
        zoneId: code,
        locationId: code,
        code,
        label: code,
        xMm: widths.slice(0, index).reduce((total, width) => total + width, 0),
        yMm: 4000,
        widthMm: widths[index]!,
        depthMm: 12000,
        placements: [],
      };
    });
    renderWithIntl(
      <FloorMap
        {...data}
        widthMm={60000}
        depthMm={28000}
        zones={zones}
        blocks={[]}
      />,
      { locale: "en", workspace: false },
    );
    const map = screen.getByRole("group", { name: "Interactive floor map" });
    expect(map.querySelector('[data-group-code="F1-L11"]')).toHaveTextContent(
      "L11",
    );
    expect(map.querySelector('[data-group-code="F1-L26"]')).toHaveTextContent(
      "26",
    );
    const groupMarker = map.querySelector('[data-group-code="F1-L26"]');
    const cellTop = Number(
      map
        .querySelector('[data-pd-cell-code="F1-L26-1"]')
        ?.getAttribute("points")
        ?.split(" ")[0]
        ?.split(",")[1],
    );
    expect(Number(groupMarker?.getAttribute("y"))).toBeGreaterThan(cellTop);
    fireEvent.click(
      screen.getByRole("button", { name: "Show detailed labels" }),
    );
    expect(map.querySelector('[data-group-code="F1-L26"]')).toHaveTextContent(
      "26",
    );
    fireEvent.click(
      within(map).getByRole("button", { name: "Select location F1-L26-1" }),
    );
    expect(map.querySelector('[data-group-code="F1-L26"]')).toHaveTextContent(
      "F1-L26",
    );
  });

  it("reserves the first row for a group marker until its number clears the chip", () => {
    const data = floorMapDemo(false, false);
    const zone = {
      ...data.zones[0]!,
      zoneId: "F1-L26-1",
      locationId: "F1-L26-1",
      code: "F1-L26-1",
      label: "F1-L26-1",
      xMm: 2000,
      yMm: 5000,
      widthMm: 1470,
      depthMm: 1350,
      placements: [],
    };
    renderWithIntl(
      <FloorMap
        {...data}
        widthMm={60000}
        depthMm={28000}
        zones={[zone]}
        blocks={[]}
      />,
      { locale: "en", workspace: false },
    );
    const map = screen.getByRole("group", { name: "Interactive floor map" });
    fireEvent.click(
      screen.getByRole("button", { name: "Show detailed labels" }),
    );
    for (let click = 0; click < 4; click += 1)
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(
      map.querySelector('[data-pd-cell-code="F1-L26-1"] + text'),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(
      map.querySelector('[data-pd-cell-code="F1-L26-1"] + text'),
    ).toHaveTextContent("1");
  });

  it("shows every floor position and the two 300 mm aisles inside PD-L1", () => {
    const data = floorMapDemo(false, false);
    const zone = {
      ...data.zones[0]!,
      zoneId: "PD-L1",
      code: "PD-L1",
      label: "PD-L1",
      mode: "FLOOR_POSITIONS" as const,
      xMm: 0,
      yMm: 0,
      widthMm: 7000,
      depthMm: 4150,
      placements: [],
      positions: Array.from({ length: 15 }, (_, index) => {
        const row = Math.floor(index / 5);
        const column = index % 5;
        const number = 15 - row * 5 - column;
        return {
          locationId: `PD-L1-${number}`,
          code: `PD-L1-${number}`,
          label: `PD-L1-${number}`,
          qrValue: `PD-L1-${number}`,
          kind: "FLOOR" as const,
          isDefault: false,
          xMm: column * 1400,
          yMm: row * 1283,
          widthMm: 1400,
          depthMm: 983,
          breadcrumb: `PD-L1 / PD-L1-${number}`,
          placements: [],
        };
      }),
    };
    const view = renderWithIntl(
      <FloorMap
        {...data}
        zones={[zone]}
        selectedZoneId={zone.zoneId}
        onSelectionChange={() => undefined}
      />,
      { locale: "en", workspace: false },
    );
    const map = screen.getByRole("group", { name: "Interactive floor map" });
    expect(map.querySelectorAll("[data-position-code]")).toHaveLength(15);
    expect(map.querySelectorAll('[data-aisle-width-mm="300"]')).toHaveLength(2);
    expect(view.container).toHaveTextContent("15 storage positions");
  });

  it("starts with detailed labels hidden and remembers an enabled preference across floors", () => {
    const first = renderMap();
    expect(first.container.querySelector("[data-floor-callout]")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Show detailed labels" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(
      first.container.querySelector("[data-floor-callout]"),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "2D plan" }));
    expect(
      first.container.querySelector("[data-floor-callout]"),
    ).not.toBeNull();
    const map = screen.getByRole("group", { name: "Interactive floor map" });
    const zone = within(map).getByRole("button", {
      name: /Select location FG-A/,
    });
    fireEvent.keyDown(zone, { key: "Enter" });
    expect(zone).toHaveAttribute("aria-pressed", "true");
    first.unmount();

    const second = renderMap(2);
    expect(
      screen.getByRole("button", { name: "Show detailed labels" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      second.container.querySelector("[data-floor-callout]"),
    ).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Show detailed labels" }),
    );
    expect(second.container.querySelector("[data-floor-callout]")).toBeNull();
  });

  it("counts unmeasured inventory without calling its location empty", () => {
    const data = floorMapDemo(false, false);
    const zone = {
      ...data.zones[3]!,
      unmeasuredPalletCount: 2,
      palletCount: 2,
      measuredAreaPartial: true,
    };
    const view = renderWithIntl(
      <FloorMap
        {...data}
        zones={[zone]}
        selectedZoneId={zone.zoneId}
        onSelectionChange={() => undefined}
      />,
      { locale: "en", workspace: false },
    );
    const inspector = screen.getByRole("complementary", {
      name: "Selected location",
    });
    expect(within(inspector).getByText("2 units")).toBeInTheDocument();
    expect(
      within(inspector).queryByText("No stored or reserved units yet"),
    ).not.toBeInTheDocument();
    expect(
      within(inspector).getByText(/Total occupied space is unknown/),
    ).toBeInTheDocument();
    expect(view.container.querySelector("[data-floor-callout]")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Show detailed labels" }),
    );
    expect(
      view.container.querySelector("[data-floor-callout]")?.parentElement,
    ).toHaveTextContent("2 units");
  });

  it("searches from the location toolbar without opening details while typing", () => {
    const change = vi.fn();
    renderWithIntl(
      <FloorMap {...floorMapDemo(false, false)} onSelectionChange={change} />,
      { locale: "en", workspace: false },
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "FG-A" },
    });
    expect(change.mock.calls.every(([id]) => id === undefined)).toBe(true);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    fireEvent.click(
      within(table).getByRole("button", { name: /Select location/ }),
    );
    expect(change).toHaveBeenLastCalledWith("DEMO-Z01");
  });

  it("notifies controlled selection for geometry and Escape", () => {
    const change = vi.fn();
    renderWithIntl(
      <FloorMap
        {...floorMapDemo(false, false)}
        selectedZoneId="DEMO-Z01"
        onSelectionChange={change}
      />,
      { locale: "en", workspace: false },
    );
    const map = screen.getByRole("group", { name: "Interactive floor map" });
    const zone = within(map).getByRole("button", {
      name: /Select location FG-A/,
    });
    expect(zone).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(
      within(map).getByRole("button", { name: /Select location FG-B/ }),
      { key: "Enter" },
    );
    expect(change).toHaveBeenLastCalledWith("DEMO-Z02");
    fireEvent.keyDown(map, { key: "Escape" });
    expect(change).toHaveBeenLastCalledWith(undefined);
  });
});
