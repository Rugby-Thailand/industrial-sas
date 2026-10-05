import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { FloorMap } from "./FloorMap";
import { floorMapDemo } from "./storageFloorDemoData";
vi.mock("@/hooks/useCanManage", () => ({ useCanManage: () => false }));
vi.mock("@/i18n/navigation", () => ({ Link: "a" }));
beforeEach(() => {
  window.history.replaceState(
    { custom: "retained" },
    "",
    "/planner?floor=2&view=storage#floor",
  );
  localStorage.clear();
});
const show = () =>
  renderWithIntl(<FloorMap {...floorMapDemo(false, false)} />, {
    locale: "en",
    workspace: false,
  });
describe("canvas first workspace", () => {
  it("defaults to map, preserves query context and uses keyboard view controls", () => {
    show();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    const map = screen.getByRole("button", { name: "Map view" });
    fireEvent.keyDown(map, { key: "ArrowRight" });
    expect(screen.getByRole("table")).toBeVisible();
    expect(window.location.search).toBe("?floor=2&view=storage&panel=list");
    expect(window.location.hash).toBe("#floor");
    expect(window.history.state.custom).toBe("retained");
    fireEvent.click(screen.getByRole("button", { name: "Split view" }));
    expect(
      screen.getByRole("group", { name: "Interactive floor map" }),
    ).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    fireEvent.click(map);
    expect(new URLSearchParams(window.location.search).has("panel")).toBe(
      false,
    );
  });
  it("retains camera and selection between panels, and hides details without deselecting", () => {
    const view = show();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    fireEvent.click(
      within(screen.getByRole("table")).getAllByRole("button", {
        name: /Select location/,
      })[0]!,
    );
    const selected = view.container
      .querySelector('tr[data-state="selected"] button')
      ?.getAttribute("aria-label");
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    expect(
      view.container.querySelector('tr[data-state="selected"]'),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Map view" }));
    expect(
      view.container.querySelector('[data-map-zone-id][aria-pressed="true"]'),
    ).not.toBeNull();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByText(/125%/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    expect(
      view.container.querySelector('tr[data-state="selected"] button'),
    ).toHaveAttribute("aria-label", selected);
  });
  it("shares status filters and search across map and table without opening an inspector", () => {
    const view = show();
    fireEvent.click(screen.getByRole("button", { name: "Filter locations" }));
    fireEvent.click(screen.getByRole("button", { name: "Empty" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Empty" }), {
      key: "Escape",
    });
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      2,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "no-such-location" },
    });
    expect(screen.getByText("No storage locations match")).toBeVisible();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Map view" }));
    expect(view.container.querySelector("[data-map-zone-id]")).toHaveAttribute(
      "opacity",
      "0.3",
    );
  });
});
