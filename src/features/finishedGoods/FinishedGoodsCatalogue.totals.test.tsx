import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type * as ClerkModule from "@clerk/nextjs";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { clearCursorPositions } from "@/hooks/useCursorPagination";
import { catalogueTestResponse } from "@tests/fixtures/paginationTestAdapter";
import {
  finishedGoodsList,
  finishedGoodsWorkspace,
  querySuccess,
} from "@tests/fixtures/finished-goods-ui";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { FinishedGoodsCatalogue } from "@/features/finishedGoods/FinishedGoodsCatalogue";

vi.mock("@clerk/nextjs", async (original) => ({
  ...(await original<typeof ClerkModule>()),
  useAuth: () => ({ isLoaded: true, userId: "user-a" }),
}));
vi.mock("@/components/providers/WorkspaceProvider", async (original) => ({
  ...(await original<typeof WorkspaceModule>()),
  useWorkspace: () => finishedGoodsWorkspace,
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (id: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
const base = finishedGoodsList.pallets[0]!;
const unit = (code: string, status: typeof base.status) => ({
  ...base,
  _id: `pallet-${code}`,
  code,
  status,
});
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    catalogueTestResponse(
      getFunctionName(ref),
      args,
      querySuccess({
        products: finishedGoodsList.products,
        pallets: [
          unit("U-MEASURE", "AWAITING_MEASUREMENT"),
          unit("U-PLACE", "AWAITING_PLACEMENT"),
          unit("U-RESERVED", "RESERVED"),
          unit("U-STORED", "STORED"),
        ],
      }),
    ),
}));

let stop: (() => void) | undefined;
beforeEach(() => {
  clearCursorPositions();
  localStorage.clear();
  history.replaceState({ appNavigationIndex: 0 }, "", "/en/finished-goods");
  stop = trackAppHistory();
});
afterEach(() => {
  cleanup();
  stop?.();
  clearCursorPositions();
});

const units = () =>
  screen
    .getAllByRole("link")
    .map((link) => link.textContent)
    .filter((text) => text?.startsWith("U-"));

it("a warehouse total opens exactly the units it counts, and its chip undoes it", () => {
  renderWithIntl(<FinishedGoodsCatalogue />, {
    locale: "en",
    workspace: false,
  });
  const search = screen.getByRole("textbox", { name: "Search finished goods" });
  fireEvent.change(search, { target: { value: "Packaging" } });

  const storage = screen.getByRole("button", {
    name: /^Awaiting storage\s*2$/,
  });
  expect(storage).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(storage);

  // One tap: units tab, both statuses the total counts, nothing else hidden.
  expect(screen.getByRole("button", { name: "Storage units" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(search).toHaveValue("");
  expect(storage).toHaveAttribute("aria-pressed", "true");
  expect([...new Set(units())].sort()).toEqual(["U-PLACE", "U-RESERVED"]);
  const chips = screen.getByRole("group", { name: "Active filters" });
  expect(within(chips).getByText(/Status/)).toBeVisible();

  fireEvent.click(
    screen.getByRole("button", { name: /^Awaiting measurement\s*1$/ }),
  );
  expect([...new Set(units())]).toEqual(["U-MEASURE"]);
  expect(storage).toHaveAttribute("aria-pressed", "false");

  fireEvent.click(screen.getByRole("button", { name: "Remove filter Status" }));
  expect([...new Set(units())].sort()).toEqual([
    "U-MEASURE",
    "U-PLACE",
    "U-RESERVED",
    "U-STORED",
  ]);
});

it("a total is pressed only while no search or other condition narrows it", () => {
  renderWithIntl(<FinishedGoodsCatalogue />, {
    locale: "en",
    workspace: false,
  });
  const storage = screen.getByRole("button", {
    name: /^Awaiting storage\s*2$/,
  });
  fireEvent.click(storage);
  expect(storage).toHaveAttribute("aria-pressed", "true");

  const search = screen.getByRole("textbox", { name: "Search finished goods" });
  fireEvent.change(search, { target: { value: "U-PLACE" } });
  expect(storage).toHaveAttribute("aria-pressed", "false");
  fireEvent.change(search, { target: { value: "" } });
  expect(storage).toHaveAttribute("aria-pressed", "true");

  fireEvent.click(screen.getByRole("button", { name: "Filter and sort Lot" }));
  const popover = screen.getByRole("dialog", { name: "Lot" });
  fireEvent.change(
    within(popover).getByRole("textbox", { name: "Lot contains" }),
    {
      target: { value: "LOT" },
    },
  );
  fireEvent.click(within(popover).getByRole("button", { name: "Apply" }));
  expect(storage).toHaveAttribute("aria-pressed", "false");

  // Tapping the total again restores its exact warehouse-wide scope.
  fireEvent.click(storage);
  expect(storage).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.queryByRole("button", { name: "Remove filter Lot" }),
  ).toBeNull();
});

it("the product total stays plain text", () => {
  renderWithIntl(<FinishedGoodsCatalogue />, {
    locale: "en",
    workspace: false,
  });
  expect(screen.queryByRole("button", { name: /^Products\s*1$/ })).toBeNull();
});
