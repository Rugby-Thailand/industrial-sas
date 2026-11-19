import { fireEvent, screen } from "@testing-library/react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { expect, it, vi } from "vitest";

import { getFunctionName } from "convex/server";

import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { batchTestResponse } from "@tests/fixtures/paginationTestAdapter";
import {
  finishedGoodProduct,
  finishedGoodsWorkspace,
  querySuccess,
} from "@tests/fixtures/finished-goods-ui";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn<(href: string) => void>(),
  query: vi.fn<(name: string, args: unknown) => unknown>(),
  // Live subscriptions by function name: mounted, non-skipped useQuery calls.
  active: new Map<string, number>(),
}));
vi.mock("convex/react", async () => {
  const { getTestMutation } = await import("@tests/fixtures/convex-mutation");
  const { useEffect } = await import("react");
  return {
    useMutation: getTestMutation,
    useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
      const name = getFunctionName(ref);
      const skipped = args === "skip";
      useEffect(() => {
        if (skipped) return;
        mocks.active.set(name, (mocks.active.get(name) ?? 0) + 1);
        return () => {
          mocks.active.set(name, mocks.active.get(name)! - 1);
        };
      }, [name, skipped]);
      return skipped ? undefined : mocks.query(name, args);
    },
  };
});
vi.mock("@/hooks/useDraftKey", () => ({
  useDraftKey: () => "user-a:warehouse-a",
}));
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  useWorkspace: () => finishedGoodsWorkspace,
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (id: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: ComponentProps<"a">) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        mocks.navigate(href!);
      }}
    >
      {children}
    </a>
  ),
  useRouter: () => ({ push: mocks.navigate, replace: mocks.navigate }),
}));

import { ProductScreen } from "./ProductScreen";

it("subscribes once on product detail open, releases it on Cancel and never watches getPallet", () => {
  localStorage.clear();
  mocks.active.clear();
  window.history.replaceState(null, "", "/en/finished-goods");
  const detailName = getFunctionName(fgRefs.getProduct);
  mocks.query.mockImplementation((name, args) => {
    if (name === detailName) return querySuccess(finishedGoodProduct);
    return batchTestResponse(
      name,
      querySuccess({ batches: [], legacyUnits: [] }),
      args,
    );
  });
  function Routes() {
    const [path, navigate] = useState("/finished-goods");
    mocks.navigate.mockImplementation(navigate);
    return path === "/finished-goods" ? (
      <button onClick={() => navigate("/finished-goods/products/product-a")}>
        Open detail
      </button>
    ) : (
      <ProductScreen productId={finishedGoodProduct._id} />
    );
  }
  renderWithIntl(<Routes />, { locale: "en", workspace: false });
  expect(mocks.query).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open detail" }));
  expect(screen.getByRole("textbox", { name: "Product name" })).toHaveValue(
    finishedGoodProduct.name,
  );
  // Count live owners, not renders: a benign re-render must not fail this.
  expect(mocks.active.get(detailName)).toBe(1);
  const detailReads = () =>
    mocks.query.mock.calls.filter(([name]) => name === detailName).length;
  const readsBeforeLeaving = detailReads();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mocks.active.get(detailName)).toBe(0);
  expect(screen.getByRole("button", { name: "Open detail" })).toBeVisible();
  expect(detailReads()).toBe(readsBeforeLeaving);
  expect(
    mocks.query.mock.calls.some(
      ([name]) => name === getFunctionName(fgRefs.getPallet),
    ),
  ).toBe(false);
});
