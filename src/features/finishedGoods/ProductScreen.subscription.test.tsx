import { fireEvent, screen } from "@testing-library/react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { ConvexProvider, ConvexReactClient, useQuery } from "convex/react";
import type * as ConvexReact from "convex/react";
import { getFunctionName } from "convex/server";
import type * as SharedModule from "./shared";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { readCurrentWorkspaceRef } from "@/lib/convex/workspaceApi";
import { resolveTestQuery } from "@tests/fixtures/convex-query";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { batchTestResponse } from "@tests/fixtures/paginationTestAdapter";
import {
  finishedGoodProduct,
  finishedGoodsWorkspace,
  querySuccess,
} from "@tests/fixtures/finished-goods-ui";

const mocks = vi.hoisted(() => ({ navigate: vi.fn<(href: string) => void>() }));
// As in AiUsageScreen.refresh: retain real query hooks and observer cleanup;
// control only the transport. Writes still use the strict shared registry.
vi.mock("convex/react", async (importOriginal) => {
  const { getTestMutation } = await import("@tests/fixtures/convex-mutation");
  return {
    ...(await importOriginal<typeof ConvexReact>()),
    useMutation: getTestMutation,
  };
});
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  useWorkspace: () => finishedGoodsWorkspace,
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (id: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("./shared", async (importOriginal) => ({
  ...(await importOriginal<typeof SharedModule>()),
  useDraftKey: () => "user-a:warehouse-a",
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

it("subscribes once on product detail open and releases it on Cancel", async () => {
  localStorage.clear();
  window.history.replaceState(null, "", "/en/finished-goods");
  const detailName = getFunctionName(fgRefs.getProduct);
  const workspaceName = getFunctionName(readCurrentWorkspaceRef);
  const acquired: string[] = [];
  const released: string[] = [];
  const active = new Map<string, Set<() => void>>();
  const answers = new Map<string, (args: unknown) => unknown>([
    [detailName, () => querySuccess(finishedGoodProduct)],
    ...[
      fgRefs.pageProductBatches,
      fgRefs.pageLegacyUnits,
      fgRefs.productSummary,
    ].map((ref) => {
      const name = getFunctionName(ref);
      return [
        name,
        (args: unknown) =>
          batchTestResponse(
            name,
            querySuccess({ batches: [], legacyUnits: [] }),
            args,
          ),
      ] as const;
    }),
  ]);
  const results = new Map<string, unknown>();
  const client = new ConvexReactClient("https://example.convex.cloud");
  const watch = vi
    .spyOn(client, "watchQuery")
    .mockImplementation((...parameters) => {
      const [ref, args = {}] = parameters;
      const name = getFunctionName(ref);
      const key = JSON.stringify([name, args]);
      if (!results.has(key)) {
        const answer = answers.get(name);
        const value = answer ? answer(args) : resolveTestQuery(name, args);
        if (value === undefined)
          throw new Error(`Unexpected test query: ${name}`);
        results.set(key, value);
      }
      return {
        onUpdate: (callback) => {
          const listeners = active.get(name) ?? new Set();
          active.set(name, listeners);
          listeners.add(callback);
          acquired.push(name);
          return () => {
            listeners.delete(callback);
            released.push(name);
          };
        },
        localQueryResult: () => results.get(key),
        localQueryLogs: () => undefined,
        journal: () => undefined,
      };
    });
  // Model route mounting with an open control; the real product Cancel
  // callback leaves detail through the mocked Next router.
  function Routes() {
    // An unrelated shared subscription must survive closing detail.
    useQuery(readCurrentWorkspaceRef, {});
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
  const view = renderWithIntl(
    <ConvexProvider client={client}>
      <Routes />
    </ConvexProvider>,
    { locale: "en", workspace: false },
  );
  try {
    const count = (name: string) => active.get(name)?.size ?? 0;
    expect(count(detailName)).toBe(0);
    expect(count(workspaceName)).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Open detail" }));
    expect(screen.getByRole("textbox", { name: "Product name" })).toHaveValue(
      finishedGoodProduct.name,
    );
    expect(count(detailName)).toBe(1);
    expect(acquired.filter((name) => name === detailName)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(count(detailName)).toBe(0);
    expect(released.filter((name) => name === detailName)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Open detail" })).toBeVisible();
    expect(count(workspaceName)).toBe(1);
    expect(
      [...active.entries()]
        .filter(([, listeners]) => listeners.size > 0)
        .map(([name]) => name),
    ).toEqual([workspaceName]);
    expect(
      watch.mock.calls.filter(
        ([ref]) => getFunctionName(ref) === getFunctionName(fgRefs.getPallet),
      ),
    ).toHaveLength(0);
  } finally {
    view.unmount();
    await client.close();
    watch.mockRestore();
  }
  expect([...active.values()].every((listeners) => listeners.size === 0)).toBe(
    true,
  );
});
