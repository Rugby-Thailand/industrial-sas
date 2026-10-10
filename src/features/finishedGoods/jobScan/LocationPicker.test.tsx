import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { querySuccess } from "@tests/fixtures/finished-goods-ui";
import { LocationPicker } from "./LocationPicker";

vi.mock("@/i18n/navigation", () => ({
  Link: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  canCreate: false,
  decode: undefined as ((code: string) => void) | undefined,
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.query }),
  useQuery: () =>
    querySuccess({
      items: [{ zoneId: "zone-b", code: "ZONE-B", name: "Zone B" }],
      page: 1,
      pages: 1,
      total: 1,
      status: "ready",
      isDone: true,
      canCreate: mocks.canCreate,
    }),
}));
vi.mock("../BarcodeCameraBox", () => ({
  BarcodeCameraBox: ({
    onCode,
    onClose,
  }: {
    onCode: (code: string) => void;
    onClose: () => void;
  }) => {
    mocks.decode = onCode;
    return <button onClick={onClose}>Stop preview</button>;
  },
}));
beforeEach(() => {
  mocks.query.mockReset();
  mocks.canCreate = false;
});
function start(allowUnmapped = true) {
  const onPick = vi.fn();
  const view = renderWithIntl(
    <LocationPicker
      warehouseId="warehouse-a"
      onPick={onPick}
      allowUnmapped={allowUnmapped}
    />,
    { locale: "en", preserveProviders: true },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Scan location barcode or QR" }),
  );
  return { onPick, ...view };
}
function location(code = "ZONE-A") {
  return querySuccess({
    ok: true,
    location: { zoneId: "zone-a", code, name: "Zone A" },
  });
}
it("accepts one resolved location, suppressing repeated frames before lookup completes", async () => {
  mocks.query.mockResolvedValue(location());
  const { onPick } = start();
  const decode = mocks.decode!;
  await act(async () => {
    decode("ZONE-A");
    decode("ZONE-A");
  });
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(onPick).toHaveBeenCalledTimes(1);
  expect(onPick).toHaveBeenCalledWith({
    text: "ZONE-A",
    zoneId: "zone-a",
    code: "ZONE-A",
    name: "Zone A",
  });
});
it("ignores a pending lookup when the user types a replacement", async () => {
  let finish!: (value: ReturnType<typeof location>) => void;
  mocks.query.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { onPick } = start();
  act(() => mocks.decode!("ZONE-A"));
  fireEvent.change(screen.getByRole("textbox", { name: "Search location" }), {
    target: { value: "Dock" },
  });
  await act(async () => finish(location()));
  expect(onPick).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Search location" })).toHaveValue(
    "Dock",
  );
});
it("keeps a manually chosen location when an earlier lookup arrives", async () => {
  let finish!: (value: ReturnType<typeof location>) => void;
  mocks.query.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { onPick } = start();
  act(() => mocks.decode!("ZONE-A"));
  fireEvent.click(screen.getByRole("button", { name: /ZONE-B/ }));
  await act(async () => finish(location()));
  expect(onPick).toHaveBeenCalledTimes(1);
  expect(onPick.mock.calls[0]![0].code).toBe("ZONE-B");
});
it("reports network failures and retains typing and scan retry", async () => {
  mocks.query.mockRejectedValue(new Error("NETWORK_ERROR"));
  const { onPick } = start();
  act(() => mocks.decode!("ZONE-A"));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Could not check the location",
    ),
  );
  expect(
    screen.getByRole("textbox", { name: "Search location" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Scan location barcode or QR" }),
  ).toBeEnabled();
  expect(onPick).not.toHaveBeenCalled();
});
it("reports rejected identities when a real mapped location is required", async () => {
  mocks.query.mockResolvedValue(
    querySuccess({ ok: false, error: { code: "LOCATION_UNAVAILABLE" } }),
  );
  const { onPick } = start(false);
  act(() => mocks.decode!("OTHER-WAREHOUSE"));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "not a known location",
    ),
  );
  expect(onPick).not.toHaveBeenCalled();
});
it("offers missing labels for inline registration or saving for later", async () => {
  mocks.canCreate = true;
  mocks.query.mockResolvedValue(
    querySuccess({ ok: false, error: { code: "LOCATION_NOT_FOUND" } }),
  );
  const { onPick } = start();
  act(() => mocks.decode!("DOCK-NEW"));
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "Search location" }),
    ).toHaveValue("DOCK-NEW"),
  );
  expect(onPick).not.toHaveBeenCalled();
  fireEvent.click(
    await screen.findByRole("button", { name: /Save now, set location later/ }),
  );
  expect(onPick).toHaveBeenCalledWith({ text: "DOCK-NEW" });
});
it("discards lookup and decoder callbacks after unmount", async () => {
  let finish!: (value: ReturnType<typeof location>) => void;
  mocks.query.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { onPick, unmount } = start();
  const late = mocks.decode!;
  act(() => late("ZONE-A"));
  unmount();
  await act(async () => {
    finish(location());
    late("ZONE-B");
  });
  expect(onPick).not.toHaveBeenCalled();
  expect(mocks.query).toHaveBeenCalledTimes(1);
});

it("never offers denied lookups as unmapped locations", async () => {
  mocks.query.mockResolvedValue({
    ok: false,
    requestId: "denied",
    denial: { kind: "AUTHORIZATION_DENIED" },
  });
  const { onPick } = start();
  act(() => mocks.decode!("SECRET-ZONE"));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Cannot access locations",
    ),
  );
  expect(screen.getByRole("textbox", { name: "Search location" })).toHaveValue(
    "",
  );
  expect(
    screen.queryByRole("button", { name: /Save now, set location later/ }),
  ).not.toBeInTheDocument();
  expect(onPick).not.toHaveBeenCalled();
});
it.each(["WRONG_ENTITY_TYPE", "AMBIGUOUS_IDENTITY", "INVALID_IDENTITY"])(
  "never turns %s into an unmapped fallback",
  async (code) => {
    mocks.query.mockResolvedValue(querySuccess({ ok: false, error: { code } }));
    const { onPick } = start();
    act(() => mocks.decode!("LABEL"));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "not a known location",
      ),
    );
    expect(
      screen.getByRole("textbox", { name: "Search location" }),
    ).toHaveValue("");
    expect(onPick).not.toHaveBeenCalled();
  },
);
