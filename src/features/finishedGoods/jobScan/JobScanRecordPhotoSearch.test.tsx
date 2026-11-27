import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import type { AppLocale } from "@/i18n/routing";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { JobScanRecordSearch } from "./JobScanRecordSearch";

const mocks = vi.hoisted(() => ({
  change: vi.fn(),
  interpret: vi.fn(),
  read: vi.fn(),
  prepare: vi.fn(),
  cameraFailed: false,
  captures: 0,
}));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: vi.fn() }) }));
vi.mock("../BarcodeCameraBox", () => ({ BarcodeCameraBox: () => null }));
vi.mock("./prepareLocationImage", () => ({
  prepareLocationImage: mocks.prepare,
}));
vi.mock("./StillPhotoCamera", () => ({
  StillPhotoCamera: ({
    onPhoto,
    dock,
    errorAction,
    captureDisabled,
  }: {
    onPhoto: (file: File) => void;
    dock?: (shutter: ReactNode) => ReactNode;
    errorAction?: ReactNode;
    captureDisabled?: boolean;
  }) => (
    <div>
      <button
        disabled={captureDisabled}
        onClick={() =>
          onPhoto(
            new File([`photo-${++mocks.captures}`], "ticket.jpg", {
              type: "image/jpeg",
            }),
          )
        }
      >
        Capture ticket
      </button>
      {mocks.cameraFailed && errorAction}
      {dock?.(<span />)}
    </div>
  ),
}));

const origin = "/th/finished-goods/scan?warehouse=one#camera";
const records = "/en/finished-goods/scan/records?warehouse=one#results";
const here = () =>
  window.location.pathname + window.location.search + window.location.hash;
const both = {
  ok: true,
  candidates: { factoryOrder: "FO-1234", productBarcodeText: "SKU-77" },
} as const;

beforeEach(() => {
  mocks.change.mockReset();
  mocks.interpret.mockReset();
  mocks.read.mockReset();
  mocks.prepare.mockReset();
  mocks.prepare.mockResolvedValue("data:image/jpeg;base64,dGVzdA==");
  mocks.cameraFailed = false;
  mocks.captures = 0;
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:ticket-search");
  vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
  window.history.replaceState({ __NA: true }, "", origin);
  trackAppHistory();
  window.history.pushState({ __NA: true }, "", records);
});

function show({
  canManage = true,
  locale = "en",
}: { canManage?: boolean; locale?: AppLocale } = {}) {
  renderWithIntl(
    <JobScanRecordSearch
      warehouseId="warehouse-a"
      criteria={{ filter: "UNMAPPED", search: "current" }}
      canManage={canManage}
      disabled={false}
      onChange={mocks.change}
      interpret={mocks.interpret}
      readTicketPhoto={mocks.read}
    />,
    { locale, workspace: false },
  );
  return userEvent.setup();
}

async function forward() {
  await act(async () => {
    const visited = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.forward();
    await visited;
  });
}

