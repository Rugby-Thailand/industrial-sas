import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { writeSuccess } from "@tests/fixtures/finished-goods-ui";
import { JobScanScreen } from "./JobScanScreen";

const mocks = vi.hoisted(() => ({ save: vi.fn(), resize: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
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
        onSubmit([new File(["bad-image"], "demo.jpg", { type: "image/jpeg" })])
      }
    >
      Submit demo photo
    </button>
  ),
}));
vi.mock("./resizeImage", () => ({
  resizeImage: mocks.resize,
  toDataUrl: vi.fn(),
}));

beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue(writeSuccess("scan-a"));
  mocks.resize.mockReset().mockRejectedValue(new Error("Unreadable image"));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function start() {
  renderWithIntl(<JobScanScreen />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "Choose demo location" }));
}
function addTicket(index = 0) {
  fireEvent.click(screen.getByRole("button", { name: "Type manually" }));
  fireEvent.change(
    screen.getAllByRole("textbox", { name: /Job No\./ })[index]!,
    { target: { value: "FO69070073" } },
  );
  fireEvent.change(
    screen.getAllByRole("textbox", { name: /Product barcode/ })[index]!,
    { target: { value: "DEMO-BOX" } },
  );
}

it("retains entered tickets and reuses the same request after a lost save response", async () => {
  mocks.save.mockRejectedValueOnce(new Error("NETWORK_ERROR"));
  start();
  addTicket();
  fireEvent.click(screen.getByRole("button", { name: /Save 1/ }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Save 1/ })).toBeEnabled(),
  );
  expect(screen.getByRole("textbox", { name: /Job No\./ })).toHaveValue(
    "FO69070073",
  );
  fireEvent.click(screen.getByRole("button", { name: /Save 1/ }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[0]![0]).toEqual(mocks.save.mock.calls[1]![0]);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Scan more" })).toBeVisible(),
  );
});

it("blocks repeated identities until reviewed and invalidates review after an edit", () => {
  start();
  addTicket();
  addTicket(1);
  expect(screen.getByRole("button", { name: /Save 2/ })).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I checked these repeated tickets/ }),
  );
  expect(screen.getByRole("button", { name: /Save 2/ })).toBeEnabled();
  fireEvent.change(screen.getAllByRole("textbox", { name: /Job No\./ })[1]!, {
    target: { value: " FO69070073 " },
  });
  expect(screen.getByRole("button", { name: /Save 2/ })).toBeDisabled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("recovers a failed photo into an editable ticket instead of leaving it reading", async () => {
  start();
  fireEvent.click(screen.getByRole("button", { name: "Photos (AI)" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit demo photo" }));
  await waitFor(() =>
    expect(screen.getByText(/The photo could not be read/)).toBeVisible(),
  );
  expect(screen.getByRole("textbox", { name: /Job No\./ })).toBeEnabled();
  expect(screen.getByRole("button", { name: /Save 1/ })).toBeDisabled();
});

it("locks editing and prevents a second write while a save is pending", async () => {
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
  expect(screen.getByRole("textbox", { name: /Job No\./ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Type manually" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Saving/ }));
  expect(mocks.save).toHaveBeenCalledTimes(1);
  resolve(writeSuccess("scan-a"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Scan more" })).toBeVisible(),
  );
});
