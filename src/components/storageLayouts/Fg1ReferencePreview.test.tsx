import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { StorageZoneRow } from "@/lib/convex/storageLayoutApi";
import { fg1SourceAreas } from "./Fg1SourcePlan";
import {
  Fg1ReferencePreview,
  matchesFg1Reference,
} from "./Fg1ReferencePreview";

const liveZones: StorageZoneRow[] = [
  ...Array.from({ length: 5 }, (_, i) => `L${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 10 }, (_, i) => `R${String(i + 1).padStart(2, "0")}`),
].map((id) => ({
  zoneId: `zone-${id}`,
  locationId: `location-${id}`,
  code: `FG1-${id}`,
  label: `FG1-${id}`,
  qrValue: `qr-${id}`,
  mode: "SIMPLE",
  xMm: 0,
  yMm: 0,
  widthMm: 3000,
  depthMm: 4000,
  maxStackHeightMm: 1500,
  positions: [],
  placements: [],
}));

describe("FG1 locked reference preview", () => {
  it("enables only the approved building/floor with all fifteen unique locations", () => {
    const id = "n57effrz60rbq7fqx438q6r6fx8f0hed";
    expect(matchesFg1Reference(id, 1, liveZones)).toBe(true);
    expect(
      matchesFg1Reference("n57c2n3sjmdpkjncn9jf0a19gh8ey9h5", 1, liveZones),
    ).toBe(false);
    expect(matchesFg1Reference(id, 2, liveZones)).toBe(false);
    expect(matchesFg1Reference(id, 1, liveZones.slice(1))).toBe(false);
    expect(
      matchesFg1Reference(id, 1, [...liveZones.slice(1), liveZones[1]!]),
    ).toBe(false);
  });
  it("reads live dimensions and sends real IDs to the inspector in both views", () => {
    const select = vi.fn();
    const snapshot = JSON.stringify(liveZones);
    const result = render(
      <Fg1ReferencePreview zones={liveZones} onSelectionChange={select} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "FG1-L01 3.00 × 4.00 เมตร" }),
    );
    expect(select).toHaveBeenLastCalledWith("zone-L01");
    result.rerender(
      <Fg1ReferencePreview
        zones={liveZones}
        onSelectionChange={select}
        selectedZoneId="zone-L01"
      />,
    );
    expect(
      screen.getByRole("button", { name: "FG1-L01 3.00 × 4.00 เมตร" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "แสดง 3D" }));
    fireEvent.keyDown(
      screen.getByRole("button", { name: "FG1-R04 3.00 × 4.00 เมตร" }),
      { key: "Enter" },
    );
    expect(select).toHaveBeenLastCalledWith("zone-R04");
    expect(JSON.stringify(liveZones)).toBe(snapshot);
  });
  it("does not fabricate missing live locations or hide the unpersisted obstruction warning", () => {
    const result = render(<Fg1ReferencePreview zones={liveZones.slice(1)} />);
    expect(
      result.container.querySelectorAll("[data-reference-zone]"),
    ).toHaveLength(14);
    expect(
      screen.queryByRole("button", { name: /FG1-L01/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("ยังไม่หักพื้นที่จุดนี้ในฐานข้อมูล"),
    ).toBeInTheDocument();
  });
  it("reports the small exclusion as saved only when it is contained in L02", () => {
    const block = {
      xMm: 100,
      yMm: 100,
      widthMm: 1_200,
      depthMm: 650,
    };
    const result = render(
      <Fg1ReferencePreview zones={liveZones} reservedBlocks={[block]} />,
    );
    expect(
      screen.getByText("จุด 1.20 × 0.65 ม. กันพื้นที่ในฐานข้อมูลแล้ว"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("ยังไม่หักพื้นที่จุดนี้ในฐานข้อมูล"),
    ).not.toBeInTheDocument();
    result.rerender(
      <Fg1ReferencePreview
        zones={liveZones}
        reservedBlocks={[{ ...block, xMm: 2_900 }]}
      />,
    );
    expect(
      screen.getByText("ยังไม่หักพื้นที่จุดนี้ในฐานข้อมูล"),
    ).toBeInTheDocument();
  });
  it("preserves all fifteen L/R areas, both exclusions and inline names in 2D", () => {
    const view = render(<Fg1ReferencePreview />);
    expect(
      [...view.container.querySelectorAll("[data-reference-zone]")].map((e) =>
        e.getAttribute("data-reference-zone"),
      ),
    ).toEqual([
      "L01",
      "L02",
      "L03",
      "L04",
      "L05",
      "R01",
      "R02",
      "R03",
      "R04",
      "R05",
      "R06",
      "R07",
      "R08",
      "R09",
      "R10",
    ]);
    expect(
      view.container.querySelectorAll("[data-reference-obstruction]"),
    ).toHaveLength(2);
    expect(screen.getByText("1.20 × 0.65 m")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "FG1-L01 2.87 × 4.82 เมตร" }),
    );
    expect(screen.getByText("เลือก: FG1-L01")).toBeInTheDocument();
    expect(screen.getAllByText(/ไม่ใช่มาตราส่วนจริง/)).toHaveLength(1);
  });
  it("uses approved source placement without either invented 4.48 m void or trial building dimensions", () => {
    const { container } = render(<Fg1ReferencePreview />);
    expect(
      container.querySelector('[data-fg1-source-revision="2026-09-27"]'),
    ).not.toBeNull();
    const l05 = fg1SourceAreas.find(([id]) => id === "L05")!;
    const r10 = fg1SourceAreas.find(([id]) => id === "R10")!;
    expect(l05[2] + l05[4]).toBe(r10[2] + r10[4]);
    expect(fg1SourceAreas.find(([id]) => id === "R01")![2]).toBe(0);
    expect(
      container.querySelectorAll('[data-source-aisle="0.30"]'),
    ).toHaveLength(11);
    expect(container.textContent).not.toMatch(/4\.48|31\.33|12\.26|1\.55/);
    expect(screen.getByText("พื้นที่รับสินค้า")).toBeInTheDocument();
  });
  it("switches to solid 3D areas without callout labels or changing the data", () => {
    const view = render(<Fg1ReferencePreview />);
    fireEvent.click(screen.getByRole("button", { name: "แสดง 3D" }));
    expect(
      view.container.querySelectorAll("[data-reference-zone]"),
    ).toHaveLength(15);
    expect(screen.getByText("ความสูงกล่อง 3D: ค่าจำลอง")).toBeInTheDocument();
    expect(view.container.querySelector("[data-floor-callout]")).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "แสดง 2D" }), {
      key: "Enter",
    });
    expect(
      view.container.querySelectorAll("[data-reference-obstruction]"),
    ).toHaveLength(2);
  });
});
