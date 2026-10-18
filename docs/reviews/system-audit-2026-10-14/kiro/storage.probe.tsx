/**
 * Kiro audit probes — storage layout location details (UI repetition).
 * Each test asserts the EXPECTED behaviour; a failure on current source is the
 * evidence. Mocks mirror src/features/storageLayouts/StorageLayoutScreens.test.tsx
 * (only Convex, workspace access, router and QueryGate seams are replaced).
 *
 * Run: pnpm exec vitest run --config docs/reviews/system-audit-2026-10-14/kiro/vitest.config.mts storage
 */
import { fireEvent, screen, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutation = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock("@/features/storageLayouts/useStorageBuilding", () => ({
  useStorageBuilding: () => undefined,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navigate,
    back: () => window.history.back(),
    replace: navigate,
  }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => mutation,
  useQuery: () => undefined,
}));
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  useWorkspace: () => ({
    permissionsReady: true,
    navigationPermissions: ["masterData.storageLayout.manage"],
  }),
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (warehouseId: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({
    push: navigate,
    back: () => window.history.back(),
    replace: navigate,
  }),
}));

import { renderWithIntl } from "@tests/fixtures/intl-render";
import type {
  StorageBuildingRow,
  StorageFloorRow,
  StorageZoneRow,
} from "@/lib/convex/storageLayoutApi";
import { BuildingModelWorkspace } from "@/features/storageLayouts/StorageLayoutScreens";

const building: StorageBuildingRow = {
  buildingId: "building-a",
  warehouseId: "warehouse-a",
  code: "BLDG-A",
  name: "Main storage",
  widthMm: 30_000,
  depthMm: 20_000,
  defaultFloorHeightMm: 4_000,
  floorCount: 2,
  totalHeightMm: 8_000,
  grossAreaSqMm: 1_200_000_000,
  reservedAreaSqMm: 0,
  usableAreaSqMm: 1_200_000_000,
  status: "DRAFT",
  version: 2,
};

function zone(occupied: boolean): StorageZoneRow {
  return {
    zoneId: occupied ? "occupied-zone" : "empty-zone",
    locationId: occupied ? "occupied-location" : "empty-location",
    code: occupied ? "FG-1" : "FG-2",
    label: occupied ? "Occupied FG" : "Empty FG",
    qrValue: occupied ? "QR-1" : "QR-2",
    mode: "SIMPLE",
    xMm: 0,
    yMm: 0,
    widthMm: 4_000,
    depthMm: 4_000,
    maxStackHeightMm: 3_000,
    positions: [],
    placements: occupied
      ? [
          {
            placementId: "stored",
            handlingUnitId: "stored-pallet",
            lpn: "P-005",
            levelIndex: 1,
            widthMm: 1_000,
            depthMm: 1_000,
            heightMm: 1_400,
            orientation: "DEFAULT",
            placedAt: 1,
            xMm: 0,
            yMm: 0,
            zMm: 0,
            status: "STORED",
            productName: "Widget A",
          },
        ]
      : [],
  };
}

function floorsWith(z: StorageZoneRow): StorageFloorRow[] {
  return [1, 2].map((floorNumber) => ({
    floorId: `floor-${floorNumber}`,
    floorNumber,
    grossAreaSqMm: 600_000_000,
    reservedAreaSqMm: 0,
    usableAreaSqMm: 600_000_000,
    version: 1,
    storageZones: floorNumber === 2 ? [z] : [],
    reservedBlocks: [],
  }));
}

function mount(z: StorageZoneRow, locale: "en" | "th" = "en") {
  return renderWithIntl(
    <BuildingModelWorkspace building={building} floors={floorsWith(z)} />,
    { locale, workspace: false, preserveProviders: true },
  );
}

const countText = (root: HTMLElement, text: string | RegExp) =>
  within(root).queryAllByText(text).length;

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  mutation
    .mockReset()
    .mockResolvedValue({ ok: true, value: { written: true } });
  navigate.mockReset();
});

