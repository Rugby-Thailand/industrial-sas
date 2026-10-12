import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { writeSuccess } from "@tests/fixtures/finished-goods-ui";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import { guardedNavigate } from "@/lib/navigationGuard";
import { JobScanScreen } from "./JobScanScreen";

const mocks = vi.hoisted(() => ({ save: vi.fn(), push: vi.fn() }));
vi.mock("../BarcodeCameraBox", () => ({ BarcodeCameraBox: () => null }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: mocks.push, back: vi.fn() }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.save,
  useAction: () => vi.fn(),
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (id: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("@/hooks/useDraftKey", () => ({ useDraftKey: () => "actor-a" }));
vi.mock("@/hooks/useCanManage", () => ({ useCanManage: () => true }));
vi.mock("@/lib/uploadthing", () => ({
  useUploadThing: () => ({ startUpload: vi.fn() }),
}));
vi.mock("./LocationPicker", () => ({
  LocationPicker: ({
    onPick,
  }: {
    onPick: (location: { text: string }) => void;
  }) => (
    <button onClick={() => onPick({ text: "DEMO-L01" })}>
      Choose demo location
    </button>
  ),
}));
vi.mock("./PhotoCapture", () => ({
  PhotoCapture: ({ onSubmit }: { onSubmit: (files: File[]) => void }) => (
    <button
      onClick={() =>
        onSubmit([new File(["photo"], "demo.jpg", { type: "image/jpeg" })])
      }
    >
      Submit demo photo
    </button>
  ),
}));
vi.mock("./resizeImage", () => ({
  resizeImage: () => Promise.reject(new Error("Unreadable image")),
  toDataUrl: vi.fn(),
}));

const PAGE = "/en/finished-goods/scan";
let back: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue(writeSuccess("scan-a"));
  mocks.push.mockReset();
  window.history.replaceState({ __NA: true }, "", PAGE);
  back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  vi.spyOn(window.history, "forward").mockImplementation(() => {});
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo-preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function start() {
  const view = renderWithIntl(
    <NavigationGuardProvider>
      <JobScanScreen />
    </NavigationGuardProvider>,
    { locale: "en" },
  );
  fireEvent.click(screen.getByRole("button", { name: "Choose demo location" }));
  return view;
}
function addTicket() {
  fireEvent.click(screen.getByRole("button", { name: "Manual" }));
  fireEvent.change(screen.getByRole("textbox", { name: /Job No\./ }), {
    target: { value: "FO69070073" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: /Product barcode/ }), {
    target: { value: "DEMO-BOX" },
  });
}
function bufferTraversal() {
  act(() => {
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: window.history.state }),
    );
  });
}

it("leaves without asking while no ticket is captured", () => {
  start();
  const leave = vi.fn();
  act(() => guardedNavigate(leave));
  expect(leave).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps captured tickets on Keep editing and on a browser Back", () => {
  start();
  addTicket();
  const leave = vi.fn();
  act(() => guardedNavigate(leave));
  expect(
    screen.getByRole("dialog", { name: "Save changes before leaving?" }),
  ).toBeVisible();
  // Saving needs the scan form's own checks; the prompt never sends tickets.
  expect(
    screen.queryByRole("button", { name: "Save and continue" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(leave).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: /Job No\./ })).toHaveValue(
    "FO69070073",
  );

  // Back from the scan page: the owner restores the buffer and asks.
  const buffered = window.history.state;
  act(() => {
    window.history.replaceState({ __NA: true }, "", "/en/finished-goods");
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  });
  expect(screen.getByRole("dialog")).toBeVisible();
  act(() => {
    window.history.replaceState(buffered, "", PAGE);
    window.dispatchEvent(new PopStateEvent("popstate", { state: buffered }));
  });
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByRole("textbox", { name: /Job No\./ })).toHaveValue(
    "FO69070073",
  );
  expect(mocks.save).not.toHaveBeenCalled();
});

it("discards tickets and revokes their photo previews before leaving", async () => {
  start();
  fireEvent.click(screen.getByRole("button", { name: "Photo AI" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit demo photo" }));
  await waitFor(() =>
    expect(screen.getByText(/The photo could not be read/)).toBeVisible(),
  );
  const leave = vi.fn();
  act(() => guardedNavigate(leave));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:demo-preview");
  expect(leave).not.toHaveBeenCalled();
  bufferTraversal();
  expect(leave).toHaveBeenCalledOnce();
  expect(screen.queryByRole("textbox", { name: /Job No\./ })).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("blocks leaving while tickets are being saved, then clears the guard on success", async () => {
  let resolve!: (result: ReturnType<typeof writeSuccess>) => void;
  mocks.save.mockImplementation(
    () =>
      new Promise((result) => {
        resolve = result;
      }),
  );
  start();
  addTicket();
  fireEvent.click(screen.getByRole("button", { name: /Save 1/ }));
  const leave = vi.fn();
  act(() => guardedNavigate(leave));
  expect(screen.getByTestId("navigation-guard-pending")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Discard changes" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await act(async () => resolve(writeSuccess("scan-a")));
  expect(screen.getByRole("button", { name: "Scan more" })).toBeVisible();
  // The save settled the draft: its buffer is removed once.
  expect(back).toHaveBeenCalledOnce();
  bufferTraversal();
  act(() => guardedNavigate(leave));
  expect(leave).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("ignores a save that completes after the scan page was left", async () => {
  let resolve!: (result: ReturnType<typeof writeSuccess>) => void;
  mocks.save.mockImplementation(
    () =>
      new Promise((result) => {
        resolve = result;
      }),
  );
  const view = start();
  addTicket();
  fireEvent.click(screen.getByRole("button", { name: /Save 1/ }));
  view.unmount();
  vi.mocked(URL.revokeObjectURL).mockClear();
  await act(async () => resolve(writeSuccess("scan-a")));
  expect(back).not.toHaveBeenCalled();
  expect(mocks.push).not.toHaveBeenCalled();
});
