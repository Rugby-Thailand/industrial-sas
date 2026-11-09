import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    catalogueTestResponse(
      getFunctionName(ref),
      args,
      querySuccess({
        products: Array.from({ length: 61 }, (_, index) => ({
          ...finishedGoodsList.products[0]!,
          _id: `paged-${index}`,
          name: `Paged product ${index}`,
          sku: `PAGE-${String(index).padStart(3, "0")}`,
          status: "ACTIVE",
          updatedAt: 1000 - index,
        })),
        pallets: [],
      }),
    ),
}));

let stop: (() => void) | undefined;
beforeEach(() => {
  clearCursorPositions();
  localStorage.clear();
  history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods?other=keep#records",
  );
  stop = trackAppHistory();
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  stop?.();
  clearCursorPositions();
});

function openPageThree() {
  const view = renderWithIntl(<FinishedGoodsCatalogue />, {
    locale: "en",
    workspace: false,
  });
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.getByText("Page 3")).toBeVisible();
  expect(screen.getByText("Paged product 40")).toBeVisible();
  return view;
}
function chooseReady() {
  fireEvent.click(
    screen.getByRole("button", { name: "Filter and sort Status" }),
  );
  const popover = screen.getByRole("dialog", { name: "Status" });
  fireEvent.click(within(popover).getByRole("checkbox", { name: "Ready" }));
  fireEvent.click(within(popover).getByRole("button", { name: "Apply" }));
  expect(screen.getByText("Page 1")).toBeVisible();
}

it.each([false, true])(
  "a fresh filter choice starts at page one with intermediate paging=%s",
  (pageIntermediate) => {
    openPageThree();
    chooseReady();
    if (pageIntermediate)
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Remove filter Status: Ready" }),
    );
    expect(history.state.appNavigationIndex).toBe(2);
    expect(location.search).toBe("?other=keep");
    expect(location.hash).toBe("#records");
    expect(screen.getByText(/^Page \d/)).toHaveTextContent(/^Page 1$/);
    expect(screen.getByText("Paged product 0")).toBeVisible();
  },
);

it("native Back restores the original filter entry's page", async () => {
  openPageThree();
  chooseReady();
  await act(async () => {
    const moved = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    history.back();
    await moved;
  });
  expect(history.state.appNavigationIndex).toBe(0);
  expect(screen.getByText("Page 3")).toBeVisible();
  expect(screen.getByText("Paged product 40")).toBeVisible();
});

it("clearing a fresh typed search starts at page one", async () => {
  // Rendering time on a shared machine is not a pause between keystrokes.
  vi.spyOn(Date, "now").mockReturnValue(1000);
  openPageThree();
  const search = screen.getByRole("textbox", { name: "Search finished goods" });
  fireEvent.change(search, { target: { value: "Paged" } });
  await waitFor(() =>
    expect(screen.getByText("Paged product 0")).toBeVisible(),
  );
  expect(screen.getByText(/^Page \d/)).toHaveTextContent(/^Page 1$/);
  fireEvent.change(search, { target: { value: "" } });
  expect(history.state.appNavigationIndex).toBe(1);
  await waitFor(() =>
    expect(screen.getByText(/^Page \d/)).not.toHaveTextContent("…"),
  );
  expect(screen.getByText(/^Page \d/)).toHaveTextContent(/^Page 1$/);
  expect(screen.getByText("Paged product 0")).toBeVisible();
});

async function traverse(direction: "back" | "forward") {
  await act(async () => {
    const moved = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    history[direction]();
    await moved;
  });
  expect(location.pathname).toBe("/en/finished-goods");
  expect(new URLSearchParams(location.search).get("other")).toBe("keep");
  expect(location.hash).toBe("#records");
}

it("restores each filter entry's page through Back, Forward and a cold remount", async () => {
  const view = openPageThree();
  chooseReady();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.getByText("Page 2")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Remove filter Status: Ready" }),
  );
  expect(screen.getByText("Page 1")).toBeVisible();

  await traverse("back");
  expect(screen.getByText("Page 2")).toBeVisible();
  expect(screen.getByText("Paged product 20")).toBeVisible();
  await traverse("back");
  expect(screen.getByText("Page 3")).toBeVisible();
  expect(screen.getByText("Paged product 40")).toBeVisible();
  await traverse("forward");
  expect(screen.getByText("Page 2")).toBeVisible();
  await traverse("forward");
  expect(screen.getByText("Page 1")).toBeVisible();

  // Drop the hook's memory as a refresh would, retaining only this entry.
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  const saved = history.state;
  view.unmount();
  clearCursorPositions();
  history.replaceState(saved, "");
  renderWithIntl(<FinishedGoodsCatalogue />, {
    locale: "en",
    workspace: false,
  });
  expect(screen.getByText("Page 2")).toBeVisible();
  expect(screen.getByText("Paged product 20")).toBeVisible();
  expect(location.search).toBe("?other=keep");
  expect(location.hash).toBe("#records");
});
