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
}));
vi.mock("convex/react", async () => {
  const { getTestMutation } = await import("@tests/fixtures/convex-mutation");
  return {
    useMutation: getTestMutation,
    useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
      args === "skip" ? undefined : mocks.query(getFunctionName(ref), args),
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

it("subscribes once on product detail open and never watches getPallet", () => {
  localStorage.clear();
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
  expect(
    mocks.query.mock.calls.filter(([name]) => name === detailName),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Open detail" })).toBeVisible();
  expect(
    mocks.query.mock.calls.filter(([name]) => name === detailName),
  ).toHaveLength(1);
  expect(
    mocks.query.mock.calls.some(
      ([name]) => name === getFunctionName(fgRefs.getPallet),
    ),
  ).toBe(false);
});
