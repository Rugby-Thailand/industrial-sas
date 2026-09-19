import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PalletScene } from "./PalletScene";

const dimensions = { widthMm: 1_200, depthMm: 1_000, heightMm: 1_400 };
const area = { widthMm: 3_000, depthMm: 3_000, heightMm: 3_000 };
const placement = { xMm: 0, yMm: 0, rotation: 0 } as const;

describe("PalletScene", () => {
  it("moves onto and off a pallet top without clamping to the old support or moving the camera", () => {
    const base = { ...area, xMm: 0, yMm: 0, zMm: 0 };
    const top = {
      ...dimensions,
      xMm: 500,
      yMm: 500,
      zMm: 1400,
      heightMm: 1600,
      supportPalletId: "lower",
    };
    const onPlacementChange = vi.fn();
    const props = {
      dimensions,
      area,
      locale: "en" as const,
      editable: true,
      onPlacementChange,
      automaticSupports: [top],
      baseSupport: base,
    };
    const view = render(
      <PalletScene
        {...props}
        support={base}
        placement={{ xMm: 1700, yMm: 500, zMm: 0, rotation: 0 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const frame = view.container
      .querySelector("svg[data-view]")
      ?.getAttribute("viewBox");
    fireEvent.keyDown(screen.getByRole("button", { name: "Move pallet" }), {
      key: "ArrowLeft",
    });
    expect(onPlacementChange).toHaveBeenLastCalledWith({
      xMm: 1600,
      yMm: 500,
      zMm: 1400,
      rotation: 0,
    });
    view.rerender(
      <PalletScene
        {...props}
        support={top}
        placement={{ xMm: 1600, yMm: 500, zMm: 1400, rotation: 0 }}
      />,
    );
    expect(view.container.querySelector("svg[data-view]")).toHaveAttribute(
      "viewBox",
      frame,
    );
    expect(
      screen.getByText(/supporting base is too small/),
    ).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "Move pallet" }), {
      key: "ArrowRight",
    });
    expect(onPlacementChange).toHaveBeenLastCalledWith({
      xMm: 1700,
      yMm: 500,
      zMm: 0,
      rotation: 0,
    });
  });

  it("bounds zoom, preserves physical placement, and resets the complete camera", () => {
    const onPlacementChange = vi.fn();
    const { container } = render(
      <PalletScene
        dimensions={dimensions}
        area={area}
        placement={placement}
        locale="en"
        editable
        onPlacementChange={onPlacementChange}
      />,
    );
    const svg = container.querySelector("svg[data-view]")!;
    const fitted = svg.getAttribute("viewBox");
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    for (let step = 0; step < 8; step++) {
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    }
    expect(svg).toHaveAttribute("data-camera-zoom", "2.5");
    expect(svg.getAttribute("viewBox")).not.toBe(fitted);
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(svg).toHaveAttribute("data-camera-zoom", "2.25");
    fireEvent.click(screen.getByRole("button", { name: "Rotate view" }));
    fireEvent.click(screen.getByRole("button", { name: "2D plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(svg).toHaveAttribute("data-camera-zoom", "1");
    expect(svg).toHaveAttribute("data-camera-rotation", "0");
    expect(svg).toHaveAttribute("data-view", "3d");
    expect(svg).toHaveAttribute("viewBox", fitted);
    expect(onPlacementChange).not.toHaveBeenCalled();
  });

  it("uses the zoomed screen transform for dragging and keeps the zoomed camera steady", () => {
    const onPlacementChange = vi.fn();
    const props = {
      dimensions,
      area,
      locale: "en" as const,
      editable: true,
      onPlacementChange,
    };
    const { container, rerender } = render(
      <PalletScene {...props} placement={placement} />,
    );
    const svg = container.querySelector("svg[data-view]")!;
    fireEvent.click(screen.getByRole("button", { name: "2D plan" }));
    for (let step = 0; step < 4; step++)
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const frame = svg.getAttribute("viewBox");
    const inverse = vi.fn(() => ({ scale: 5 }));
    Object.defineProperties(svg, {
      getScreenCTM: { value: () => ({ inverse }) },
      createSVGPoint: {
        value: () => ({
          x: 0,
          y: 0,
          matrixTransform(
            this: { x: number; y: number },
            matrix: { scale: number },
          ) {
            return { x: this.x * matrix.scale, y: this.y * matrix.scale };
          },
        }),
      },
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: vi.fn() },
    });
    const pointer = (type: string, clientX: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX,
        clientY: 10,
      });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    };
    fireEvent(
      screen.getByRole("button", { name: "Move pallet" }),
      pointer("pointerdown", 10),
    );
    fireEvent(svg, pointer("pointermove", 30));
    expect(inverse).toHaveBeenCalledTimes(2);
    expect(onPlacementChange).toHaveBeenLastCalledWith({
      ...placement,
      xMm: 100,
    });
    rerender(<PalletScene {...props} placement={{ ...placement, xMm: 100 }} />);
    expect(svg).toHaveAttribute("viewBox", frame);
    expect(svg).toHaveAttribute("data-camera-zoom", "2");
    fireEvent(svg, pointer("pointerup", 30));
    onPlacementChange.mockClear();
    fireEvent(svg, pointer("pointermove", 50));
    expect(onPlacementChange).not.toHaveBeenCalled();
  });

  it("labels an in-transit source as last confirmed instead of stored or reserved", () => {
    render(
      <PalletScene
        dimensions={dimensions}
        area={area}
        placement={placement}
        locale="en"
        status="SOURCE"
      />,
    );
    expect(
      screen.getByText("Last confirmed source position · Pallet in transit"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", {
        name: "Pallet at last confirmed source position",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Stored at this position"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Reserved · Awaiting physical storage"),
    ).not.toBeInTheDocument();
  });

  it("shows the original footprint without blocking a same-location reposition", () => {
    const { container } = render(
      <PalletScene
        dimensions={dimensions}
        area={area}
        placement={placement}
        locale="en"
        editable
        onPlacementChange={() => {}}
        sourceFootprint={{
          ...dimensions,
          id: "source",
          label: "Last confirmed position",
          xMm: 0,
          yMm: 0,
        }}
      />,
    );
    expect(
      container.querySelector('[data-source-footprint="true"]'),
    ).toBeInTheDocument();
    expect(screen.getByText("Fits at this position")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "2D plan" }));
    expect(
      screen.getByRole("group", { name: "Last confirmed position" }),
    ).toBeInTheDocument();
  });

  it("keeps the camera frame steady when the pallet moves within a location", () => {
    const { container, rerender } = render(
      <PalletScene
        dimensions={dimensions}
        area={area}
        placement={placement}
        locale="en"
      />,
    );
    const originalViewBox = container
      .querySelector("svg[data-view]")
      ?.getAttribute("viewBox");
    rerender(
      <PalletScene
        dimensions={dimensions}
        area={area}
        placement={{ ...placement, xMm: 1_800, yMm: 2_000 }}
        locale="en"
      />,
    );
    expect(container.querySelector("svg[data-view]")).toHaveAttribute(
      "viewBox",
      originalViewBox,
    );
  });

  it("switches camera views without changing the actual pallet position", () => {
    const onPlacementChange = vi.fn();
    const { container } = render(
      <PalletScene
        dimensions={dimensions}
        area={area}
        placement={placement}
        onPlacementChange={onPlacementChange}
        editable
        locale="en"
      />,
    );
    const svg = container.querySelector("svg[data-view]");
    fireEvent.click(screen.getByRole("button", { name: "Rotate view" }));
    expect(svg).toHaveAttribute("data-camera-rotation", "90");
    fireEvent.click(screen.getByRole("button", { name: "2D plan" }));
    expect(svg).toHaveAttribute("data-view", "2d");
    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(svg).toHaveAttribute("data-view", "3d");
    expect(svg).toHaveAttribute("data-camera-rotation", "0");
    expect(onPlacementChange).not.toHaveBeenCalled();
  });

  it("lets operators move by keyboard and rotate the physical pallet separately", () => {
    const onPlacementChange = vi.fn();
    render(
      <PalletScene
        dimensions={dimensions}
        area={area}
        placement={placement}
        onPlacementChange={onPlacementChange}
        editable
        locale="en"
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Move pallet" }), {
      key: "ArrowRight",
    });
    expect(onPlacementChange).toHaveBeenLastCalledWith({
      ...placement,
      xMm: 100,
    });
    fireEvent.keyDown(screen.getByRole("button", { name: "Move pallet" }), {
      key: "ArrowUp",
    });
    expect(onPlacementChange).toHaveBeenLastCalledWith(placement);
    fireEvent.click(screen.getByRole("button", { name: "Rotate pallet 90°" }));
    expect(onPlacementChange).toHaveBeenLastCalledWith({
      ...placement,
      rotation: 90,
    });
  });

  it("renders invalid measurements safely and explains the correction", () => {
    const { container } = render(
      <PalletScene
        dimensions={{ widthMm: NaN, depthMm: 0, heightMm: Infinity }}
        locale="en"
      />,
    );
    expect(
      screen.getByText("Enter valid dimensions to preview the pallet."),
    ).toBeInTheDocument();
    expect(container.querySelector("svg[data-view]")?.outerHTML).not.toMatch(
      /NaN|Infinity/,
    );
    expect(
      screen.queryByRole("button", { name: "Move pallet" }),
    ).not.toBeInTheDocument();
    expect(container.querySelector("svg[data-view]")).toHaveAccessibleName(
      "Pallet preview",
    );
    expect(container.querySelector("svg[data-view]")?.textContent).not.toMatch(
      /1 m|Origin/,
    );
  });

  it("shows reservation collisions with a visible error and distinct occupancy", () => {
    const { container } = render(
      <PalletScene
        dimensions={dimensions}
        area={area}
        placement={placement}
        locale="en"
        occupied={[
          {
            ...dimensions,
            xMm: 0,
            yMm: 0,
            id: "P1",
            label: "P-001",
            status: "RESERVED",
          },
        ]}
      />,
    );
    expect(
      screen.getByText("This position overlaps a stored or reserved pallet"),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-occupancy="RESERVED"]'),
    ).toBeInTheDocument();
  });

  it("renders tiny and large dimensions with finite bounded SVG coordinates", () => {
    const { container, rerender } = render(
      <PalletScene
        dimensions={{ widthMm: 1, depthMm: 1, heightMm: 1 }}
        locale="th"
      />,
    );
    expect(container.querySelector("svg[data-view]")?.outerHTML).not.toMatch(
      /NaN|Infinity/,
    );
    rerender(
      <PalletScene
        dimensions={{
          widthMm: 100_000_000,
          depthMm: 100_000_000,
          heightMm: 100_000_000,
        }}
        locale="th"
      />,
    );
    expect(container.querySelector("svg[data-view]")?.outerHTML).not.toMatch(
      /NaN|Infinity/,
    );
  });
  it("keeps product illustrations free of pretend dimensions and location coordinates", () => {
    const { container } = render(
      <PalletScene
        dimensions={dimensions}
        locale="en"
        showDimensions={false}
        label="Illustration — not measured"
      />,
    );
    expect(container.querySelector("svg[data-view]")).toHaveAccessibleName(
      "Illustration — not measured",
    );
    expect(container.textContent).not.toMatch(
      /Width|Length|Height|Origin|1\.2 m|1\.4 m/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Rotate view" }));
    expect(container.querySelector("svg[data-view]")).toHaveAttribute(
      "data-camera-rotation",
      "90",
    );
    fireEvent.click(screen.getByRole("button", { name: "2D plan" }));
    expect(container.textContent).not.toMatch(/Origin|1\.2 m|1\.4 m/);
  });
  it("distinguishes proposed, held and physically stored pallets without suggesting a stored pallet still needs placement", () => {
    const { container, rerender } = render(
      <PalletScene
        dimensions={dimensions}
        area={area}
        placement={placement}
        locale="en"
      />,
    );
    expect(screen.getByText("Fits at this position")).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Proposed pallet" }),
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        '[data-pallet-status="PROPOSED"] [stroke-dasharray]',
      ),
    ).not.toBeNull();
    rerender(
      <PalletScene
        dimensions={dimensions}
        area={area}
        placement={placement}
        locale="en"
        status="RESERVED"
      />,
    );
    expect(
      screen.getByText("Reserved · Awaiting physical storage"),
    ).toBeVisible();
    expect(screen.queryByText("Fits at this position")).not.toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Reserved pallet" }),
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        '[data-pallet-status="RESERVED"] [stroke-dasharray]',
      ),
    ).not.toBeNull();
    rerender(
      <PalletScene
        dimensions={dimensions}
        area={area}
        placement={placement}
        locale="en"
        status="STORED"
        editable
        onPlacementChange={() => undefined}
      />,
    );
    expect(screen.getByText("Stored at this position")).toBeVisible();
    expect(screen.queryByText("Fits at this position")).not.toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Stored pallet" }),
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        '[data-pallet-status="STORED"] [stroke-dasharray]',
      ),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Move pallet" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rotate view" }));
    expect(container.querySelector("svg[data-view]")).toHaveAttribute(
      "data-camera-rotation",
      "90",
    );
  });
  it("keeps measurement previews as measurement previews when no location is supplied", () => {
    render(<PalletScene dimensions={dimensions} locale="en" />);
    expect(
      screen.getByRole("group", { name: "This pallet" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Fits at this position")).not.toBeInTheDocument();
  });
});
