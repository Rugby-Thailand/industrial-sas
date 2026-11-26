import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { JobScanRecordSearch } from "./JobScanRecordSearch";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  change: vi.fn(),
  interpret: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.resolve }),
}));
vi.mock("../BarcodeCameraBox", () => ({
  BarcodeCameraBox: ({
    onCode,
    disabled,
  }: {
    onCode: (code: string) => void;
    disabled?: boolean;
  }) => (
    <>
      <button disabled={disabled} onClick={() => onCode("FO12345")}>
        Read job code
      </button>
      <button
        disabled={disabled}
        onClick={() => onCode("ISAS:LOCATION:1:zone")}
      >
        Read location QR
      </button>
      <button disabled={disabled} onClick={() => onCode("ISAS:PALLET:1:unit")}>
        Read unrelated QR
      </button>
      <button disabled={disabled} onClick={() => onCode("legacy-location-qr")}>
        Read legacy location QR
      </button>
    </>
  ),
}));

const origin = "/th/finished-goods/scan?warehouse=one#camera";
const records = "/en/finished-goods/scan/records?warehouse=one#results";
beforeEach(() => {
  mocks.resolve.mockReset();
  mocks.resolve.mockResolvedValue({
    ok: true,
    value: { ok: false, error: { code: "LOCATION_NOT_FOUND" } },
  });
  mocks.change.mockReset();
  mocks.interpret.mockReset();
  window.history.replaceState({ __NA: true }, "", origin);
  trackAppHistory();
  window.history.pushState({ __NA: true }, "", records);
});

function show() {
  renderWithIntl(
    <JobScanRecordSearch
      warehouseId="warehouse-a"
      criteria={{ filter: "UNMAPPED", search: "current" }}
      disabled={false}
      onChange={mocks.change}
      interpret={mocks.interpret}
    />,
    { locale: "en", workspace: false },
  );
  return userEvent.setup();
}

it("uses the scanned job code as an exact search and consumes the camera before the next Back", async () => {
  const user = show();
  await user.click(screen.getByRole("button", { name: "Scan to search" }));
  await user.click(screen.getByRole("button", { name: "Read job code" }));
  await waitFor(() =>
    expect(mocks.change).toHaveBeenCalledWith({
      filter: "ALL",
      search: "FO12345",
      exactCode: true,
      locationId: undefined,
      facets: undefined,
    }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(window.location.hash).toBe("#results");
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe(origin),
  );
});

it("reports unsupported QR labels, checks a warehouse location and ignores an answer after Back", async () => {
  let answer!: (value: unknown) => void;
  mocks.resolve.mockReturnValue(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  const user = show();
  await user.click(screen.getByRole("button", { name: "Scan to search" }));
  await user.click(screen.getByRole("button", { name: "Read unrelated QR" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "This code could not be used",
  );
  await user.click(screen.getByRole("button", { name: "Read location QR" }));
  expect(screen.getByRole("status")).toHaveTextContent(/checking/i);
  expect(mocks.resolve).toHaveBeenCalledWith(expect.anything(), {
    warehouseId: "warehouse-a",
    code: "ISAS:LOCATION:1:zone",
    qrOnly: true,
  });
  act(() => window.history.back());
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await act(async () =>
    answer({
      ok: true,
      value: { ok: true, location: { code: "ZONE-A", locationId: "zonea" } },
    }),
  );
  expect(mocks.change).not.toHaveBeenCalled();
  expect(
    window.location.pathname + window.location.search + window.location.hash,
  ).toBe(records);
});

it.each(["Read location QR", "Read legacy location QR"])(
  "uses the storage identity when scanning a warehouse QR with %s",
  async (button) => {
    mocks.resolve.mockResolvedValue({
      ok: true,
      value: { ok: true, location: { code: "ZONE-A", locationId: "zonea" } },
    });
    const user = show();
    await user.click(screen.getByRole("button", { name: "Scan to search" }));
    await user.click(screen.getByRole("button", { name: button }));
    await waitFor(() =>
      expect(mocks.change).toHaveBeenCalledExactlyOnceWith({
        filter: "ALL",
        search: "ZONE-A",
        exactCode: undefined,
        locationId: "zonea",
        facets: undefined,
      }),
    );
  },
);

it("Cancel consumes the record search camera entry before the next Back", async () => {
  const user = show();
  const trigger = screen.getByRole("button", { name: "Scan to search" });
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(mocks.change).not.toHaveBeenCalled();
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe(origin),
  );
});

it("applies validated AI facets after the search popup closes and keeps manual search usable on failure", async () => {
  mocks.interpret.mockResolvedValueOnce(null).mockResolvedValueOnce({
    filter: "MAPPED",
    search: "",
    facets: { floor: 2, storageFormat: "PALLET" },
  });
  const user = show();
  await user.click(screen.getByRole("button", { name: "AI search" }));
  const dialog = within(screen.getByRole("dialog", { name: "AI search" }));
  await user.type(
    dialog.getByRole("textbox", { name: "Find tickets" }),
    "pallets on floor 2",
  );
  await user.click(dialog.getByRole("button", { name: "Search tickets" }));
  expect(await dialog.findByRole("alert")).toHaveTextContent(
    "AI could not complete",
  );
  expect(mocks.change).not.toHaveBeenCalled();
  await user.click(dialog.getByRole("button", { name: "Search tickets" }));
  await waitFor(() =>
    expect(mocks.change).toHaveBeenCalledWith({
      filter: "MAPPED",
      search: "",
      facets: { floor: 2, storageFormat: "PALLET" },
      exactCode: undefined,
      locationId: undefined,
    }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("Back during AI search ignores the late response and Forward offers a fresh search", async () => {
  let reply!: (value: unknown) => void;
  mocks.interpret.mockReturnValue(
    new Promise((resolve) => {
      reply = resolve;
    }),
  );
  const user = show();
  await user.click(screen.getByRole("button", { name: "AI search" }));
  await user.type(
    screen.getByRole("textbox", { name: "Find tickets" }),
    "Pallets on floor 2",
  );
  await user.click(screen.getByRole("button", { name: "Search tickets" }));
  act(() => window.history.back());
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await act(async () =>
    reply({ filter: "MAPPED", search: "", facets: { floor: 2 } }),
  );
  expect(mocks.change).not.toHaveBeenCalled();
  act(() => window.history.forward());
  expect(
    await screen.findByRole("textbox", { name: "Find tickets" }),
  ).toHaveValue("");
  expect(screen.getByRole("textbox", { name: "Find tickets" })).toBeEnabled();
});