it("gives managers photo search in the AI slot while viewers keep typed AI search, in English and Thai", () => {
  show();
  expect(
    screen.getByRole("button", { name: "Search by ticket photo" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Scan to search" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "AI search" })).toBeNull();

  show({ canManage: false });
  expect(
    screen.getAllByRole("button", { name: "Scan to search" }),
  ).toHaveLength(2);
  expect(screen.getByRole("button", { name: "AI search" })).toBeVisible();
  expect(
    screen.getAllByRole("button", { name: "Search by ticket photo" }),
  ).toHaveLength(1);

  show({ locale: "th" });
  expect(
    screen.getByRole("button", { name: "ค้นหาจากรูปใบงาน" }),
  ).toBeVisible();
  expect(screen.getAllByRole("button", { name: "สแกนค้นหา" })).toHaveLength(1);
});

it("reads a ticket photo, lets the manager choose and correct a code, and Search consumes the camera before the next Back", async () => {
  mocks.read.mockResolvedValue(both);
  const user = show();
  const trigger = screen.getByRole("button", {
    name: "Search by ticket photo",
  });
  await user.click(trigger);
  const dialog = within(
    screen.getByRole("dialog", { name: "Search by ticket photo" }),
  );
  expect(
    screen.getByRole("dialog", { name: "Search by ticket photo" }),
  ).toHaveAttribute("data-camera-dialog", "true");
  await user.click(dialog.getByRole("button", { name: "Capture ticket" }));
  expect(mocks.prepare).toHaveBeenCalledOnce();
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(
    "data:image/jpeg;base64,dGVzdA==",
  );
  const job = await dialog.findByRole("textbox", { name: "Job No." });
  expect(job).toHaveValue("FO-1234");
  expect(
    dialog.getByRole("heading", { name: "Check the code, then search" }),
  ).toHaveFocus();
  expect(
    dialog.getByRole("img", { name: "Ticket photo to search" }),
  ).toBeVisible();
  const choices = within(dialog.getByRole("group", { name: "Search by" }));
  await user.click(choices.getByRole("button", { name: /SKU-77/ }));
  expect(choices.getByRole("button", { name: /SKU-77/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const barcode = dialog.getByRole("textbox", { name: "Product barcode" });
  await user.clear(barcode);
  await user.type(barcode, " SKU-78 ");
  expect(mocks.change).not.toHaveBeenCalled();
  await user.click(dialog.getByRole("button", { name: "Search" }));
  await waitFor(() =>
    expect(mocks.change).toHaveBeenCalledExactlyOnceWith({
      filter: "ALL",
      search: "SKU-78",
      searchField: "productBarcodeText",
      exactCode: true,
      locationId: undefined,
      facets: undefined,
    }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(here()).toBe(records);
  act(() => window.history.back());
  await waitFor(() => expect(here()).toBe(origin));
});

it("Type instead swaps the photo camera for typed AI search and consumes its entry", async () => {
  const user = show();
  await user.click(
    screen.getByRole("button", { name: "Search by ticket photo" }),
  );
  await user.click(screen.getByRole("button", { name: "Choose photo" }));
  await user.click(screen.getByRole("button", { name: "Type instead" }));
  expect(
    await screen.findByRole("textbox", { name: "Find tickets" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("dialog", { name: "Search by ticket photo" }),
  ).toBeNull();
  act(() => window.history.back());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(here()).toBe(records);
  act(() => window.history.back());
  await waitFor(() => expect(here()).toBe(origin));
});

it.each(["Cancel", "Escape"])(
  "%s retires photo search before Forward and the next Back",
  async (dismissal) => {
    mocks.read.mockResolvedValue(both);
    const user = show();
    const trigger = screen.getByRole("button", {
      name: "Search by ticket photo",
    });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Capture ticket" }));
    await screen.findByRole("textbox", { name: "Job No." });
    if (dismissal === "Escape") await user.keyboard("{Escape}");
    else
      await user.click(
        within(
          screen.getByRole("dialog", { name: "Search by ticket photo" }),
        ).getAllByRole("button", { name: "Cancel" })[0]!,
      );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    await forward();
    await waitFor(() => expect(here()).toBe(records));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.change).not.toHaveBeenCalled();
    act(() => window.history.back());
    await waitFor(() => expect(here()).toBe(origin));
  },
);

it("Stop reading keeps the photo, ignores the late answer and reads again on request", async () => {
  let reply!: (value: unknown) => void;
  mocks.read
    .mockReturnValueOnce(
      new Promise((resolve) => {
        reply = resolve;
      }),
    )
    .mockResolvedValueOnce({ ok: true, candidates: { factoryOrder: "FO-9" } });
  const user = show();
  await user.click(
    screen.getByRole("button", { name: "Search by ticket photo" }),
  );
  await user.click(screen.getByRole("button", { name: "Capture ticket" }));
  const dialog = within(
    screen.getByRole("dialog", { name: "Search by ticket photo" }),
  );
  expect(await dialog.findByRole("status")).toHaveTextContent(
    "Reading ticket…",
  );
  await user.click(dialog.getByRole("button", { name: "Stop reading" }));
  await act(async () => reply(both));
  expect(dialog.queryByRole("textbox")).toBeNull();
  expect(
    dialog.getByRole("img", { name: "Ticket photo to search" }),
  ).toBeVisible();
  await user.click(dialog.getByRole("button", { name: "Read again" }));
  expect(await dialog.findByRole("textbox", { name: "Job No." })).toHaveValue(
    "FO-9",
  );
  expect(dialog.queryByRole("group", { name: "Search by" })).toBeNull();
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(mocks.change).not.toHaveBeenCalled();
});

it("Back during reading ignores the late answer and Forward offers a fresh camera", async () => {
  let reply!: (value: unknown) => void;
  mocks.read.mockReturnValue(
    new Promise((resolve) => {
      reply = resolve;
    }),
  );
  const user = show();
  await user.click(
    screen.getByRole("button", { name: "Search by ticket photo" }),
  );
  await user.click(screen.getByRole("button", { name: "Capture ticket" }));
  await screen.findByRole("status");
  act(() => window.history.back());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await act(async () => reply(both));
  expect(mocks.change).not.toHaveBeenCalled();
  await forward();
  expect(
    await screen.findByRole("button", { name: "Capture ticket" }),
  ).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "Job No." })).toBeNull();
});

it("native Back from a retake returns to the reviewed photo and corrected code, and a replacement is read", async () => {
  mocks.read
    .mockResolvedValueOnce({ ok: true, candidates: { factoryOrder: "FO-1" } })
    .mockResolvedValueOnce({
      ok: true,
      candidates: { productBarcodeText: "SKU-2" },
    });
  const user = show();
  await user.click(
    screen.getByRole("button", { name: "Search by ticket photo" }),
  );
  await user.click(screen.getByRole("button", { name: "Capture ticket" }));
  const job = await screen.findByRole("textbox", { name: "Job No." });
  await user.type(job, "0");
  const retake = screen.getByRole("button", { name: "Retake photo" });
  await user.click(retake);
  expect(screen.getByRole("dialog", { name: "Retake photo" })).toHaveAttribute(
    "data-camera-dialog",
    "true",
  );
  act(() => window.history.back());
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Retake photo" })).toBeNull(),
  );
  expect(screen.getByRole("textbox", { name: "Job No." })).toHaveValue("FO-10");
  await waitFor(() => expect(retake).toHaveFocus());
  expect(mocks.read).toHaveBeenCalledOnce();

  await user.click(retake);
  await user.click(
    within(screen.getByRole("dialog", { name: "Retake photo" })).getByRole(
      "button",
      { name: "Capture ticket" },
    ),
  );
  expect(
    await screen.findByRole("textbox", { name: "Product barcode" }),
  ).toHaveValue("SKU-2");
  expect(screen.queryByRole("dialog", { name: "Retake photo" })).toBeNull();
  // The consumed retake leaves one Back for the photo search itself.
  act(() => window.history.back());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(here()).toBe(records);
  expect(mocks.change).not.toHaveBeenCalled();
});

it.each(["Back to photo", "Escape"])(
  "%s retires retake without losing the reviewed code",
  async (dismissal) => {
    mocks.read.mockResolvedValue(both);
    const user = show();
    await user.click(
      screen.getByRole("button", { name: "Search by ticket photo" }),
    );
    await user.click(screen.getByRole("button", { name: "Capture ticket" }));
    await user.type(
      await screen.findByRole("textbox", { name: "Job No." }),
      "5",
    );
    const retake = screen.getByRole("button", { name: "Retake photo" });
    await user.click(retake);
    if (dismissal === "Escape") await user.keyboard("{Escape}");
    else
      await user.click(screen.getByRole("button", { name: "Back to photo" }));
    await waitFor(() => expect(retake).toHaveFocus());
    await forward();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Retake photo" })).toBeNull(),
    );
    expect(screen.getByRole("textbox", { name: "Job No." })).toHaveValue(
      "FO-12345",
    );
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(here()).toBe(records);
    expect(mocks.read).toHaveBeenCalledOnce();
  },
);

it.each([
  [
    "rate limit",
    { ok: false, error: { code: "RATE_LIMITED" }, retryAfterMs: 60_000 },
    "Too many AI photo requests",
  ],
  [
    "no identifier",
    { ok: true, candidates: {} },
    "No job number or product barcode",
  ],
  [
    "unreadable",
    { ok: false, error: { code: "AI_UNREADABLE" } },
    "No job number or product barcode",
  ],
  [
    "service failure",
    { ok: false, error: { code: "AI_DENIED" } },
    "AI could not complete",
  ],
])(
  "keeps the photo with recovery actions after a %s answer",
  async (_case, result, message) => {
    mocks.read.mockResolvedValue(result);
    const user = show();
    await user.click(
      screen.getByRole("button", { name: "Search by ticket photo" }),
    );
    await user.click(screen.getByRole("button", { name: "Capture ticket" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    for (const name of ["Read again", "Retake photo", "Type instead"])
      expect(screen.getByRole("button", { name })).toBeEnabled();
    expect(mocks.change).not.toHaveBeenCalled();
  },
);

it("reports an unreadable photo when image decoding fails before the AI call", async () => {
  mocks.prepare.mockRejectedValue(
    new DOMException("Decode failed", "InvalidStateError"),
  );
  const user = show();
  await user.click(
    screen.getByRole("button", { name: "Search by ticket photo" }),
  );
  await user.click(screen.getByRole("button", { name: "Capture ticket" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This image could not be opened",
  );
  expect(mocks.read).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Retake photo" })).toBeEnabled();
});

it("rejects an unsupported gallery file and offers the device camera when the in-app camera fails", async () => {
  mocks.cameraFailed = true;
  mocks.read.mockResolvedValue(both);
  const user = userEvent.setup({ applyAccept: false });
  renderWithIntl(
    <JobScanRecordSearch
      warehouseId="warehouse-a"
      criteria={{ filter: "ALL", search: "" }}
      canManage
      disabled={false}
      onChange={mocks.change}
      interpret={mocks.interpret}
      readTicketPhoto={mocks.read}
    />,
    { locale: "en", workspace: false },
  );
  await user.click(
    screen.getByRole("button", { name: "Search by ticket photo" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Search by ticket photo" });
  expect(
    within(dialog).getByRole("button", { name: "Use device camera" }),
  ).toBeVisible();
  const gallery = dialog.querySelector<HTMLInputElement>(
    "input[type=file]:not([capture])",
  )!;
  await user.upload(
    gallery,
    new File(["x"], "ticket.gif", { type: "image/gif" }),
  );
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "Choose a JPEG, PNG, or WebP image.",
  );
  expect(mocks.read).not.toHaveBeenCalled();
  const device = dialog.querySelector<HTMLInputElement>(
    "input[type=file][capture]",
  )!;
  await user.upload(
    device,
    new File(["y"], "ticket.jpg", { type: "image/jpeg" }),
  );
  expect(
    await within(dialog).findByRole("textbox", { name: "Job No." }),
  ).toHaveValue("FO-1234");
  expect(within(dialog).queryByRole("alert")).toBeNull();
});
