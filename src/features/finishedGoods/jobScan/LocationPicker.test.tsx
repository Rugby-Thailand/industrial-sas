import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { querySuccess } from "@tests/fixtures/finished-goods-ui";
import { LocationPicker } from "./LocationPicker";

vi.mock("@/i18n/navigation", () => ({
  Link: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
type Args = Record<string, unknown>;
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  search: vi.fn(),
  exact: vi.fn(),
  buildings: vi.fn(),
  decode: undefined as ((code: string) => void) | undefined,
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.query }),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(ref);
    if (name.endsWith(":resolve")) return mocks.exact(args);
    if (name.endsWith(":buildingOptions")) return mocks.buildings(args);
    return mocks.search(args);
  },
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

const zone = (code: string, extra: Args = {}) => ({
  locationId: `loc-${code}`,
  zoneId: `zone-${code}`,
  buildingId: "building-a",
  buildingName: "Building A",
  code,
  name: `Name ${code}`,
  ...extra,
});
const page = (
  items: ReturnType<typeof zone>[],
  extra: Partial<{
    status: string;
    isDone: boolean;
    continueCursor: string;
    scanCursor: string;
    buildingUnavailable: boolean;
  }> = {},
) =>
  querySuccess({
    status: "ready",
    isDone: true,
    continueCursor: "",
    ...extra,
    items,
    page: items.map((location) => ({ _id: location.locationId, location })),
  });
const notFound = querySuccess({
  ok: false,
  error: { code: "LOCATION_NOT_FOUND" },
});

