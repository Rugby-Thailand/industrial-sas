import { getFunctionName } from "convex/server";
import { fireEvent, screen, within, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
const mock = vi.hoisted(() => ({
  manage: true,
  rows: [] as unknown[],
  ok: true,
  userId: "user",
  orgId: "org",
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ userId: mock.userId, orgId: mock.orgId }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: (
    ref: Parameters<typeof getFunctionName>[0],
    args: Record<string, unknown> | "skip",
  ) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(ref);
    const rows = mock.rows as (typeof row)[];
    if (name.endsWith(":detail"))
      return {
        ok: mock.ok,
        value: rows.find((row) => row.zoneId === args.zoneId),
      };
    if (name.endsWith(":options"))
      return {
        ok: mock.ok,
        value: {
          status: "ready",
          page: rows.map((row) => ({ ...row, floorCount: row.floorNumber })),
          isDone: true,
          continueCursor: "",
        },
      };
    const page = rows.filter(
      (row) =>
        (!args.status || row.status === args.status) &&
        (!args.buildingId || row.buildingId === args.buildingId) &&
        (args.floorNumber === undefined ||
          row.floorNumber === args.floorNumber) &&
        `${row.label} ${row.code} ${row.buildingName} ${row.positions.map((p) => `${p.label} ${p.code}`).join(" ")}`
          .toLowerCase()
          .includes(String(args.search ?? "").toLowerCase()),
    );
    return {
      ok: mock.ok,
      value: { status: "ready", page, isDone: true, continueCursor: "" },
    };
  },
}));
vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => ({
    permissionsReady: true,
    navigationPermissions: mock.manage
      ? ["masterData.storageLayout.manage"]
      : [],
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { chooseOption } from "@tests/fixtures/select-control";
import { StorageLocationCatalogue } from "./StorageLocationCatalogue";
const row = {
  warehouseId: "warehouse-a",
  zoneId: "zone-a",
  label: "FG-1",
  code: "A-F04-Z01",
  qrValue: "QR:zone-a",
  buildingId: "building-a",
  buildingName: "Main storage",
  buildingCode: "A",
  floorNumber: 4,
  status: "ACTIVE",
  widthMm: 2000,
  depthMm: 2000,
  heightMm: 3000,
  positions: [
    {
      id: "pos-a",
      label: "Bay 1",
      code: "POS-1",
      status: "ACTIVE",
      xMm: 2000,
      yMm: 1000,
      zMm: 0,
    },
  ],
  placements: [
    {
      id: "p-a",
      code: "STOCK-1",
      status: "STORED",
      xMm: 100,
      yMm: 200,
      zMm: 0,
      rotation: 90,
    },
  ],
};
const renderPage = () =>
  renderWithIntl(
    <StorageLocationCatalogue warehouseId="warehouse-a">
      {() => <p>Building cards</p>}
    </StorageLocationCatalogue>,
    { locale: "en", workspace: false, preserveProviders: true },
  );
beforeEach(() => {
  localStorage.clear();
  mock.manage = true;
  mock.ok = true;
  mock.userId = "user";
  mock.orgId = "org";
  mock.rows = [
    row,
    {
      ...row,
      zoneId: "zone-b",
      label: "Raw materials",
      code: "B-F01-Z01",
      buildingId: "building-b",
      buildingName: "Annex",
      buildingCode: "B",
      floorNumber: 1,
      status: "DRAFT",
      positions: [],
      placements: [],
    },
  ];
});
it("does not retain one actor's view preferences after an actor switch", async () => {
  const view = renderPage();
  fireEvent.click(screen.getByRole("button", { name: "All locations" }));
  expect(screen.getByRole("table", { name: "All storage locations" })).toBeVisible();

  mock.userId = "another-user";
  view.rerender(
    <StorageLocationCatalogue warehouseId="warehouse-a">
      {() => <p>Building cards</p>}
    </StorageLocationCatalogue>,
  );
  expect(screen.queryByRole("table", { name: "All storage locations" })).toBeNull();
  expect(screen.getByText("Building cards")).toBeVisible();
});
it("switches to all locations, opens coordinates and QR, and exposes exact planner links", async () => {
  const { container } = renderPage();
  fireEvent.click(screen.getByRole("button", { name: "All locations" }));
  expect(
    screen.getByRole("table", { name: "All storage locations" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "FG-1" })).toHaveAttribute(
    "href",
    "/master-data/storage-layouts/building-a?floor=4&editing=1#storage-zone-zone-a",
  );
  expect(screen.getByRole("link", { name: "Edit FG-1" })).toHaveAttribute(
    "href",
    expect.stringContaining("&editZone=zone-a"),
  );
  fireEvent.click(screen.getAllByText(/Sublocations \/ occupancy/)[0]!);
  await waitFor(() =>
    expect(screen.getByText(/STOCK-1.*90°.*Stored/)).toBeVisible(),
  );
  expect((await axe(container)).violations).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "QR FG-1" }));
  expect(
    within(screen.getByRole("dialog")).getByText("A-F04-Z01"),
  ).toBeVisible();
});
it("filters across buildings, floors, sublocations and statuses without trapping an empty result", async () => {
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "All locations" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search locations" }), {
    target: { value: "Bay 1" },
  });
  expect(
    screen.queryByRole("link", { name: "Raw materials" }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Search locations" }), {
    target: { value: "missing" },
  });
  await waitFor(() =>
    expect(screen.getByText("No matching locations")).toBeVisible(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  await chooseOption("Building", "B · Annex");
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "Raw materials" })).toBeVisible(),
  );
  expect(screen.queryByRole("link", { name: "FG-1" })).not.toBeInTheDocument();
});
it("restores view and filters after refresh and hides edit actions for readers", async () => {
  const first = renderPage();
  fireEvent.click(screen.getByRole("button", { name: "All locations" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search locations" }), {
    target: { value: "Annex" },
  });
  first.unmount();
  mock.manage = false;
  renderPage();
  expect(screen.getByRole("textbox", { name: "Search locations" })).toHaveValue(
    "Annex",
  );
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "Raw materials" })).toBeVisible(),
  );
  expect(
    screen.queryByRole("link", { name: "Edit Raw materials" }),
  ).not.toBeInTheDocument();
});
it("shows an honest empty state and retains view controls", () => {
  mock.rows = [];
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "All locations" }));
  expect(screen.getByText(/No locations yet/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Buildings" }));
  expect(screen.getByText("Building cards")).toBeVisible();
});
it("shows read failure without reporting an empty warehouse", () => {
  mock.ok = false;
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "All locations" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Locations could not be loaded",
  );
  expect(screen.queryByText(/No locations yet/)).not.toBeInTheDocument();
});

it("distinguishes both move holds while displaying one pallet and the union footprint", async () => {
  mock.rows = [
    {
      ...row,
      palletCount: 1,
      occupiedFootprintAreaSqMm: 1_800_000,
      placements: [
        { ...row.placements[0]!, moveRole: "SOURCE", moveState: "IN_TRANSIT" },
        {
          ...row.placements[0]!,
          id: "target",
          code: "STOCK-2",
          status: "RESERVED",
          moveRole: "TARGET",
          moveState: "IN_TRANSIT",
        },
      ],
    },
  ];
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "All locations" }));
  const summary = screen.getByText(/Sublocations \/ occupancy/);
  fireEvent.click(summary);
  await waitFor(() => expect(summary).toHaveTextContent("(1 / 1)"));
  expect(
    screen.getByText(/STOCK-1.*Last confirmed position · moving/),
  ).toBeVisible();
  expect(screen.getByText(/STOCK-2.*Move destination reserved/)).toBeVisible();
  expect(
    screen.getByText("Occupied and reserved footprint: 1.8 m²"),
  ).toBeVisible();
});
