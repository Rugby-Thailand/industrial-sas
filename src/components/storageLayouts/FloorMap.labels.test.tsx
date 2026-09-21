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
  it("remembers hidden labels across floors while geometry stays selectable in both views", () => {
    const first = renderMap();
    expect(
      first.container.querySelector("[data-floor-callout]"),
    ).not.toBeNull();
    const toggle = screen.getByRole("button", { name: "Show location labels" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(first.container.querySelector("[data-floor-callout]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "2D plan" }));
    expect(first.container.querySelector("[data-floor-callout]")).toBeNull();
    const map = screen.getByRole("group", { name: "Interactive floor map" });
    const zone = within(map).getByRole("button", {
      name: /Select location FG-A/,
    });
    fireEvent.keyDown(zone, { key: "Enter" });
    expect(zone).toHaveAttribute("aria-pressed", "true");
    first.unmount();

    const second = renderMap(2);
    expect(
      screen.getByRole("button", { name: "Show location labels" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(second.container.querySelector("[data-floor-callout]")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Show location labels" }),
    );
    expect(
      second.container.querySelector("[data-floor-callout]"),
    ).not.toBeNull();
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