describe("desktop location inspector (wide layout)", () => {
  it("K-STO-01 an empty location states 'No stored or reserved units yet' once", () => {
    mount(zone(false));
    fireEvent.click(
      screen.getByRole("button", { name: "Select location Empty FG" }),
    );
    const details = screen.getByRole("complementary", {
      name: "Selected location",
    });
    // Evidence line for the report.
    console.info(
      "K-STO-01 empty-state lines:",
      within(details)
        .queryAllByText("No stored or reserved units yet")
        .map((node) => node.closest("div,p")?.className || node.tagName),
    );
    expect(countText(details, "No stored or reserved units yet")).toBe(1);
  });

  it("K-STO-01(th) the Thai empty location states its empty inventory once", () => {
    mount(zone(false), "th");
    fireEvent.click(
      screen.getByRole("button", { name: "เลือกจุดจัดเก็บ Empty FG" }),
    );
    const details = screen.getByRole("complementary", {
      name: "จุดจัดเก็บที่เลือก",
    });
    expect(countText(details, "ยังไม่มีหน่วยที่จัดเก็บหรือจอง")).toBe(1);
  });

  it("K-STO-02 an occupied location shows its unit count once, not as label and value", () => {
    mount(zone(true));
    fireEvent.click(
      screen.getByRole("button", { name: "Select location Occupied FG" }),
    );
    const details = screen.getByRole("complementary", {
      name: "Selected location",
    });
    const unitMentions = within(details).queryAllByText(/\b1 unit\b/);
    console.info(
      "K-STO-02 '1 unit' text nodes:",
      unitMentions.map((node) => JSON.stringify(node.textContent)),
    );
    const metric = within(details).getByText("Storage units").closest("div");
    console.info("K-STO-02 metric row:", JSON.stringify(metric?.textContent));
    expect(unitMentions).toHaveLength(1);
  });

  it("K-STO-03 the inspector has one heading row and one dismiss control", () => {
    mount(zone(true));
    fireEvent.click(
      screen.getByRole("button", { name: "Select location Occupied FG" }),
    );
    const details = screen.getByRole("complementary", {
      name: "Selected location",
    });
    const headings = [
      ...within(details).queryAllByText("Location details"),
      ...within(details).queryAllByText("Selected location"),
    ].map((node) => node.textContent);
    const dismiss = within(details)
      .getAllByRole("button")
      .filter((button) =>
        ["Hide details", "Clear selection"].includes(
          button.getAttribute("aria-label") ?? "",
        ),
      )
      .map((button) => button.getAttribute("aria-label"));
    console.info("K-STO-03 header labels:", headings, "X buttons:", dismiss);
    expect(headings).toHaveLength(1);
    expect(dismiss).toHaveLength(1);
  });

  it("K-STO-04 the Thai floor stamp does not mix Thai with an English FLOOR label", () => {
    const view = mount(zone(true), "th");
    const stamp = view.container.querySelector<HTMLElement>(
      "[class*='floorStamp']",
    );
    console.info("K-STO-04 stamp:", JSON.stringify(stamp?.textContent));
    expect(stamp?.textContent).not.toMatch(/FLOOR/);
  });
});

describe("mobile location sheet", () => {
  beforeEach(() => {
    const original = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      ...original(query),
      matches: [
        "(max-width: 580px)",
        "(max-width: 850px)",
        "(max-width: 1099px)",
        "(max-width: 1399px)",
      ].includes(query),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });
  afterEach(() => vi.restoreAllMocks());

  it("K-STO-05 the sheet names the code and floor once", () => {
    mount(zone(true));
    const button = within(
      screen.getByRole("group", { name: "Interactive floor map" }),
    ).getByRole("button", { name: "Select location Occupied FG" });
    fireEvent.click(button);
    const sheet = screen.getByRole("dialog", { name: "Location details" });
    const floorMentions = within(sheet).queryAllByText(/Floor 2/);
    const codeMentions = within(sheet).queryAllByText(/FG-1/);
    console.info(
      "K-STO-05 sheet title/eyebrow:",
      [
        ...within(sheet).queryAllByText("Location details"),
        ...within(sheet).queryAllByText("Selected location"),
      ].map((n) => `${n.tagName}:${JSON.stringify(n.textContent)}`),
    );
    console.info(
      "K-STO-05 floor mentions:",
      floorMentions.map((n) => `${n.tagName}:${JSON.stringify(n.textContent)}`),
      "code mentions:",
      codeMentions.map((n) => `${n.tagName}:${JSON.stringify(n.textContent)}`),
    );
    expect(floorMentions).toHaveLength(1);
  });
});
