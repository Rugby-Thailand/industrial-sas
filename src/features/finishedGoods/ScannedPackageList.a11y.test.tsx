import { useReducer } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { expect, it, vi } from "vitest";
import { ScannedPackageList } from "./ScannedPackageList";
import { initialScanSession, scanReducer } from "./scanSession";
vi.mock("./shared", () => ({ useFGText: () => ({ tr: (en: string) => en }) }));
function Harness() {
  let initial = initialScanSession();
  for (const key of ["A", "B", "C"]) {
    initial = scanReducer(initial, { type: "add", key, code: key });
    initial = scanReducer(initial, {
      type: "resolve",
      key,
      generation: 0,
      unit: { id: key, code: key, productName: "Product", version: 1 },
    });
  }
  const [state, dispatch] = useReducer(scanReducer, initial);
  return <ScannedPackageList state={state} dispatch={dispatch} />;
}
it("has accessible controls and keyboard reorder/remove with contiguous labels", async () => {
  const user = userEvent.setup();
  const { container } = render(<Harness />);
  expect(await axe(container)).toHaveNoViolations();
  expect(
    screen.queryByRole("button", { name: /Move .+ (up|down)/ }),
  ).not.toBeInTheDocument();
  const handle = screen.getByRole("button", { name: "Drag C to reorder" });
  handle.focus();
  await user.keyboard("{ArrowUp}");
  expect(
    screen
      .getAllByRole("listitem")
      .map((row) => row.textContent?.match(/[ABC]/)?.[0]),
  ).toEqual(["A", "C", "B"]);
  await user.click(screen.getByRole("button", { name: "Remove C" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByText("Bottom")).toBeInTheDocument();
});

it("shows a touch drop target, scrolls at the edge, drops and cancels safely", async () => {
  const scroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  const { unmount } = render(<Harness />);
  const rows = screen.getAllByRole("listitem");
  rows.forEach((row, index) =>
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
      top: index * 100,
      bottom: (index + 1) * 100,
      left: 0,
      right: 300,
      width: 300,
      height: 100,
      x: 0,
      y: index * 100,
      toJSON: () => ({}),
    }),
  );
  const handle = screen.getByRole("button", { name: "Drag C to reorder" });
  handle.setPointerCapture = vi.fn();
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 250 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 10 });
  expect(screen.getByText("Drop at position 1")).toBeInTheDocument();
  await waitFor(() => expect(scroll).toHaveBeenCalledWith(0, -18));
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: 10 });
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("C");
  fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientY: 10 });
  fireEvent.pointerMove(handle, { pointerId: 2, clientY: 290 });
  fireEvent.pointerCancel(handle, { pointerId: 2 });
  expect(screen.queryByText(/Drop at position/)).not.toBeInTheDocument();
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("C");
  const before = scroll.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(scroll).toHaveBeenCalledTimes(before);
  unmount();
  scroll.mockRestore();
});
