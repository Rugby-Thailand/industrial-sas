import { clearCursorPositions } from "@/hooks/useCursorPagination";
import { productPalletSummary } from "./productPalletSummary";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import type * as SharedModule from "./shared";
import { beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { NextIntlClientProvider } from "next-intl";
import {
  finishedGoodProduct,
  measuredPalletDetail,
  querySuccess,
} from "@tests/fixtures/finished-goods-ui";

const mocks = vi.hoisted(() => ({
  canManage: true,
  push: vi.fn(),
  search: new URLSearchParams(),
  query: vi.fn<(name: string, args: unknown) => unknown>(),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.search }));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    batchResponse(getFunctionName(ref), args),
  useMutation: () => vi.fn(),
}));
vi.mock("./shared", async (importOriginal) => ({
  ...(await importOriginal<typeof SharedModule>()),
  useFGText: () => ({ tr: (en: string) => en, locale: "en" }),
  useDraftKey: () => "user-a:batches",
  useCanManage: () => mocks.canManage,
  useOperation: () => ({
    busy: false,
    error: "",
    setError: vi.fn(),
    run: vi.fn(),
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("./BatchManager", () => ({
  BatchManager: ({
    batchId,
    warehouseId,
    mode,
    unitId,
    onClose,
  }: {
    batchId: string;
    warehouseId: string;
    mode: string;
    unitId?: string;
    onClose: () => void;
  }) => {
    const [draft, setDraft] = useState("");
    return (
      <div role="dialog" aria-label="Batch editor">
        <output>{`${warehouseId}/${batchId}/${unitId}/${mode}`}</output>
        <input
          aria-label="Local editor draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button onClick={onClose}>Close editor</button>
      </div>
    );
  },
}));

import { ProductBatches } from "./ProductBatches";
const unit = {
  ...measuredPalletDetail.pallet,
  _id: "unit-a",
  code: "P-A",
  preparationBatchId: "batch-a",
  editable: true,
};
function batches(editable = true) {
  return querySuccess({
    batches: [
      {
        batch: {
          _id: "batch-a",
          totalQuantity: 500,
          storageFormat: "PALLET",
          status: "CREATED",
        },
        units: [{ ...unit, editable }],
        history: [],
        editable,
      },
    ],
    legacyUnits: [],
  });
}
function batchResponse(name: string, args: unknown): unknown {
  if (args === "skip") return undefined;
  const result = mocks.query(name, args) as
    ReturnType<typeof batches> | undefined;
  if (!result?.ok) return result;
  const value = result.value;
  const request = args as { palletId?: string };
  const page = {
    status: "ready",
    isDone: true,
    continueCursor: "",
    scanned: 1,
  };
  if (name.endsWith(":pageProductBatches"))
    return querySuccess({
      ...page,
      page: value.batches.map((entry) => ({
        batch: entry.batch,
        unitCount: entry.units.length,
      })),
    });
  if (name.endsWith(":pageLegacyUnits"))
    return querySuccess({ ...page, page: value.legacyUnits });
  if (name.endsWith(":productSummary"))
    return querySuccess(
      productPalletSummary(
        finishedGoodProduct._id,
        [
          ...value.batches.flatMap((entry) => entry.units),
          ...value.legacyUnits,
        ],
        finishedGoodProduct.storageFormat,
      ),
    );
  if (name.endsWith(":resolveUnitBatch")) {
    const target = value.batches
      .flatMap((entry) => entry.units)
      .find((unit) => unit._id === request.palletId);
    return querySuccess(
      target
        ? {
            batchId: target.preparationBatchId,
            editable: target.editable,
            unit: target,
          }
        : null,
    );
  }
  return result;
}
function component(warehouseId = "warehouse-a", product = finishedGoodProduct) {
  return (
    <NextIntlClientProvider locale="en" messages={{}}>
      <ProductBatches warehouseId={warehouseId} product={product} />
    </NextIntlClientProvider>
  );
}
function navigate(search: string) {
  window.history.replaceState(
    { marker: "keep" },
    "",
    `/en/finished-goods/products/product-a${search}`,
  );
  mocks.search = new URLSearchParams(window.location.search);
}
beforeEach(() => {
  clearCursorPositions();
  vi.clearAllMocks();
  mocks.canManage = true;
  navigate("?editUnit=unit-a");
  mocks.query.mockReturnValue(batches());
});
it("waits for authoritative batches before opening the exact unit", () => {
  mocks.query.mockReturnValue(undefined);
  const view = render(component());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  mocks.query.mockReturnValue(batches());
  view.rerender(component());
  expect(screen.getByText("warehouse-a/batch-a/unit-a/edit")).toBeVisible();
  expect(mocks.query).toHaveBeenCalledWith(
    expect.stringContaining("resolveUnitBatch"),
    {
      warehouseId: "warehouse-a",
      productId: "product-a",
      palletId: "unit-a",
    },
  );
});
it("never opens an editor for a read-only user", () => {
  mocks.canManage = false;
  render(component());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it.each(["missing-unit", "unit-a"])(
  "rejects missing or unavailable correction target %s",
  (id) => {
    navigate(`?editUnit=${id}`);
    mocks.query.mockReturnValue(batches(false));
    render(component());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByText(/This unit is no longer available for editing/),
    ).toBeVisible();
  },
);
it("close removes only the correction request and preserves history, filters, and hash", () => {
  navigate("?editUnit=unit-a&filter=ready#batches");
  const view = render(component());
  fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
  expect(window.location.search).toBe("?filter=ready");
  expect(window.location.hash).toBe("#batches");
  expect(window.history.state).toEqual({ marker: "keep" });
  mocks.search = new URLSearchParams(window.location.search);
  view.rerender(component());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  navigate("?editUnit=unit-a&filter=ready#batches");
  view.rerender(component());
  expect(screen.getByRole("dialog")).toBeVisible();
});
it("does not carry an old editor into a new unavailable correction request", () => {
  const view = render(component());
  navigate("?editUnit=missing-unit");
  view.rerender(component());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByText(/This unit is no longer available for editing/),
  ).toBeVisible();
});
it("browser navigation away from a correction clears the editor and permits returning", () => {
  const view = render(component());
  navigate("");
  view.rerender(component());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  navigate("?editUnit=unit-a");
  view.rerender(component());
  expect(screen.getByRole("dialog")).toBeVisible();
});
it("clears an obsolete unavailable-unit error on navigation", () => {
  navigate("?editUnit=missing-unit");
  const view = render(component());
  navigate("");
  view.rerender(component());
  expect(
    screen.queryByText(/This unit is no longer available for editing/),
  ).not.toBeInTheDocument();
});
it("does not reuse the old batch after changing warehouse and product scope", () => {
  const view = render(component());
  mocks.query.mockReturnValue(querySuccess({ batches: [], legacyUnits: [] }));
  view.rerender(
    component("warehouse-b", {
      ...finishedGoodProduct,
      _id: "product-b",
      warehouseId: "warehouse-b",
    }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(mocks.query).toHaveBeenCalledWith(
    expect.stringContaining("resolveUnitBatch"),
    {
      warehouseId: "warehouse-b",
      productId: "product-b",
      palletId: "unit-a",
    },
  );
});
it("closes the requested editor when management permission is removed", () => {
  const view = render(component());
  mocks.canManage = false;
  view.rerender(component());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it.each([true, false])(
  "loads batch units on demand for management permission %s",
  (canManage) => {
    navigate("");
    mocks.canManage = canManage;
    render(component());
    expect(screen.queryByRole("link", { name: /P-A/ })).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "View storage batch-a" }),
    );
    expect(
      screen.getByText("warehouse-a/batch-a/undefined/view"),
    ).toBeVisible();
  },
);
it("keeps the legacy awaiting unit on its standalone measurement flow", () => {
  navigate("");
  mocks.query.mockReturnValue(
    querySuccess({
      batches: [],
      legacyUnits: [
        {
          ...unit,
          preparationBatchId: undefined,
          status: "AWAITING_MEASUREMENT",
        },
      ],
    }),
  );
  render(component());
  expect(screen.getByRole("link", { name: /P-A/ })).toHaveAttribute(
    "href",
    "/finished-goods/pallets/unit-a/measure",
  );
});
it("clears an unavailable-target message after manually choosing an editable unit", () => {
  navigate("?editUnit=missing-unit");
  render(component());
  expect(
    screen.getByText(/This unit is no longer available for editing/),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Edit available units batch-a" }),
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(
    screen.queryByText(/This unit is no longer available for editing/),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
  expect(
    screen.queryByText(/This unit is no longer available for editing/),
  ).not.toBeInTheDocument();
  expect(window.location.search).toBe("");
});
it("hides the previous editor while a changed scope is loading", () => {
  const view = render(component());
  expect(screen.getByRole("dialog")).toBeVisible();
  mocks.query.mockReturnValue(undefined);
  view.rerender(
    component("warehouse-b", {
      ...finishedGoodProduct,
      _id: "product-b",
      warehouseId: "warehouse-b",
    }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  mocks.query.mockReturnValue(querySuccess({ batches: [], legacyUnits: [] }));
  view.rerender(
    component("warehouse-b", {
      ...finishedGoodProduct,
      _id: "product-b",
      warehouseId: "warehouse-b",
    }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("does not reopen a closed editor when reactive data arrives before search params catch up", () => {
  navigate("?editUnit=unit-a&filter=ready#batches");
  const view = render(component());
  fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
  expect(window.location.search).toBe("?filter=ready");
  // Next's search hook can still describe the previous URL while Convex rerenders.
  expect(mocks.search.get("editUnit")).toBe("unit-a");
  mocks.query.mockReturnValue(batches());
  view.rerender(component());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  mocks.search = new URLSearchParams(window.location.search);
  view.rerender(component());
  mocks.query.mockReturnValue(batches());
  view.rerender(component());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  navigate("?editUnit=unit-a&filter=ready#batches");
  view.rerender(component());
  expect(screen.getByRole("dialog")).toBeVisible();
});
it("ignores a stale correction request when the current URL no longer requests it", () => {
  window.history.replaceState(
    null,
    "",
    "/en/finished-goods/products/product-a",
  );
  // A stale search hook must not resurrect an already-removed request on mount.
  render(component());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("brings an unavailable correction into view once without jumping on reactive updates", async () => {
  navigate("?editUnit=missing-unit");
  const view = render(component());
  const message = screen.getByText(
    /This unit is no longer available for editing/,
  );
  const notice = message.closest('[tabindex="-1"]');
  await waitFor(() => expect(notice).toHaveFocus());
  const edit = screen.getByRole("button", {
    name: "Edit available units batch-a",
  });
  edit.focus();
  mocks.query.mockReturnValue(batches());
  view.rerender(component());
  expect(edit).toHaveFocus();
});

it("mounts a fresh editor when a reactive correction targets another unit", () => {
  const result = batches();
  if (result.ok)
    result.value.batches[0]!.units.push({
      ...unit,
      _id: "unit-b",
      code: "P-B",
    });
  mocks.query.mockReturnValue(result);
  const view = render(component());
  fireEvent.change(
    screen.getByRole("textbox", { name: "Local editor draft" }),
    { target: { value: "Unrelated unsaved change" } },
  );
  navigate("?editUnit=unit-b");
  view.rerender(component());
  expect(screen.getByText("warehouse-a/batch-a/unit-b/edit")).toBeVisible();
  expect(
    screen.getByRole("textbox", { name: "Local editor draft" }),
  ).toHaveValue("");
});
it("mounts a fresh editor when its warehouse changes", () => {
  const view = render(component());
  fireEvent.change(
    screen.getByRole("textbox", { name: "Local editor draft" }),
    { target: { value: "Old warehouse draft" } },
  );
  view.rerender(component("warehouse-b"));
  expect(screen.getByText("warehouse-b/batch-a/unit-a/edit")).toBeVisible();
  expect(
    screen.getByRole("textbox", { name: "Local editor draft" }),
  ).toHaveValue("");
});
it("mounts a fresh manager for a different requested mode", () => {
  navigate("");
  render(component());
  fireEvent.click(screen.getByRole("button", { name: "View storage batch-a" }));
  fireEvent.change(
    screen.getByRole("textbox", { name: "Local editor draft" }),
    { target: { value: "View state" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Edit available units batch-a" }),
  );
  expect(screen.getByText("warehouse-a/batch-a/undefined/edit")).toBeVisible();
  expect(
    screen.getByRole("textbox", { name: "Local editor draft" }),
  ).toHaveValue("");
});

it("returns directly to the active unit after closing a correction", () => {
  navigate("?editUnit=unit-a&returnToUnit=unit-a");
  render(component());
  fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
  expect(mocks.push).toHaveBeenCalledWith(
    "/finished-goods/pallets/unit-a/storage",
  );
});
it("does not navigate to a retired or foreign return unit", () => {
  navigate("?returnToUnit=retired-unit");
  render(component());
  expect(screen.getByText(/This unit was replaced/)).toBeVisible();
  expect(mocks.push).not.toHaveBeenCalled();
});
