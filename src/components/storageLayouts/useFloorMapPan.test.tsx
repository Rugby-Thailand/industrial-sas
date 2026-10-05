import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFloorMapPan } from "./useFloorMapPan";

afterEach(() => vi.restoreAllMocks());
function setup(zoom = 2) {
  let frame: FrameRequestCallback | undefined;
  const request = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback) => {
      frame = callback;
      return 42;
    });
  const cancel = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation(() => {
      frame = undefined;
    });
  const commit = vi.fn(),
    select = vi.fn();
  function Scene() {
    const { group, handlers } = useFloorMapPan({
      zoom,
      center: { x: 250, y: 250 },
      frame: { width: 500, height: 500 },
      clamp: (point) => ({ x: Math.max(0, point.x), y: Math.max(0, point.y) }),
      transform: (point) => `translate(${point.x} ${point.y})`,
      onCommit: commit,
    });
    return (
      <svg aria-label="Scene" {...handlers}>
        <g ref={group} transform="translate(250 250)">
          <rect role="button" aria-label="Location" onClick={select} />
        </g>
      </svg>
    );
  }
  const view = render(<Scene />);
  const svg = screen.getByLabelText("Scene");
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 500, 500),
  );
  const pointer = (
    type: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel",
    x: number,
    id = 1,
  ) =>
    fireEvent[type](svg, {
      pointerId: id,
      button: 0,
      clientX: x,
      clientY: 100,
    });
  return {
    view,
    svg,
    request,
    cancel,
    commit,
    select,
    pointer,
    paint: () => {
      const current = frame;
      frame = undefined;
      current?.(16);
    },
  };
}
describe("floor camera pan", () => {
  it("coalesces a burst into one transform update and commits only when the drag ends", () => {
    const { svg, pointer, request, commit, paint, select } = setup();
    pointer("pointerDown", 100);
    for (let x = 105; x <= 200; x++) pointer("pointerMove", x);
    expect(request).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    paint();
    expect(svg.querySelector("g")).toHaveAttribute(
      "transform",
      "translate(200 250)",
    );
    pointer("pointerMove", 210);
    pointer("pointerUp", 210);
    expect(commit).toHaveBeenCalledExactlyOnceWith({ x: 195, y: 250 });
    fireEvent.click(screen.getByRole("button", { name: "Location" }));
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Location" }));
    expect(select).toHaveBeenCalledTimes(1);
  });
  it("flushes pending movement on cancellation and ignores unrelated pointers", () => {
    const { pointer, commit, cancel } = setup();
    pointer("pointerDown", 100);
    pointer("pointerMove", 200, 2);
    pointer("pointerCancel", 200, 2);
    expect(commit).not.toHaveBeenCalled();
    pointer("pointerMove", 180);
    pointer("pointerCancel", 180);
    expect(cancel).toHaveBeenCalledWith(42);
    expect(commit).toHaveBeenCalledExactlyOnceWith({ x: 210, y: 250 });
  });
  it("allows small presses to select and cancels scheduled work on unmount", () => {
    const { pointer, select, view, cancel, commit } = setup();
    pointer("pointerDown", 100);
    pointer("pointerMove", 102);
    pointer("pointerUp", 102);
    fireEvent.click(screen.getByRole("button", { name: "Location" }));
    expect(select).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    pointer("pointerDown", 100);
    pointer("pointerMove", 120);
    view.unmount();
    expect(cancel).toHaveBeenCalledWith(42);
  });
  it("does not pan an unzoomed floor", () => {
    const { pointer, request, commit } = setup(1);
    pointer("pointerDown", 100);
    pointer("pointerMove", 300);
    pointer("pointerUp", 300);
    expect(request).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});
