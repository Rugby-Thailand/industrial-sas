import { fireEvent, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
const mock = vi.hoisted(() => ({
  manage: true,
  rows: [] as unknown[],
  ok: true,
}));
vi.mock("convex/react", () => ({
  useQuery: () => ({ ok: mock.ok, value: mock.rows }),
}));
vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => ({
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
    { locale: "en", workspace: false },
  );
beforeEach(() => {
  localStorage.clear();
  mock.manage = true;
  mock.ok = true;
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
it("switches to all locations, opens coordinates and QR, and exposes exact planner links", async () => {
  const { container } = renderPage();
  fireEvent.click(screen.getByRole("button", { name: "All locations" }));
  expect(
    screen.getByRole("table", { name: "All storage locations" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "FG-1" })).toHaveAttribute(
    "href",
    "/master-data/storage-layouts/building-a/floors/4#storage-zone-zone-a",
  );
  expect(screen.getByRole("link", { name: "Edit FG-1" })).toHaveAttribute(
    "href",
    expect.stringContaining("?editZone=zone-a"),
  );
  fireEvent.click(screen.getAllByText(/Sublocations \/ occupancy/)[0]!);
  expect(screen.getByText(/STOCK-1.*90°.*Stored/)).toBeVisible();
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
  expect(screen.getByText("No matching locations")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  await chooseOption("Building", "B · Annex");
  expect(screen.getByRole("link", { name: "Raw materials" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "FG-1" })).not.toBeInTheDocument();
});
it("restores view and filters after refresh and hides edit actions for readers", () => {
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
  expect(screen.getByRole("link", { name: "Raw materials" })).toBeVisible();
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
