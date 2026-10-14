import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { querySuccess, writeSuccess } from "@tests/fixtures/finished-goods-ui";
import { JobScanScreen } from "./JobScanScreen";
import type * as PhotoCaptureModule from "./PhotoCapture";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  save: vi.fn(),
  resize: vi.fn(),
  upload: vi.fn(),
  extract: vi.fn(),
  toDataUrl: vi.fn(),
  imageCodes: undefined as ((codes: string[]) => void) | undefined,
  decode: undefined as ((code: string) => void) | undefined,
  pickerPresentation: [] as (string | undefined)[],
  realPhotos: false,
}));
vi.mock("../BarcodeCameraBox", () => ({
  BarcodeCameraBox: ({
    onCode,
    onImageCodes,
    closeControl = true,
  }: {
    onImageCodes?: (codes: string[]) => void;
    onCode: (code: string) => void;
    closeControl?: boolean;
  }) => {
    mocks.decode = onCode;
    mocks.imageCodes = onImageCodes;
    return (
      <div>
        QA barcode scanner active
        {/* The real frame renders its Stop camera close unless opted out. */}
        {closeControl && <button>Stop camera</button>}
      </div>
    );
  },
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: mocks.replace }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.save,
  useAction: () => mocks.extract,
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (id: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("@/hooks/useDraftKey", () => ({ useDraftKey: () => "actor-a" }));
vi.mock("@/hooks/useCanManage", () => ({ useCanManage: () => true }));
vi.mock("@/lib/uploadthing", () => ({
  useUploadThing: () => ({ startUpload: mocks.upload }),
}));
vi.mock("./LocationPicker", () => ({
  LocationPicker: ({
    onPick,
    presentation,
  }: {
    onPick: (location: Record<string, unknown> & { text: string }) => void;
    presentation?: string;
  }) => (
    mocks.pickerPresentation.push(presentation),
    (
      <>
        <button onClick={() => onPick({ text: "DEMO-L01" })}>
          Choose demo location
        </button>
        <button
          onClick={() =>
            onPick({
              text: "F1-L1-1",
              code: "F1-L1-1",
              locationId: "location-f1",
              buildingName: "Building A",
              floorNumber: 1,
            })
          }
        >
          Choose mapped location
        </button>
        <button
          onClick={() =>
            onPick({
              text: "F1-L1-2",
              code: "F1-L1-2",
              name: "F1-L1-2",
              locationId: "location-f2",
              buildingName: "Building A",
              floorNumber: 1,
            })
          }
        >
          Choose location named by its code
        </button>
        <button
          onClick={() =>
            onPick({
              text: "F1-L1-3",
              code: "F1-L1-3",
              name: "North dock",
              locationId: "location-f3",
            })
          }
        >
          Choose named location
        </button>
      </>
    )
  ),
}));
vi.mock("./PhotoCapture", async (original) => {
  const actual = await original<typeof PhotoCaptureModule>();
  return {
    PhotoCapture: (props: ComponentProps<typeof actual.PhotoCapture>) =>
      mocks.realPhotos ? (
        <actual.PhotoCapture {...props} />
      ) : (
        <button
          onClick={() =>
            props.onSubmit([
              new File(["bad-image"], "demo.jpg", { type: "image/jpeg" }),
            ])
          }
        >
          Submit demo photo
        </button>
      ),
  };
});

vi.mock("./resizeImage", () => ({
  resizeImage: mocks.resize,
  toDataUrl: mocks.toDataUrl,
}));

beforeEach(() => {
  mocks.realPhotos = false;
  window.history.replaceState({ __NA: true }, "", "/en/finished-goods/scan");
  mocks.upload.mockReset().mockResolvedValue(undefined);
  mocks.extract.mockReset().mockResolvedValue(querySuccess({ ok: false }));
  mocks.toDataUrl.mockReset().mockResolvedValue("data:image/jpeg;base64,AA");
  mocks.save.mockReset().mockResolvedValue(writeSuccess("scan-a"));
  mocks.resize.mockReset().mockRejectedValue(new Error("Unreadable image"));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function start() {
  const view = renderWithIntl(<JobScanScreen />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "Choose demo location" }));
  return view;
}
function addTicket(index = 0) {
  fireEvent.click(screen.getByRole("button", { name: "Manual" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Photo AI" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
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
  expect(screen.getByRole("button", { name: "Manual" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Saving/ }));
  expect(mocks.save).toHaveBeenCalledTimes(1);
  resolve(writeSuccess("scan-a"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Scan more" })).toBeVisible(),
  );
});

it("scans into the selected ticket field without choosing a different incomplete ticket", () => {
  start();
  fireEvent.click(screen.getByRole("button", { name: "Manual" }));
  fireEvent.click(screen.getByRole("button", { name: "Manual" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
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
      storageFormat: "PALLET",
    },
  ]);
});
it("requires duplicate review before saving repeated photographed physical units", async () => {
  start();
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
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

it("shows the selected location with its real status and offers save only once a ticket exists", () => {
  start();
  expect(screen.getByRole("heading", { name: "Scan pallet" })).toBeVisible();
  const strip = screen.getByRole("region", { name: "Location" });
  expect(strip).toHaveTextContent("DEMO-L01");
  expect(strip).toHaveTextContent("Needs location");
  expect(
    screen.queryByRole("button", { name: /Save/ }),
  ).not.toBeInTheDocument();
  addTicket();
  expect(screen.getByRole("button", { name: "Save 1 ticket" })).toBeEnabled();
});

it.each([
  ["Choose location named by its code", "F1-L1-2", "Building A · Floor 1"],
  ["Choose named location", "F1-L1-3", "North dock"],
])(
  "the location strip after %s names the code once and keeps distinct details",
  (choice, code, details) => {
    renderWithIntl(<JobScanScreen />, { locale: "en" });
    fireEvent.click(screen.getByRole("button", { name: choice }));
    const strip = screen.getByRole("region", { name: "Location" });
    expect(within(strip).getAllByText(code, { exact: false })).toHaveLength(1);
    expect(within(strip).getByText(details)).toBeVisible();
  },
);

it("the pressed Scan code mode is the barcode panel's only close and consumes its entry before the next Back", async () => {
  start();
  await waitFor(() => expect(window.location.search).toContain("jobScanStep"));
  const scan = screen.getByRole("button", { name: "Scan code" });
  fireEvent.click(scan);
  expect(screen.getByText("QA barcode scanner active")).toBeVisible();
  await waitFor(() => expect(window.location.search).toContain("overlay"));
  expect(
    screen.queryByRole("button", { name: "Stop camera" }),
  ).not.toBeInTheDocument();
  const late = mocks.decode!;
  fireEvent.click(scan);
  expect(scan).toHaveAttribute("aria-pressed", "false");
  expect(screen.queryByText("QA barcode scanner active")).toBeNull();
  await waitFor(() => expect(window.location.search).not.toContain("overlay"));
  act(() => late("FO99999999"));
  expect(screen.queryByRole("textbox", { name: /Job No\./ })).toBeNull();
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Choose demo location" }),
    ).toBeVisible(),
  );
});

it("the pressed Photo AI mode is the photo panel's only close, retaining photos and rejecting late capture before the next Back", async () => {
  mocks.realPhotos = true;
  const stop = vi.fn();
  let encoded!: (blob: Blob | null) => void;
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }),
    },
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(
    640,
  );
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(
    480,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => {
      encoded = callback;
    },
  );
  window.history.replaceState(
    { __NA: true },
    "",
    "/en/finished-goods/scan?source=photos#tickets",
  );
  start();
  await waitFor(() => expect(window.location.search).toContain("jobScanStep"));
  const photo = screen.getByRole("button", { name: "Photo AI" });
  fireEvent.click(photo);
  const shutter = screen.getByRole("button", { name: "Take photo" });
  await waitFor(() => expect(shutter).toBeEnabled());
  expect(
    screen.queryByRole("button", { name: "Close Photo AI" }),
  ).not.toBeInTheDocument();
  const file = new File(["retained"], "retained.jpg", { type: "image/jpeg" });
  fireEvent.change(
    screen.getByLabelText("Choose photos", { selector: "input" }),
    { target: { files: [file] } },
  );
  fireEvent.click(shutter);
  fireEvent.click(photo);
  expect(photo).toHaveAttribute("aria-pressed", "false");
  expect(stop).toHaveBeenCalledOnce();
  await waitFor(() => expect(window.location.search).not.toContain("overlay"));
  act(() => encoded(new Blob(["late"], { type: "image/jpeg" })));
  expect(URL.createObjectURL).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  expect(mocks.resize).not.toHaveBeenCalled();
  fireEvent.click(photo);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Take photo" })).toBeEnabled(),
  );
  expect(screen.getByText("1 / 20 photos")).toBeVisible();
  fireEvent.click(photo);
  await waitFor(() => expect(window.location.search).not.toContain("overlay"));
  act(() => window.history.back());
  await screen.findByRole("button", { name: "Choose demo location" });
  expect(
    window.location.pathname + window.location.search + window.location.hash,
  ).toBe("/en/finished-goods/scan?source=photos#tickets");
  expect(mocks.save).not.toHaveBeenCalled();
});

it("keeps one acquisition panel open and Manual closes the barcode scanner", () => {
  start();
  const photo = screen.getByRole("button", { name: "Photo AI" });
  const scan = screen.getByRole("button", { name: "Scan code" });
  fireEvent.click(photo);
  expect(photo).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(scan);
  expect(photo).toHaveAttribute("aria-pressed", "false");
  expect(scan).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.queryByRole("button", { name: "Submit demo photo" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Manual" }));
  expect(scan).toHaveAttribute("aria-pressed", "false");
  expect(
    screen.queryByText("QA barcode scanner active"),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("textbox", { name: /Job No\./ })).toHaveLength(1);
});

it("keeps drafts when the location changes and saves them at the new location", async () => {
  start();
  addTicket();
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Where are we?" }),
    ).toBeVisible(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Choose mapped location" }),
  );
  const strip = screen.getByRole("region", { name: "Location" });
  expect(strip).toHaveTextContent("F1-L1-1");
  expect(strip).toHaveTextContent("Building A · Floor 1");
  expect(strip).toHaveTextContent("Location set");
  expect(screen.getByRole("textbox", { name: /Job No\./ })).toHaveValue(
    "FO69070073",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save 1 ticket" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0]![0]).toMatchObject({
    locationText: "F1-L1-1",
    location: { locationId: "location-f1" },
  });
});

it("preserves the photo collection when adding a manual ticket", async () => {
  start();
  fireEvent.click(screen.getByRole("button", { name: "Photo AI" }));
  const collection = screen.getByRole("button", { name: "Submit demo photo" });
  fireEvent.click(screen.getByRole("button", { name: "Manual" }));
  // The same mounted collection must survive, along with its unsent photos.
  expect(screen.getByRole("button", { name: "Submit demo photo" })).toBe(
    collection,
  );
  expect(screen.getByRole("button", { name: "Photo AI" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(collection);
  await waitFor(() =>
    expect(screen.getAllByRole("textbox", { name: /Job No\./ })).toHaveLength(
      2,
    ),
  );
});

it("opts only its location step into the job-scan scanner presentation", () => {
  mocks.pickerPresentation.length = 0;
  renderWithIntl(<JobScanScreen />, { locale: "en" });
  expect(screen.getByRole("heading", { name: "Where are we?" })).toBeVisible();
  expect(mocks.pickerPresentation.at(-1)).toBe("jobScan");
});

const storedPhotoUrl = "https://example.ufs.sh/f/job-ticket.jpg";
function successfulExtraction() {
  return querySuccess({
    ok: true,
    fields: { factoryOrder: "FO69070073", productBarcodeText: "DEMO-BOX" },
    raw: "{}",
    mock: false,
  });
}
function submitPhoto() {
  fireEvent.click(screen.getByRole("button", { name: "Photo AI" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit demo photo" }));
}

it("uploads one resized image, extracts independently, and saves its provider URL", async () => {
  const resized = new File(["resized"], "resized.jpg", { type: "image/jpeg" });
  mocks.resize.mockResolvedValue(resized);
  mocks.upload.mockResolvedValue([{ ufsUrl: storedPhotoUrl }]);
  mocks.extract.mockResolvedValue(successfulExtraction());
  const { container } = start();
  submitPhoto();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Save 1/ })).toBeEnabled(),
  );
  expect(mocks.upload).toHaveBeenCalledExactlyOnceWith([resized]);
  expect(mocks.toDataUrl).toHaveBeenCalledExactlyOnceWith(resized);
  expect(mocks.extract).toHaveBeenCalledExactlyOnceWith({
    warehouseId: "warehouse-a",
    imageUrl: "data:image/jpeg;base64,AA",
  });
  expect(container.querySelector("img")).toHaveAttribute("src", storedPhotoUrl);
  fireEvent.click(screen.getByRole("button", { name: /Save 1/ }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0]![0].items).toEqual([
    expect.objectContaining({
      source: "AI",
      imageUrl: storedPhotoUrl,
      factoryOrder: "FO69070073",
      productBarcodeText: "DEMO-BOX",
    }),
  ]);
  await screen.findByRole("button", { name: "Scan more" });
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:demo");
});

it.each(["rejected", "missing"])(
  "keeps AI-filled fields editable after a %s upload result",
  async (outcome) => {
    mocks.resize.mockResolvedValue(
      new File(["photo"], "photo.jpg", { type: "image/jpeg" }),
    );
    mocks.extract.mockResolvedValue(successfulExtraction());
    if (outcome === "rejected")
      mocks.upload.mockRejectedValue(new Error("upload failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = start();
    submitPhoto();
    await screen.findByText(
      "Photo not stored (upload failed). Check the fields.",
    );
    const job = screen.getByRole("textbox", { name: /Job No\./ });
    expect(job).toBeEnabled();
    expect(job).toHaveValue("FO69070073");
    expect(container.querySelector("img")).toHaveAttribute("src", "blob:demo");
    fireEvent.change(job, { target: { value: "FO69070074" } });
    fireEvent.click(screen.getByRole("button", { name: /Save 1/ }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]![0].items[0]).toMatchObject({
      factoryOrder: "FO69070074",
      productBarcodeText: "DEMO-BOX",
    });
    expect(mocks.save.mock.calls[0]![0].items[0]).not.toHaveProperty(
      "imageUrl",
    );
  },
);

it("retains a successful upload when extraction fails and allows manual completion", async () => {
  mocks.resize.mockResolvedValue(
    new File(["photo"], "photo.jpg", { type: "image/jpeg" }),
  );
  mocks.upload.mockResolvedValue([{ ufsUrl: storedPhotoUrl }]);
  mocks.extract.mockRejectedValue(new Error("AI unavailable"));
  const { container } = start();
  submitPhoto();
  await screen.findByText(
    "AI could not read this photo. Fill in the fields by hand.",
  );
  expect(container.querySelector("img")).toHaveAttribute("src", storedPhotoUrl);
  fireEvent.change(screen.getByRole("textbox", { name: /Job No\./ }), {
    target: { value: "FO69070073" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: /Product barcode/ }), {
    target: { value: "DEMO-BOX" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Save 1/ }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0]![0].items[0]).toMatchObject({
    imageUrl: storedPhotoUrl,
    factoryOrder: "FO69070073",
  });
});

it.each(["remove", "unmount"])(
  "releases the ticket preview on %s while upload is still pending",
  async (action) => {
    mocks.resize.mockResolvedValue(
      new File(["photo"], "photo.jpg", { type: "image/jpeg" }),
    );
    let resolveUpload!: (files: { ufsUrl: string }[]) => void;
    mocks.upload.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    mocks.extract.mockResolvedValue(successfulExtraction());
    const { unmount } = start();
    submitPhoto();
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
    if (action === "remove")
      fireEvent.click(screen.getByRole("button", { name: "Remove #1" }));
    else unmount();
    await act(async () => resolveUpload([{ ufsUrl: storedPhotoUrl }]));
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:demo");
    expect(
      screen.queryByRole("textbox", { name: /Job No\./ }),
    ).not.toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  },
);

it("returns to the location question when page Back follows a location choice", async () => {
  start();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Choose demo location" }),
    ).toBeVisible(),
  );
  expect(new URLSearchParams(window.location.search).has("jobScanStep")).toBe(
    false,
  );
});
it("browser Back restores the question with the locale, search and hash intact", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/th/finished-goods/scan?source=keep#question",
  );
  start();
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Choose demo location" }),
    ).toBeVisible(),
  );
  expect(window.location.pathname).toBe("/th/finished-goods/scan");
  expect(window.location.search).toBe("?source=keep");
  expect(window.location.hash).toBe("#question");
});
it("explicit Change consumes the ticket step and the next Back uses the safe parent", async () => {
  start();
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Choose demo location" }),
    ).toBeVisible(),
  );
  mocks.replace.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(mocks.replace).toHaveBeenCalledWith("/finished-goods");
});
it("Forward restores the retained ticket draft after returning to the location question", async () => {
  start();
  addTicket();
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Choose demo location" }),
    ).toBeVisible(),
  );
  act(() => window.history.forward());
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: /Job No/ })).toHaveValue(
      "FO69070073",
    ),
  );
});
it("a refresh or deep link without local data falls back to the location question", () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods/scan?jobScanStep=1&source=keep#question",
  );
  renderWithIntl(<JobScanScreen />, { locale: "en" });
  expect(
    screen.getByRole("button", { name: "Choose demo location" }),
  ).toBeVisible();
  expect(window.location.search).toBe("?source=keep");
  expect(window.location.hash).toBe("#question");
});

it.each([
  ["group", "Scan code"],
  ["field", "Scan Job No."],
])(
  "native Back closes the %s scanner and ignores late acquisition callbacks",
  async (_kind, action) => {
    window.history.replaceState(
      { __NA: true },
      "",
      "/th/finished-goods/scan?source=kept#tickets",
    );
    start();
    addTicket();
    fireEvent.click(screen.getByRole("button", { name: action }));
    const late = mocks.decode!;
    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.queryByText("QA barcode scanner active")).toBeNull(),
    );
    act(() => late("FO99999999"));
    expect(screen.getByRole("textbox", { name: /Job No\./ })).toHaveValue(
      "FO69070073",
    );
    expect(
      screen.getByRole("textbox", { name: /Product barcode/ }),
    ).toHaveValue("DEMO-BOX");
    expect(window.location.pathname).toBe("/th/finished-goods/scan");
    expect(window.location.search).toContain("source=kept");
    expect(window.location.hash).toBe("#tickets");
    expect(mocks.save).not.toHaveBeenCalled();
  },
);
