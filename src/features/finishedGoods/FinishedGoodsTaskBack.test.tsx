import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import {
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  finishedGoodProduct,
  measuredPalletDetail,
  querySuccess,
} from "@tests/fixtures/finished-goods-ui";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { clearCursorPositions } from "@/hooks/useCursorPagination";
import { batchTestResponse } from "./paginationTestAdapter";

const mocks = vi.hoisted(() => ({ query: vi.fn(), write: vi.fn() }));
vi.mock("@/hooks/useDraftKey", () => ({
  useDraftKey: (scope: string) => `${scope}:audit-user`,
}));
vi.mock("@/hooks/useCanManage", () => ({ useCanManage: () => true }));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (id: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip"
      ? undefined
      : batchTestResponse(
          getFunctionName(ref),
          mocks.query(getFunctionName(ref), args),
          args,
        ),
  useMutation: () =>
    Object.assign(mocks.write, { withOptimisticUpdate: () => mocks.write }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    const search = useSyncExternalStore(
      (listener) => {
        window.addEventListener("app-query-state", listener);
        window.addEventListener("popstate", listener);
        return () => {
          window.removeEventListener("app-query-state", listener);
          window.removeEventListener("popstate", listener);
        };
      },
      () => window.location.search,
    );
    return new URLSearchParams(search);
  },
}));
vi.mock("@/i18n/navigation", () => {
  const navigate = (href: string, mode: "pushState" | "replaceState") => {
    window.history[mode](
      {},
      "",
      /^\/(en|th)(\/|$)/.test(href)
        ? href
        : `/${window.location.pathname.split("/")[1]}${href}`,
    );
    window.dispatchEvent(new Event("app-query-state"));
  };
  return {
    Link: (props: ComponentProps<"a">) => <a {...props} />,
    useRouter: () => ({
      push: (href: string) => navigate(href, "pushState"),
      replace: (href: string) => navigate(href, "replaceState"),
    }),
  };
});
import { PackingScreen } from "./PackingScreen";
import { ProductScreen } from "./ProductScreen";
import { ProductBatches } from "./ProductBatches";
const unit = {
  ...measuredPalletDetail.pallet,
  _id: "unit-a",
  code: "P-A",
  preparationBatchId: "batch-a",
  editable: true,
  lockReason: null,
};
const batch = {
  _id: "batch-a",
  productId: "product-a",
  status: "CREATED",
  revision: 1,
  totalQuantity: 50,
  storageFormat: "PALLET",
  splitMode: "MANUAL",
  packages: [],
};
let stopHistory: (() => void) | undefined;
beforeEach(() => {
  localStorage.clear();
  clearCursorPositions();
  mocks.write.mockReset();
  mocks.query.mockImplementation((name: string) =>
    name.endsWith(":getProduct")
      ? querySuccess(finishedGoodProduct)
      : name.endsWith(":get")
        ? querySuccess({ product: finishedGoodProduct, batch, units: [unit] })
        : querySuccess({
            batches: [{ batch, units: [unit], history: [], editable: true }],
            legacyUnits: [],
          }),
  );
  window.history.replaceState(
    { appNavigationIndex: 0, __NA: true },
    "",
    "/en/warehouse?search=origin#stock",
  );
  stopHistory = trackAppHistory();
});
afterEach(async () => {
  cleanup();
  stopHistory?.();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
const url = () =>
  window.location.pathname + window.location.search + window.location.hash;
async function back() {
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 35));
  });
}
function show(ui: ReactNode) {
  return renderWithIntl(
    <NavigationGuardProvider>{ui}</NavigationGuardProvider>,
    { locale: "en", workspace: false, preserveProviders: true },
  );
}
function packingReview() {
  fireEvent.click(
    screen.getByRole("button", { name: "Exact measurements (optional)" }),
  );
  const fields: [string, string][] = [
    ["Batch total quantity", "50"],
    ["Quantity per pallet", "50"],
    ["Length (m)", "1"],
    ["Width (m)", "1"],
    ["Height (m)", "1"],
  ];
  for (const [name, value] of fields)
    fireEvent.change(screen.getByRole("spinbutton", { name }), {
      target: { value },
    });
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I checked this unit/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Review and create" }));
}
it("native Back closes Packing review before page departure and retains draft", async () => {
  const path =
    "/en/finished-goods/products/product-a/packing?search=keep#units";
  window.history.pushState({}, "", path);
  show(<PackingScreen productId="product-a" />);
  packingReview();
  expect(
    screen.getByRole("dialog", { name: "Review storage units" }),
  ).toBeVisible();
  await back();
  expect(
    screen.queryByRole("dialog", { name: "Review storage units" }),
  ).not.toBeInTheDocument();
  expect(url()).toBe(path);
  expect(
    screen.getByRole("spinbutton", { name: "Batch total quantity" }),
  ).toHaveValue(50);
});
it("explicit Packing review Close consumes its entry before the next Back", async () => {
  window.history.pushState(
    {},
    "",
    "/en/finished-goods/products/product-a/packing?search=keep#units",
  );
  show(<PackingScreen productId="product-a" />);
  packingReview();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await back();
  await waitFor(() => expect(url()).toBe("/en/warehouse?search=origin#stock"));
});
it("pristine product Cancel consumes its task entry and restores catalogue state", async () => {
  window.history.pushState(
    {},
    "",
    "/th/finished-goods?search=kept&tab=products#catalogue",
  );
  window.history.pushState({}, "", "/en/finished-goods/new");
  show(<ProductScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(url()).toBe("/th/finished-goods?search=kept&tab=products#catalogue"),
  );
  await back();
  expect(url()).toBe("/en/warehouse?search=origin#stock");
});
it("ProductBatches Forward after conditional manager closure removes its invisible foreground entry", async () => {
  const path = "/en/finished-goods/products/product-a?search=keep#batches";
  window.history.pushState({}, "", path);
  show(
    <ProductBatches warehouseId="warehouse-a" product={finishedGoodProduct} />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "View storage batch-a" }),
  );
  expect(await screen.findByRole("dialog")).toBeVisible();
  await back();
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await act(async () => {
    window.history.forward();
    await new Promise((resolve) => setTimeout(resolve, 35));
  });
  await waitFor(() => expect(url()).toBe(path));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await back();
  expect(url()).toBe("/en/warehouse?search=origin#stock");
});