beforeEach(() => {
  mocks.query.mockReset();
  mocks.search.mockReset().mockReturnValue(page([zone("ZONE-B")]));
  mocks.exact.mockReset();
  mocks.buildings.mockReset().mockReturnValue(
    querySuccess({
      status: "ready",
      isDone: true,
      continueCursor: "",
      page: [
        { buildingId: "building-a", code: "BLDG-A", name: "อาคารเหนือ" },
        { buildingId: "building-b", code: "BLDG-B", name: "South" },
      ],
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
});
let refresh = () => {};
function render(
  options: { allowUnmapped?: boolean; locale?: "en" | "th" } = {},
) {
  const onPick = vi.fn();
  const element = () => (
    <LocationPicker
      warehouseId="warehouse-a"
      onPick={onPick}
      allowUnmapped={options.allowUnmapped ?? true}
    />
  );
  const view = renderWithIntl(element(), {
    locale: options.locale ?? "en",
    preserveProviders: true,
  });
  // Re-render with new query answers, as a Convex subscription update would.
  refresh = () => view.rerender(element());
  return { onPick, ...view };
}
const openFilter = () => {
  fireEvent.click(screen.getByRole("button", { name: "Filter by building" }));
  return screen.getByRole("group", { name: "Filter by building" });
};
function start(allowUnmapped = true) {
  const view = render({ allowUnmapped });
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
  return view;
}
const search = () => screen.getByRole("textbox", { name: "Search location" });
const results = () => screen.getByRole("list", { name: "Location results" });
const searchStatus = () => screen.getByTestId("location-search-status");
const lastSearch = () => mocks.search.mock.calls.at(-1)?.[0] as Args;
async function type(value: string) {
  fireEvent.change(search(), { target: { value } });
  await act(async () => vi.advanceTimersByTime(250));
}
function location(code = "ZONE-A") {
  return querySuccess({
    ok: true,
    location: { zoneId: "zone-a", code, name: "Zone A" },
  });
}

it("browses the first page without typing, in every picker", () => {
  render();
  expect(search()).toHaveAttribute("placeholder", "Location code or name");
  expect(lastSearch()).toEqual({
    warehouseId: "warehouse-a",
    text: "",
    pageSize: 20,
  });
  expect(
    within(results()).getByRole("button", { name: /ZONE-B/ }),
  ).toBeEnabled();
  // The shared pager is visible once a page is ready, even with one page.
  expect(screen.getByRole("navigation", { name: "Pagination" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  expect(mocks.exact).not.toHaveBeenCalled();
});

it("shows a persistent loading state while the first page is pending, keeping the input usable", () => {
  mocks.search.mockReturnValue(undefined);
  render();
  expect(searchStatus()).toHaveTextContent("Loading locations…");
  expect(results()).toHaveAttribute("aria-busy", "true");
  expect(screen.queryByText("No matching location.")).not.toBeInTheDocument();
  expect(search()).toBeEnabled();
  fireEvent.change(search(), { target: { value: "F1" } });
  expect(searchStatus()).toHaveTextContent("Searching locations…");
});

it("explains an empty warehouse only after the browse page is ready", () => {
  mocks.search.mockReturnValue(page([]));
  render();
  expect(
    screen.getByText("No locations are available in this warehouse yet."),
  ).toBeVisible();
});

it("offers the exact code immediately while the broader search continues, without selecting it", async () => {
  vi.useFakeTimers();
  try {
    const exact = zone("F1-L30-16");
    // The continuation step is still pending (Convex answers undefined).
    mocks.search.mockImplementation((args: Args) =>
      args.scanCursor
        ? undefined
        : args.text
          ? page([], { status: "scanning", scanCursor: "step" })
          : page([zone("ZONE-B")]),
    );
    mocks.exact.mockReturnValue(querySuccess({ ok: true, location: exact }));
    const { onPick } = render();
    await type("F1-L30-16");
    expect(mocks.exact).toHaveBeenLastCalledWith({
      warehouseId: "warehouse-a",
      code: "F1-L30-16",
    });
    const row = within(results()).getByRole("button", { name: /F1-L30-16/ });
    expect(row).toHaveTextContent("Exact code");
    expect(searchStatus()).toHaveTextContent(
      "Showing matches found so far. Still searching other locations…",
    );
    expect(onPick).not.toHaveBeenCalled();
    // When the list catches up, the same location is listed once.
    mocks.search.mockReturnValue(page([exact, zone("F1-L30-160")]));
    refresh();
    expect(within(results()).getAllByText("F1-L30-16")).toHaveLength(1);
    expect(within(results()).getByText("F1-L30-160")).toBeVisible();
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ code: "F1-L30-16", text: "F1-L30-16" }),
    );
  } finally {
    vi.useRealTimers();
  }
});

it("hides an exact answer as soon as the text changes", async () => {
  vi.useFakeTimers();
  try {
    mocks.exact.mockImplementation((args: Args) =>
      args.code === "ZONE-A"
        ? querySuccess({ ok: true, location: zone("ZONE-A") })
        : undefined,
    );
    render();
    await type("ZONE-A");
    expect(screen.getByText("Exact code")).toBeVisible();
    fireEvent.change(search(), { target: { value: "ZONE-AB" } });
    expect(screen.queryByText("Exact code")).not.toBeInTheDocument();
    // Previous rows remain only as disabled, pending context.
    expect(
      within(results()).getByRole("button", { name: /ZONE-B/ }),
    ).toBeDisabled();
    await act(async () => vi.advanceTimersByTime(250));
    expect(mocks.exact).toHaveBeenLastCalledWith({
      warehouseId: "warehouse-a",
      code: "ZONE-AB",
    });
    expect(screen.queryByText("Exact code")).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it("keeps prefix matches visible and does not call a typed prefix unregistered until the search finishes", async () => {
  vi.useFakeTimers();
  try {
    mocks.exact.mockReturnValue(notFound);
    mocks.search.mockReturnValue(
      page([zone("F1-L30-16")], { status: "scanning", scanCursor: "s1" }),
    );
    const { onPick } = render();
    await type("F1-L30");
    expect(
      within(results()).getByRole("button", { name: /F1-L30-16/ }),
    ).toBeEnabled();
    expect(searchStatus()).toHaveTextContent("Still searching");
    expect(lastSearch()).toMatchObject({ scanCursor: "s1" });
    expect(screen.queryByText(/not registered yet/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add location" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Save now, set location later/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("No matching location.")).not.toBeInTheDocument();
    mocks.search.mockReturnValue(page([zone("F1-L30-16")]));
    refresh();
    expect(screen.getByText("“F1-L30” is not registered yet.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Add location" })).toBeVisible();
    // The registration offer follows the results; it is not promoted above them.
    expect(
      results().compareDocumentPosition(
        screen.getByText(/not registered yet/),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /Save now, set location later/ }),
    );
    expect(onPick).toHaveBeenCalledWith({ text: "F1-L30" });
  } finally {
    vi.useRealTimers();
  }
});

it("reports no match only after a completed search", async () => {
  vi.useFakeTimers();
  try {
    mocks.exact.mockReturnValue(
      querySuccess({ ok: false, error: { code: "AMBIGUOUS_IDENTITY" } }),
    );
    mocks.search.mockReturnValue(
      page([], { status: "scanning", scanCursor: "s" }),
    );
    render();
    await type("ไม่มี");
    expect(screen.queryByText("No matching location.")).not.toBeInTheDocument();
    mocks.search.mockReturnValue(page([]));
    refresh();
    expect(screen.getByText("No matching location.")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Add location" }),
    ).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it("filters on the server by building, keeps the text, and clears", async () => {
  vi.useFakeTimers();
  try {
    render();
    await type("F1");
    expect(
      screen.getByRole("button", { name: "Filter by building" }),
    ).toHaveAttribute("aria-pressed", "false");
    const options = openFilter();
    expect(
      within(options).getByRole("button", { name: "All buildings" }),
    ).toHaveAttribute("aria-pressed", "true");
    // Options come from their own query, not from the location page.
    expect(mocks.buildings).toHaveBeenCalledWith({
      warehouseId: "warehouse-a",
    });
    fireEvent.click(within(options).getByRole("button", { name: /BLDG-B/ }));
    expect(lastSearch()).toEqual({
      warehouseId: "warehouse-a",
      text: "F1",
      buildingId: "building-b",
      pageSize: 20,
    });
    expect(search()).toHaveValue("F1");
    expect(screen.getByText("Building: BLDG-B · South")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Filter by building" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(mocks.exact).toHaveBeenLastCalledWith({
      warehouseId: "warehouse-a",
      code: "F1",
      buildingId: "building-b",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Clear building filter" }),
    );
    expect(lastSearch()).toEqual({
      warehouseId: "warehouse-a",
      text: "F1",
      pageSize: 20,
    });
  } finally {
    vi.useRealTimers();
  }
});

it("says honestly when an exact code is outside the building filter", async () => {
  vi.useFakeTimers();
  try {
    mocks.exact.mockImplementation((args: Args) =>
      args.buildingId
        ? querySuccess({
            ok: false,
            error: { code: "OUTSIDE_BUILDING_FILTER" },
            location: zone("F1-L30-16"),
          })
        : querySuccess({ ok: true, location: zone("F1-L30-16") }),
    );
    mocks.search.mockImplementation((args: Args) =>
      args.buildingId ? page([]) : page([zone("ZONE-B")]),
    );
    const { onPick } = render();
    fireEvent.click(
      within(openFilter()).getByRole("button", { name: /BLDG-B/ }),
    );
    await type("F1-L30-16");
    expect(
      screen.getByText(
        "“F1-L30-16” is in Building A, outside the building filter.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("Exact code")).not.toBeInTheDocument();
    expect(screen.getByText("No matching location.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show all buildings" }));
    expect(screen.getByText("Exact code")).toBeVisible();
    expect(onPick).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("does not silently override the filter for a scanned label in another building", async () => {
  mocks.query.mockResolvedValue(
    querySuccess({
      ok: false,
      error: { code: "OUTSIDE_BUILDING_FILTER" },
      location: zone("ZONE-A"),
    }),
  );
  const { onPick } = render();
  fireEvent.click(within(openFilter()).getByRole("button", { name: /BLDG-B/ }));
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
  await act(async () => mocks.decode!("ZONE-A"));
  expect(mocks.query).toHaveBeenCalledWith(expect.anything(), {
    warehouseId: "warehouse-a",
    code: "ZONE-A",
    buildingId: "building-b",
  });
  expect(onPick).not.toHaveBeenCalled();
  expect(
    await screen.findByText(
      "“ZONE-A” is in Building A, outside the building filter.",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Show all buildings" }));
  expect(search()).toHaveValue("ZONE-A");
  expect(screen.queryByText(/Building: /)).not.toBeInTheDocument();
});

it("pages with the shared pager and keeps the previous page disabled while the next loads", () => {
  mocks.search.mockImplementation((args: Args) =>
    args.cursor
      ? undefined
      : page([zone("ZONE-B")], { isDone: false, continueCursor: "next-1" }),
  );
  render();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(lastSearch()).toMatchObject({ cursor: "next-1" });
  expect(
    within(results()).getByRole("button", { name: /ZONE-B/ }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  expect(screen.getByText(/Page 2/)).toBeVisible();
});

it("shows a recoverable failure when the list query fails", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  let fail = true;
  mocks.search.mockImplementation(() => {
    if (fail) throw new Error("NETWORK");
    return page([zone("ZONE-B")]);
  });
  render();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Locations could not be loaded.",
  );
  expect(search()).toBeEnabled();
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByRole("button", { name: /ZONE-B/ })).toBeVisible();
});

it("reports denied list access", () => {
  mocks.search.mockReturnValue({
    ok: false,
    requestId: "denied",
    denial: { kind: "AUTHORIZATION_DENIED" },
  });
  render();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Cannot access locations",
  );
});

it("labels the building filter and states in Thai", () => {
  render({ locale: "th" });
  expect(screen.getByRole("button", { name: "กรองตามอาคาร" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "ค้นหาตำแหน่ง" })).toBeEnabled();
});

it("accepts one resolved location, suppressing repeated frames before lookup completes", async () => {
  mocks.query.mockResolvedValue(location());
  const { onPick } = start();
  const decode = mocks.decode!;
  await act(async () => {
    decode("ZONE-A");
    decode("ZONE-A");
  });
  expect(mocks.query).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
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
  fireEvent.change(search(), { target: { value: "Dock" } });
  await act(async () => finish(location()));
  expect(onPick).not.toHaveBeenCalled();
  expect(search()).toHaveValue("Dock");
});
it("ignores a pending scan when the building filter changes", async () => {
  let finish!: (value: ReturnType<typeof location>) => void;
  mocks.query.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { onPick } = start();
  act(() => mocks.decode!("ZONE-A"));
  fireEvent.click(within(openFilter()).getByRole("button", { name: /BLDG-B/ }));
  await act(async () => finish(location()));
  expect(onPick).not.toHaveBeenCalled();
});
it("keeps a manually chosen location when an earlier lookup arrives", async () => {
  let finish!: (value: ReturnType<typeof location>) => void;
  mocks.query.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { onPick } = render();
  const choice = screen.getByRole("button", { name: /ZONE-B/ });
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
  act(() => mocks.decode!("ZONE-A"));
  fireEvent.click(choice);
  await act(async () => finish(location()));
  await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
  expect(onPick.mock.calls[0]![0].code).toBe("ZONE-B");
});
it("reports network failures and retains typing and scan retry", async () => {
  mocks.query.mockRejectedValue(new Error("NETWORK_ERROR"));
  const { onPick } = start();
  act(() => mocks.decode!("ZONE-A"));
  expect(
    await screen.findByText(
      "Could not check the location. Retry scanning or search by code.",
    ),
  ).toBeVisible();
  expect(search()).toBeEnabled();
  expect(screen.getByRole("button", { name: "Scan code" })).toBeEnabled();
  expect(onPick).not.toHaveBeenCalled();
});
it("reports rejected identities when a real mapped location is required", async () => {
  mocks.query.mockResolvedValue(
    querySuccess({ ok: false, error: { code: "LOCATION_UNAVAILABLE" } }),
  );
  const { onPick } = start(false);
  act(() => mocks.decode!("OTHER-WAREHOUSE"));
  expect(await screen.findByText(/not a known location/)).toBeVisible();
  expect(onPick).not.toHaveBeenCalled();
});
it("offers a scan-confirmed missing label for registration immediately, before search settles", async () => {
  vi.useFakeTimers();
  try {
    mocks.query.mockResolvedValue(notFound);
    mocks.search.mockReturnValue(undefined);
    const { onPick } = start();
    await act(async () => mocks.decode!("FO69100125"));
    // Flush native owned-entry traversal, still before the 250 ms search debounce.
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(search()).toHaveValue("FO69100125");
    expect(screen.getByRole("button", { name: "Add location" })).toBeVisible();
    expect(
      screen.getAllByText("“FO69100125” is not registered yet."),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: /Save now, set location later/ }),
    );
    expect(onPick).toHaveBeenCalledWith({ text: "FO69100125" });
    fireEvent.change(search(), { target: { value: "OTHER-CODE" } });
    expect(
      screen.queryByRole("button", { name: "Add location" }),
    ).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
it.each([
  "LOCATION_UNAVAILABLE",
  "WRONG_ENTITY_TYPE",
  "AMBIGUOUS_IDENTITY",
  "INVALID_IDENTITY",
  "DENIED",
])(
  "does not offer registration when typed exact lookup returns %s",
  async (code) => {
    vi.useFakeTimers();
    try {
      mocks.search.mockReturnValue(page([]));
      mocks.exact.mockReturnValue(
        code === "DENIED"
          ? { ok: false, denial: { kind: "AUTHORIZATION_DENIED" } }
          : querySuccess({ ok: false, error: { code } }),
      );
      render();
      await type("LABEL");
      expect(screen.getByText("No matching location.")).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Add location" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Save now, set location later/ }),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  },
);
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
  expect(await screen.findByText(/Cannot access locations/)).toBeVisible();
  expect(search()).toHaveValue("");
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
    expect(await screen.findByText(/not a known location/)).toBeVisible();
    expect(search()).toHaveValue("");
    expect(onPick).not.toHaveBeenCalled();
  },
);

it("does not offer a typed exact miss for registration while a ready page says more matches remain", async () => {
  vi.useFakeTimers();
  try {
    mocks.exact.mockReturnValue(notFound);
    // A full, ready page whose search is not exhausted.
    mocks.search.mockReturnValue(
      page([zone("F1-L30-16")], { isDone: false, continueCursor: "next" }),
    );
    const { onPick } = render({ allowUnmapped: true });
    await type("F1-L30");
    expect(
      within(results()).getByRole("button", { name: /F1-L30-16/ }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Add location" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Save now, set location later/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/not registered yet/)).not.toBeInTheDocument();
    expect(screen.queryByText("No matching location.")).not.toBeInTheDocument();
    // Once the search is exhausted the typed code may be registered.
    mocks.search.mockReturnValue(page([zone("F1-L30-16")]));
    refresh();
    expect(screen.getByRole("button", { name: "Add location" })).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: /Save now, set location later/ }),
    );
    expect(onPick).toHaveBeenCalledWith({ text: "F1-L30" });
  } finally {
    vi.useRealTimers();
  }
});

it("removes previously ready choices when the same query is later denied", () => {
  const { onPick } = render();
  expect(screen.getByRole("button", { name: /ZONE-B/ })).toBeEnabled();
  mocks.search.mockReturnValue({
    ok: false,
    requestId: "denied",
    denial: { kind: "AUTHORIZATION_DENIED" },
  });
  refresh();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Cannot access locations",
  );
  expect(
    screen.queryByRole("button", { name: /ZONE-B/ }),
  ).not.toBeInTheDocument();
  expect(results()).not.toHaveAttribute("aria-busy");
  expect(
    screen.queryByRole("navigation", { name: "Pagination" }),
  ).not.toBeInTheDocument();
  // Access restored: only the new authorized answer is shown.
  mocks.search.mockReturnValue(page([zone("ZONE-C")]));
  refresh();
  expect(screen.getByRole("button", { name: /ZONE-C/ })).toBeEnabled();
  expect(onPick).not.toHaveBeenCalled();
});

it("offers Retry with a fresh subscription when the first page itself resets", () => {
  const reset = querySuccess({
    status: "reset",
    page: [],
    isDone: false,
    continueCursor: "",
  });
  mocks.search.mockImplementation((args: Args) =>
    args.attempt ? page([zone("ZONE-B")]) : reset,
  );
  render();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Locations could not be loaded.",
  );
  expect(results()).not.toHaveAttribute("aria-busy");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(lastSearch()).toMatchObject({ attempt: 1 });
  expect(screen.getByRole("button", { name: /ZONE-B/ })).toBeEnabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("restarts once after a reset, then reports a repeated reset instead of loading forever", () => {
  const reset = querySuccess({
    status: "reset",
    page: [],
    isDone: false,
    continueCursor: "",
  });
  let firstPage = page([zone("ZONE-B")], {
    isDone: false,
    continueCursor: "next-1",
  });
  mocks.search.mockImplementation((args: Args) =>
    args.cursor ? reset : firstPage,
  );
  render();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  // One automatic restart from page 1, where the scan now also resets.
  expect(lastSearch()).not.toHaveProperty("cursor");
  firstPage = page([], { status: "scanning", scanCursor: "s1" });
  refresh();
  mocks.search.mockImplementation((args: Args) =>
    args.scanCursor ? reset : firstPage,
  );
  refresh();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Locations could not be loaded.",
  );
  mocks.search.mockReturnValue(page([zone("ZONE-D")]));
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByRole("button", { name: /ZONE-D/ })).toBeEnabled();
});

it("stops a non-advancing scan with an explicit Retry", () => {
  mocks.search.mockImplementation((args: Args) =>
    args.attempt
      ? page([zone("ZONE-B")])
      : querySuccess({
          status: "scanning",
          isDone: false,
          continueCursor: "",
          items: [],
          page: [],
          scanCursor: "same",
        }),
  );
  render();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The search stopped making progress.",
  );
  const before = mocks.search.mock.calls.length;
  // No automatic request loop while stalled.
  refresh();
  expect(mocks.search.mock.calls.length - before).toBeLessThanOrEqual(1);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(lastSearch()).toMatchObject({ attempt: 1 });
  expect(screen.getByRole("button", { name: /ZONE-B/ })).toBeEnabled();
});

it("pauses a very long scan and continues only when asked", () => {
  mocks.search.mockImplementation((args: Args) =>
    querySuccess({
      status: "scanning",
      isDone: false,
      continueCursor: "",
      items: [zone("ZONE-B")],
      page: [],
      scanCursor: `${String(args.scanCursor ?? "")}+`,
    }),
  );
  render();
  const keep = screen.getByRole("button", { name: "Keep searching" });
  expect(searchStatus()).toHaveTextContent("Many locations checked");
  const steps = String(lastSearch().scanCursor).length;
  expect(steps).toBe(50);
  expect(
    screen.queryByRole("button", { name: "Add location" }),
  ).not.toBeInTheDocument();
  fireEvent.click(keep);
  expect(String(lastSearch().scanCursor).length).toBe(100);
});

it("keeps the building filter trigger at least 44px on every pointer", () => {
  render();
  const trigger = screen.getByRole("button", { name: "Filter by building" });
  const classes = trigger.className.split(/\s+/);
  // A fixed size wins over the shared dense 36px minimum (`dense:min-h-control`),
  // so the rendered box is 48px, or 44px on dense desktop pointers.
  expect(classes).toEqual(expect.arrayContaining(["size-12", "dense:size-11"]));
  expect(classes.filter((name) => /^(dense:)?(h|w|size)-/.test(name))).toEqual([
    "size-12",
    "dense:size-11",
  ]);
});

it("restarts building options once after a reset, then offers Retry", () => {
  const reset = querySuccess({
    status: "reset",
    page: [],
    isDone: false,
    continueCursor: "",
  });
  mocks.buildings.mockImplementation((args: Args) =>
    args.cursor
      ? reset
      : querySuccess({
          status: "ready",
          isDone: false,
          continueCursor: "old-cursor",
          page: [{ buildingId: "building-a", code: "BLDG-A", name: "North" }],
        }),
  );
  render();
  const options = openFilter();
  fireEvent.click(screen.getByRole("button", { name: "Show more buildings" }));
  // One automatic restart: the cursor is dropped, not resent forever.
  expect(mocks.buildings.mock.calls.at(-1)?.[0]).toEqual({
    warehouseId: "warehouse-a",
  });
  expect(within(options).getByRole("button", { name: /BLDG-A/ })).toBeEnabled();
  // The restarted first page resets too: explicit failure and Retry.
  mocks.buildings.mockImplementation((args: Args) =>
    args.attempt
      ? querySuccess({
          status: "ready",
          isDone: true,
          continueCursor: "",
          page: [{ buildingId: "building-b", code: "BLDG-B", name: "South" }],
        })
      : reset,
  );
  refresh();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Buildings could not be loaded.",
  );
  expect(screen.queryByText("Loading buildings…")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(mocks.buildings.mock.calls.at(-1)?.[0]).toMatchObject({
    attempt: 1,
  });
  expect(
    within(screen.getByRole("group", { name: "Filter by building" })).getByRole(
      "button",
      { name: /BLDG-B/ },
    ),
  ).toBeEnabled();
});

it("stops non-advancing building scans and hides options after a denial", () => {
  mocks.buildings.mockReturnValue(
    querySuccess({
      status: "scanning",
      isDone: false,
      continueCursor: "",
      page: [],
      scanCursor: "same",
    }),
  );
  mocks.buildings.mockImplementationOnce(() =>
    querySuccess({
      status: "scanning",
      isDone: false,
      continueCursor: "",
      page: [],
      scanCursor: "same",
    }),
  );
  render();
  openFilter();
  refresh();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The search stopped making progress.",
  );
  mocks.buildings.mockReturnValue({
    ok: false,
    requestId: "denied",
    denial: { kind: "AUTHORIZATION_DENIED" },
  });
  refresh();
  const group = screen.getByRole("group", { name: "Filter by building" });
  expect(within(group).getAllByRole("button")).toHaveLength(1);
  expect(within(group).getByRole("button")).toHaveTextContent("All buildings");
  expect(screen.queryByText("Loading buildings…")).not.toBeInTheDocument();
  expect(screen.getAllByRole("alert").at(-1)).toHaveTextContent(
    "Cannot access locations",
  );
});

it("recovers a failed building-options query locally without losing the draft", async () => {
  vi.useFakeTimers();
  try {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render();
    await type("F1");
    let fail = true;
    mocks.buildings.mockImplementation(() => {
      if (fail) throw new Error("NETWORK");
      return querySuccess({
        status: "ready",
        isDone: true,
        continueCursor: "",
        page: [{ buildingId: "building-a", code: "BLDG-A", name: "North" }],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Filter by building" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Buildings could not be loaded.",
    );
    expect(search()).toHaveValue("F1");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("button", { name: /BLDG-A/ })).toBeEnabled();
    expect(search()).toHaveValue("F1");
  } finally {
    vi.useRealTimers();
  }
});
