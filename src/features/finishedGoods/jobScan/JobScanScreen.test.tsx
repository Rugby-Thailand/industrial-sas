import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { writeSuccess } from "@tests/fixtures/finished-goods-ui";
import { JobScanScreen } from "./JobScanScreen";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  resize: vi.fn(),
  imageCodes: undefined as ((codes: string[]) => void) | undefined,
  decode: undefined as ((code: string) => void) | undefined,
}));
vi.mock("../BarcodeCameraBox", () => ({
  BarcodeCameraBox: ({
    onCode,
    onClose,
    onImageCodes,
  }: {
    onImageCodes?: (codes: string[]) => void;
    onCode: (code: string) => void;
    onClose: () => void;
  }) => {
    mocks.decode = onCode;
    mocks.imageCodes = onImageCodes;
    return (
      <div>
        QA barcode scanner active<button onClick={onClose}>Stop camera</button>
      </div>
    );
  },
}));
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
  fireEvent.click(screen.getByRole("button", { name: "Scan barcode" }));
  expect(screen.getByText("QA barcode scanner active")).toBeVisible();
  const lateDecode = mocks.decode!;
  fireEvent.click(screen.getByRole("button", { name: /Save 1/ }));
  expect(
    screen.queryByText("QA barcode scanner active"),
  ).not.toBeInTheDocument();
  act(() => lateDecode("DEMO-SECOND-BOX"));
  expect(
    screen.getAllByRole("textbox", { name: /Product barcode/ }),
  ).toHaveLength(1);
  expect(screen.getByRole("textbox", { name: /Product barcode/ })).toHaveValue(
    "DEMO-BOX",
  );
  expect(screen.getByRole("textbox", { name: /Job No\./ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Type manually" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Saving/ }));
  expect(mocks.save).toHaveBeenCalledTimes(1);
  resolve(writeSuccess("scan-a"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Scan more" })).toBeVisible(),
  );
});

it("scans into the selected ticket field without choosing a different incomplete ticket", () => {
  start();
  fireEvent.click(screen.getByRole("button", { name: "Type manually" }));
  fireEvent.click(screen.getByRole("button", { name: "Type manually" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Scan Job No." })[0]!);
  expect(screen.getByRole("dialog")).toHaveTextContent("Ticket #1");
  act(() => mocks.decode!("DEMO-BOX"));
  expect(screen.getByRole("alert")).toHaveTextContent("different field");
  expect(screen.getByRole("dialog")).toBeVisible();
  act(() => mocks.decode!(" FO69070073 "));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const jobs = screen.getAllByRole("textbox", { name: /Job No\./ });
  expect(jobs[0]).toHaveValue("FO69070073");
  expect(jobs[1]).toHaveValue("");
  expect(
    screen.getAllByRole("textbox", { name: /Product barcode/ })[0],
  ).toHaveValue("");
  expect(mocks.save).not.toHaveBeenCalled();
});

it("requires replacement confirmation, keeps the original on cancel, and applies once", () => {
  start();
  addTicket();
  addTicket(1);
  fireEvent.click(
    screen.getAllByRole("button", { name: "Scan Product barcode" })[1]!,
  );
  const decode = mocks.decode!;
  act(() => {
    decode("NEW-BOX");
    decode("WRONG-SECOND-FRAME");
  });
  expect(screen.getByRole("dialog")).toHaveTextContent("DEMO-BOX");
  expect(screen.getByRole("dialog")).toHaveTextContent("NEW-BOX");
  expect(screen.queryByText("WRONG-SECOND-FRAME")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    screen.getAllByRole("textbox", { name: /Product barcode/ })[1],
  ).toHaveValue("DEMO-BOX");
  fireEvent.click(
    screen.getAllByRole("button", { name: "Scan Product barcode" })[1]!,
  );
  act(() => mocks.decode!("NEW-BOX"));
  fireEvent.click(screen.getByRole("button", { name: "Replace value" }));
  const products = screen.getAllByRole("textbox", { name: /Product barcode/ });
  expect(products[0]).toHaveValue("DEMO-BOX");
  expect(products[1]).toHaveValue("NEW-BOX");
  act(() => decode("LATE-CODE"));
  expect(products[1]).toHaveValue("NEW-BOX");
  expect(mocks.save).not.toHaveBeenCalled();
});

it("ignores a closed global scanner while a field scanner is open", () => {
  start();
  addTicket();
  fireEvent.click(screen.getByRole("button", { name: "Scan barcode" }));
  const oldGlobalDecode = mocks.decode!;
  fireEvent.click(screen.getByRole("button", { name: "Scan Product barcode" }));
  act(() => oldGlobalDecode("LATE-GLOBAL-BOX"));
  expect(screen.getByRole("dialog")).not.toHaveTextContent("LATE-GLOBAL-BOX");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    screen.getAllByRole("textbox", { name: /Product barcode/ }),
  ).toHaveLength(1);
  expect(screen.getByRole("textbox", { name: /Product barcode/ })).toHaveValue(
    "DEMO-BOX",
  );
});

it("ignores a field result after its ticket is removed", () => {
  start();
  addTicket();
  fireEvent.click(screen.getByRole("button", { name: "Scan Job No." }));
  const late = mocks.decode!;
  fireEvent.click(
    screen.getByRole("button", { name: "Remove #1", hidden: true }),
  );
  act(() => late("FO69079999"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("textbox", { name: /Job No\./ }),
  ).not.toBeInTheDocument();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("matches code length limits and rejects storage QR payloads without changing drafts", () => {
  start();
  addTicket();
  expect(screen.getByRole("textbox", { name: /Job No\./ })).toHaveAttribute(
    "maxlength",
    "100",
  );
  expect(
    screen.getByRole("textbox", { name: /Product barcode/ }),
  ).toHaveAttribute("maxlength", "200");
  fireEvent.click(screen.getByRole("button", { name: "Scan Product barcode" }));
  act(() => mocks.decode!("ISAS:LOCATION:1:zone-a"));
  expect(screen.getByRole("alert")).toHaveTextContent("cannot be used here");
  act(() => mocks.decode!("A".repeat(201)));
  expect(screen.getByRole("alert")).toHaveTextContent("too long");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("textbox", { name: /Product barcode/ })).toHaveValue(
    "DEMO-BOX",
  );
});

it("keeps focus on the scan action after Escape and exposes accessible field and dialog names", async () => {
  const user = userEvent.setup();
  start();
  addTicket();
  const button = screen.getByRole("button", { name: "Scan Job No." });
  await user.click(button);
  expect(screen.getByRole("dialog", { name: "Scan Job No." })).toBeVisible();
  expect(await axe(screen.getByRole("dialog"))).toHaveNoViolations();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(button).toHaveFocus();
});

it("applies an image JOB/product pair together and saves the decoded identities", async () => {
  start();
  fireEvent.click(screen.getByRole("button", { name: "Scan barcode" }));
  act(() => mocks.imageCodes!(["FO12345678", "DEMO-PRODUCT"]));
  expect(screen.getByRole("textbox", { name: /Job No\./ })).toHaveValue(
    "FO12345678",
  );
  expect(screen.getByRole("textbox", { name: /Product barcode/ })).toHaveValue(
    "DEMO-PRODUCT",
  );
  expect(mocks.resize).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Save 1/ }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0]![0].items).toEqual([
    {
      factoryOrder: "FO12345678",
      productBarcodeText: "DEMO-PRODUCT",
      source: "BARCODE",
    },
  ]);
});
it("requires duplicate review before saving repeated photographed physical units", async () => {
  start();
  fireEvent.click(screen.getByRole("button", { name: "Scan barcode" }));
  act(() => mocks.imageCodes!(["FO12345678", "DEMO-PRODUCT"]));
  act(() => mocks.imageCodes!(["FO12345678", "DEMO-PRODUCT"]));
  expect(screen.getAllByRole("textbox", { name: /Job No\./ })).toHaveLength(2);
  const save = screen.getByRole("button", { name: /Save 2/ });
  expect(save).toBeDisabled();
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(save).toBeEnabled();
  fireEvent.click(save);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0]![0].items).toHaveLength(2);
});
it("manual edits close image intake and reject its late results", () => {
  start();
  addTicket();
  fireEvent.click(screen.getByRole("button", { name: "Scan barcode" }));
  const late = mocks.imageCodes!;
  fireEvent.change(screen.getByRole("textbox", { name: /Product barcode/ }), {
    target: { value: "EDITED-PRODUCT" },
  });
  expect(
    screen.queryByText("QA barcode scanner active"),
  ).not.toBeInTheDocument();
  act(() => late(["FO87654321", "LATE-PRODUCT"]));
  expect(
    screen.getAllByRole("textbox", { name: /Product barcode/ }),
  ).toHaveLength(1);
  expect(screen.getByRole("textbox", { name: /Product barcode/ })).toHaveValue(
    "EDITED-PRODUCT",
  );
});