it("Packing Forward and remount restore the retained batch draft without writing", async () => {
  const path =
    "/en/finished-goods/products/product-a/packing?search=keep#units";
  window.history.pushState({}, "", path);
  const view = show(<PackingScreen productId="product-a" />);
  packingReview();
  await back();
  await act(async () => {
    window.history.forward();
    await new Promise((resolve) => setTimeout(resolve, 35));
  });
  expect(
    await screen.findByRole("dialog", { name: "Review storage units" }),
  ).toBeVisible();
  await back();
  view.unmount();
  show(<PackingScreen productId="product-a" />);
  expect(
    screen.getByRole("spinbutton", { name: "Batch total quantity" }),
  ).toHaveValue(50);
  expect(mocks.write).not.toHaveBeenCalled();
  expect(url()).toBe(path);
});

it("ProductBatches explicit manager Close consumes its entry before the next Back", async () => {
  window.history.pushState(
    {},
    "",
    "/en/finished-goods/products/product-a?search=keep#batches",
  );
  show(
    <ProductBatches warehouseId="warehouse-a" product={finishedGoodProduct} />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "View storage batch-a" }),
  );
  expect(await screen.findByRole("dialog")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await back();
  expect(url()).toBe("/en/warehouse?search=origin#stock");
});

it("direct pristine product Cancel uses the validated catalogue parent", async () => {
  stopHistory?.();
  window.history.replaceState(
    { appNavigationIndex: 0, __NA: true },
    "",
    "/en/finished-goods/new?search=task#new",
  );
  stopHistory = trackAppHistory();
  show(<ProductScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(url()).toBe("/en/finished-goods"));
  expect(window.history.state?.appNavigationIndex).toBe(0);
});

it("Packing native Back protects the pending create and the successful receipt consumes its review entry", async () => {
  let resolveWrite: ((value: unknown) => void) | undefined;
  const pending = new Promise<unknown>((resolve) => {
    resolveWrite = resolve;
  });
  mocks.write.mockReturnValue(pending);
  const path =
    "/en/finished-goods/products/product-a/packing?search=keep#units";
  window.history.pushState({}, "", path);
  show(<PackingScreen productId="product-a" />);
  packingReview();
  fireEvent.click(screen.getByRole("button", { name: /^Confirm create/ }));
  await waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
  await back();
  expect(url()).toContain("/en/finished-goods/products/product-a/packing");
  expect(
    screen.getByRole("dialog", { name: "Review storage units" }),
  ).toBeVisible();
  await act(async () => {
    resolveWrite?.({
      ok: true,
      requestId: "request-a",
      value: {
        written: true,
        documentId: "batch-a",
        batchId: "batch-a",
        revision: 1,
        replayed: false,
        palletIds: ["unit-a"],
      },
    });
    await pending;
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Review or edit this batch" }),
    ).toBeVisible(),
  );
  expect(
    screen.queryByRole("dialog", { name: "Review storage units" }),
  ).not.toBeInTheDocument();
  await back();
  expect(url()).toBe("/en/warehouse?search=origin#stock");
});
