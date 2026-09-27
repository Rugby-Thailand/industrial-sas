import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Fg1MeasuredPlan } from "./Fg1MeasuredPlan";
import { fg1ApprovedPlan } from "../../../convex/model/storageLayout/fg1ApprovedPlan";
vi.mock("./FloorMap", () => ({
  FloorMap: ({ initialView }: { initialView?: string }) => (
    <div>{initialView === "3d" ? "live 3D" : "live 2D"}</div>
  ),
}));
describe("FG1 database plan", () => {
  it("shows only names, uses live coordinates, preserves selection and supports zoom/3D", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const p = fg1ApprovedPlan(),
      select = vi.fn();
    const zones = p.cells.map((c) => ({
      ...c,
      zoneId: c.code,
      locationId: c.code,
      label: c.code,
      qrValue: c.code,
      mode: "SIMPLE" as const,
      maxStackHeightMm: 1500,
      positions: [],
      placements: [],
    }));
    const props = {
      ...p,
      heightMm: 3300,
      baseWidthMm: p.widthMm,
      baseDepthMm: p.depthMm,
      offsetXMm: 0,
      offsetYMm: 0,
      baseLabel: "FG1",
      floorNumber: 1,
      zones,
      onSelectionChange: select,
    };
    const v = render(<Fg1MeasuredPlan {...props} />);
    expect(v.container.querySelectorAll("[data-fg1-zone]")).toHaveLength(15);
    expect(v.container.querySelectorAll("[data-fg1-name]")).toHaveLength(15);
    expect(v.container.querySelector("svg")!.textContent).not.toContain("×");
    expect(v.container.querySelectorAll("[data-fg1-aisle]")).toHaveLength(16);
    fireEvent.click(screen.getByRole("button", { name: "FG1-R10" }));
    expect(select).toHaveBeenCalledWith("FG1-R10");
    const before = v.container
      .querySelector('[data-fg1-zone="FG1-R04"] rect')!
      .getAttribute("x");
    fireEvent.click(screen.getByRole("button", { name: "ขยายผัง FG1" }));
    expect(
      v.container
        .querySelector('[data-fg1-zone="FG1-R04"] rect')!
        .getAttribute("x"),
    ).not.toBe(before);
    v.rerender(
      <Fg1MeasuredPlan
        {...props}
        zones={zones.map((z) =>
          z.code === "FG1-R04" ? { ...z, xMm: z.xMm + 100 } : z,
        )}
      />,
    );
    expect(
      v.container
        .querySelector('[data-fg1-zone="FG1-R04"] rect')!
        .getAttribute("x"),
    ).not.toBe(before);
    fireEvent.click(screen.getByRole("button", { name: /^3D$/ }));
    expect(screen.getByText("live 3D")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
