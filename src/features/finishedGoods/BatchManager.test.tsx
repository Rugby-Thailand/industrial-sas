import { batchTestResponse } from "./paginationTestAdapter";
import { axe } from "jest-axe";
import type * as ClerkModule from "@clerk/nextjs";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { getFunctionName } from "convex/server";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import type { PalletDetail } from "@/lib/convex/finishedGoodsApi";
import type { ManagedBatch } from "@/lib/convex/batchManagementApi";
import type { writeSuccess } from "@tests/fixtures/finished-goods-ui";

const mocks = vi.hoisted(() => ({
  canManage: true,
  authLoaded: true,
  actorId: "user-a",
  push: vi.fn(),
  close: vi.fn(),
  query: vi.fn<(name: string) => unknown>(),
  write:
    vi.fn<
      (name: string, args: unknown) => Promise<ReturnType<typeof writeSuccess>>
    >(),
}));
vi.mock("@clerk/nextjs", async (importOriginal) => {
  const actual = await importOriginal<typeof ClerkModule>();
  return {
    ...actual,
    useAuth: () => ({ isLoaded: mocks.authLoaded, userId: mocks.actorId }),
  };
});
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspaceModule>();
  return {
    ...actual,
    useWorkspace: () => ({
      ...finishedGoodsWorkspace,
      navigationPermissions: mocks.canManage
        ? finishedGoodsWorkspace.navigationPermissions
        : ["masterData.storageLayout.read"],
    }),
  };
});
vi.mock("convex/react", () => ({
  useMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.write(getFunctionName(ref), args),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip"
      ? undefined
      : batchTestResponse(
          getFunctionName(ref),
          mocks.query(
            /:(pageProductBatches|pageLegacyUnits|productSummary|resolveUnitBatch)$/.test(
              getFunctionName(ref),
            )
              ? "finishedGoods/batches:listProductBatches"
              : getFunctionName(ref),
          ),
          args,
        ),
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (warehouseId: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: mocks.push }),
}));

import {
  finishedGoodsWorkspace,
  finishedGoodProduct,
  measuredPalletDetail,
  reservedPalletDetail,
  querySuccess,
  writeSuccess as success,
} from "@tests/fixtures/finished-goods-ui";
import { BatchManager } from "./BatchManager";
import { ProductBatches } from "./ProductBatches";
let data: ManagedBatch;
let detail: PalletDetail;
function component(
  mode: "view" | "edit" = "view",
  locale = "en",
  unitId?: string,
) {
  return (
    <NextIntlClientProvider locale={locale} messages={{}}>
      <BatchManager
        warehouseId="warehouse-a"
        batchId="batch-a"
        mode={mode}
        unitId={unitId}
        onClose={mocks.close}
      />
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.clearAllMocks();
  localStorage.clear();
  mocks.canManage = true;
  data = {
    product: finishedGoodProduct,
    batch: {
      _id: "batch-a",
      _creationTime: 1000,
      orgId: "org-a",
      warehouseId: "warehouse-a",
      productId: "product-a",
      revision: 1,
      status: "CREATED",
      totalQuantity: 110,
      storageFormat: "BOX",
      splitMode: "MANUAL",
      packages: [],
      createdAt: 1000,
      updatedAt: 1000,
      createdByUserId: "user-a",
      updatedByUserId: "user-a",
    },
    units: [
      {
        ...measuredPalletDetail.pallet,
        _id: "stored",
        code: "P-001",
        quantity: 50,
        status: "STORED",
        editable: false,
        lockReason: "STORED",
      },
      {
        ...measuredPalletDetail.pallet,
        _id: "free-a",
        code: "P-002",
        quantity: 50,
        editable: true,
        lockReason: null,
      },
      {
        ...measuredPalletDetail.pallet,
        _id: "free-b",
        code: "P-003",
        quantity: 10,
        editable: true,
        lockReason: null,
      },
    ],
  };
  detail = {
    ...reservedPalletDetail,
    pallet: data.units[0]!,
    placement: { ...reservedPalletDetail.placement!, status: "STORED" },
  };
  mocks.query.mockImplementation((name) =>
    querySuccess(name.includes("batchManagement") ? data : detail),
  );
  mocks.write.mockResolvedValue(success("receipt-a"));
});
function checkDimensions() {
  screen.getAllByRole("checkbox").forEach((c) => fireEvent.click(c));
}
it("shows the exact stored location in 2D/3D and links to its move workflow", () => {
  render(component());
  expect(screen.getByText("BLDG-A / Floor 4 / FG-1")).toBeVisible();
  expect(screen.getByRole("link", { name: "Move unit" })).toHaveAttribute(
    "href",
    "/finished-goods/pallets/stored/move",
  );
  fireEvent.click(screen.getByRole("button", { name: "2D plan" }));
  expect(screen.getByRole("button", { name: "2D plan" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
it("selects available units and shows an honest empty position", () => {
  detail = { ...measuredPalletDetail, pallet: data.units[1]! };
  render(component());
  fireEvent.click(screen.getByRole("button", { name: /P-002/ }));
  expect(screen.getByText("No storage position yet")).toBeVisible();
  expect(screen.getByRole("link", { name: "Find storage" })).toHaveAttribute(
    "href",
    "/finished-goods/pallets/free-a/storage",
  );
});
it("protects supporting units and offers their details instead of move", () => {
  detail = {
    ...detail,
    stackChildren: [
      {
        ...reservedPalletDetail.placement!,
        palletId: "upper",
        _id: "above",
        status: "STORED",
        zMm: 1400,
      },
    ],
  };
  render(component());
  expect(
    screen.queryByRole("link", { name: "Move unit" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText("Move the upper unit before moving this support."),
  ).toBeVisible();
});
it("edits only the free 60 and requires review plus measurement confirmation", async () => {
  render(component("edit"));
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Quantity · 1"), {
    target: { value: "30" },
  });
  fireEvent.change(screen.getByLabelText("Quantity · 2"), {
    target: { value: "30" },
  });
  checkDimensions();
  fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
  expect(mocks.write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm repacking" }));
  await waitFor(() =>
    expect(mocks.write).toHaveBeenCalledWith(
      "finishedGoods/batchManagement:repackAvailable",
      expect.objectContaining({
        expectedRevision: 1,
        unitIds: ["free-a", "free-b"],
        packages: [
          expect.objectContaining({ quantity: 30 }),
          expect.objectContaining({ quantity: 30 }),
        ],
      }),
    ),
  );
  expect(await screen.findByText("Packing updated")).toBeVisible();
});
it("opens a unit correction directly and focuses its identifiable replacement row", async () => {
  window.history.replaceState(
    null,
    "",
    "/en/finished-goods/products/product-a?editUnit=free-b",
  );
  mocks.query.mockImplementation((name) =>
    querySuccess(
      name.includes("listProductBatches")
        ? {
            batches: [
              {
                batch: data.batch,
                units: data.units.map((unit) => ({
                  ...unit,
                  preparationBatchId: "batch-a",
                })),
                history: [],
                editable: false,
                blockedReason: "BATCH_NOT_EDITABLE",
              },
            ],
            legacyUnits: [],
          }
        : name.includes("batchManagement")
          ? data
          : detail,
    ),
  );
  render(
    <NextIntlClientProvider locale="en" messages={{}}>
      <ProductBatches warehouseId="warehouse-a" product={finishedGoodProduct} />
    </NextIntlClientProvider>,
  );
  expect(
    screen.queryByRole("button", { name: "Edit packing and dimensions P-001" }),
  ).not.toBeInTheDocument();

  expect(screen.queryByText("P-002 · Replacement")).not.toBeInTheDocument();
  expect(screen.getByText("P-003 · Replacement")).toBeVisible();
  await waitFor(() =>
    expect(screen.getByLabelText("P-003", { selector: "div" })).toHaveFocus(),
  );
  expect(
    screen.getByText(
      "Only this unit will be replaced. All other units, their codes, measurements and stored positions stay unchanged.",
    ),
  ).toBeVisible();
  expect(mocks.write).not.toHaveBeenCalled();
});
it("submits only the directly selected unit and conserves its own quantity", async () => {
  render(component("edit", "en", "free-b"));
  expect(
    screen.getByRole("heading", { name: "Correcting unit · P-003" }),
  ).toBeVisible();
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  expect(screen.getByLabelText("Quantity · 1")).toHaveValue(10);
  fireEvent.change(screen.getByLabelText("Quantity · 1"), {
    target: { value: "60" },
  });
  checkDimensions();
  expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Quantity · 1"), {
    target: { value: "10" },
  });
  fireEvent.change(screen.getByLabelText("Length (m) · 1"), {
    target: { value: "0.8" },
  });
  checkDimensions();
  fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm repacking" }));
  await waitFor(() =>
    expect(mocks.write).toHaveBeenCalledWith(
      "finishedGoods/batchManagement:repackAvailable",
      expect.objectContaining({
        unitIds: ["free-b"],
        packages: [expect.objectContaining({ quantity: 10, lengthMm: 800 })],
      }),
    ),
  );
});
it("names the scoped edit tab and preserves that scope when another unit is previewed", () => {
  render(component("edit", "en", "free-b"));
  fireEvent.change(screen.getByLabelText("Length (m) · 1"), {
    target: { value: "0.8" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Storage" }));
  fireEvent.click(screen.getByRole("button", { name: /P-002/ }));
  fireEvent.click(screen.getByRole("button", { name: "Edit unit · P-003" }));
  expect(
    screen.getByRole("heading", { name: "Correcting unit · P-003" }),
  ).toBeVisible();
  expect(screen.getByLabelText("Length (m) · 1")).toHaveValue(0.8);
  expect(screen.getByLabelText("Quantity · 1")).toHaveValue(10);
});
it.each(["missing", "stored", ""])(
  "never broadens an unavailable direct correction (%s) to other units",
  (unitId) => {
    render(component("edit", "en", unitId));
    expect(
      screen.getByText(/This unit is no longer available for correction/),
    ).toBeVisible();
    expect(screen.queryByLabelText("Quantity · 1")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Review changes" }),
    ).not.toBeInTheDocument();
    expect(mocks.write).not.toHaveBeenCalled();
  },
);
it("blocks a direct correction if its selected unit becomes locked without selecting other available units", () => {
  const view = render(component("edit", "en", "free-b"));
  checkDimensions();
  data = {
    ...data,
    units: data.units.map((unit) =>
      unit._id === "free-b"
        ? { ...unit, editable: false, lockReason: "RESERVED" }
        : unit,
    ),
  };
  view.rerender(component("edit", "en", "free-b"));
  expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
  expect(screen.getByLabelText("Quantity · 1")).toHaveValue(10);
  expect(screen.queryByText("P-002 · Replacement")).not.toBeInTheDocument();
  expect(mocks.write).not.toHaveBeenCalled();
});
it("does not expose a row correction when its physical hold makes it ineligible", () => {
  mocks.query.mockImplementation(() =>
    querySuccess({
      batches: [
        {
          batch: data.batch,
          units: data.units.map((unit) => ({
            ...unit,
            preparationBatchId: "batch-a",
            editable: false,
          })),
          history: [],
          editable: false,
        },
      ],
      legacyUnits: [],
    }),
  );
  render(
    <NextIntlClientProvider locale="en" messages={{}}>
      <ProductBatches warehouseId="warehouse-a" product={finishedGoodProduct} />
    </NextIntlClientProvider>,
  );
  expect(
    screen.queryByRole("button", { name: /Edit packing and dimensions/ }),
  ).not.toBeInTheDocument();
});
it("keeps new split rows distinct from original unit codes", () => {
  render(component("edit", "en", "free-b"));
  fireEvent.change(screen.getByLabelText("Quantity per unit"), {
    target: { value: "5" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Split" }));
  expect(screen.getByText("New unit 1")).toBeVisible();
  expect(screen.getByText("New unit 2")).toBeVisible();
  expect(screen.queryByText("P-003 · Replacement")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
});
it("blocks incorrect totals, blank dimensions and unconfirmed measurements", () => {
  render(component("edit"));
  checkDimensions();
  fireEvent.change(screen.getByLabelText("Quantity · 1"), {
    target: { value: "49" },
  });
  expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Quantity · 1"), {
    target: { value: "50" },
  });
  fireEvent.change(screen.getByLabelText("Height (m) · 1"), {
    target: { value: "" },
  });
  expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
  expect(mocks.write).not.toHaveBeenCalled();
});
it("keeps unsaved edits while switching between storage and packing", () => {
  render(component("edit"));
  fireEvent.change(screen.getByLabelText("Quantity · 1"), {
    target: { value: "30" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Storage" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit available units" }));
  expect(screen.getByLabelText("Quantity · 1")).toHaveValue(30);
  expect(mocks.write).not.toHaveBeenCalled();
});
it("rejects a stale draft when an available unit becomes reserved", () => {
  const view = render(component("edit"));
  checkDimensions();
  data = {
    ...data,
    units: data.units.map((u) =>
      u._id === "free-a"
        ? { ...u, editable: false, lockReason: "RESERVED" }
        : u,
    ),
  };
  view.rerender(component("edit"));
  expect(
    screen.getByText(
      "This batch or its storage state changed. Close and reopen to load current units.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
});
it("shows a useful all-protected state", () => {
  data = { ...data, units: data.units.map((u) => ({ ...u, editable: false })) };
  render(component("edit"));
  expect(
    screen.getByText(/All units are stored, reserved, moving/),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Review changes" }),
  ).not.toBeInTheDocument();
});
it("preserves input on failure and reuses the same request on retry", async () => {
  mocks.write.mockRejectedValueOnce(new Error("OFFLINE"));
  render(component("edit"));
  checkDimensions();
  fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm repacking" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Confirm repacking" }),
    ).toBeEnabled(),
  );
  expect(screen.getByLabelText("Quantity · 1")).toHaveValue(50);
  fireEvent.click(screen.getByRole("button", { name: "Confirm repacking" }));
  await screen.findByText("Packing updated");
  expect(mocks.write.mock.calls[0]![1]).toEqual(mocks.write.mock.calls[1]![1]);
});
it("read-only users can view storage but cannot edit or move", () => {
  mocks.canManage = false;
  render(component());
  expect(
    screen.queryByRole("button", { name: "Edit available units" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Move unit" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Unit details" })).toBeVisible();
});
it.each(["en", "th"])("keeps the editor accessible in %s", async (locale) => {
  render(component("edit", locale));
  expect(await axe(screen.getByRole("dialog"))).toHaveNoViolations();
});

it.each(["close", "escape"])(
  "closes an untouched editor without a discard step via %s",
  (method) => {
    render(component("edit"));
    if (method === "close")
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    else fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("dialog", { name: "Discard packing changes?" }),
    ).not.toBeInTheDocument();
  },
);
it("protects dirty corrections on Escape, keeps the draft on cancel, and discards only explicitly", () => {
  render(component("edit", "en", "free-b"));
  fireEvent.change(screen.getByLabelText("Length (m) · 1"), {
    target: { value: "0.8" },
  });
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(
    screen.getByRole("dialog", { name: "Discard packing changes?" }),
  ).toBeVisible();
  expect(mocks.close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Length (m) · 1")).toHaveValue(0.8);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(mocks.close).toHaveBeenCalledTimes(1);
  expect(mocks.write).not.toHaveBeenCalled();
});
it("does not warn after a dimension correction is restored to its original value", () => {
  render(component("edit", "en", "free-b"));
  const input = screen.getByLabelText("Length (m) · 1");
  const original = (data.units[2]!.lengthMm! / 1000).toString();
  fireEvent.change(input, { target: { value: "0.8" } });
  fireEvent.change(input, { target: { value: original } });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(mocks.close).toHaveBeenCalledTimes(1);
});
it("preserves dirty packing through storage tabs and still protects closing there", () => {
  render(component("edit"));
  fireEvent.change(screen.getByLabelText("Quantity per unit"), {
    target: { value: "30" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Storage" }));
  expect(
    screen.queryByRole("dialog", { name: "Discard packing changes?" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit available units" }));
  expect(screen.getByLabelText("Quantity per unit")).toHaveValue(30);
  expect(mocks.close).not.toHaveBeenCalled();
});
it("prevents dialog dismissal and tab changes during save and permits close after success", async () => {
  let resolveSave!: (value: ReturnType<typeof success>) => void;
  mocks.write.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
  );
  render(component("edit"));
  checkDimensions();
  fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm repacking" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Storage" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Edit available units" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Close" }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(mocks.close).not.toHaveBeenCalled();
  const pendingLink = screen.getByRole("link", {
    name: "Unit details",
    hidden: true,
  });
  expect(fireEvent.click(pendingLink)).toBe(false);
  expect(mocks.push).not.toHaveBeenCalled();
  resolveSave(success("receipt-a"));
  await screen.findByText("Packing updated");
  fireEvent.click(await screen.findByRole("button", { name: "Close" }));
  expect(mocks.close).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("dialog", { name: "Discard packing changes?" }),
  ).not.toBeInTheDocument();
});
it("keeps failed corrections protected while allowing an idempotent retry", async () => {
  mocks.write.mockRejectedValueOnce(new Error("OFFLINE"));
  render(component("edit", "en", "free-b"));
  fireEvent.change(screen.getByLabelText("Length (m) · 1"), {
    target: { value: "0.8" },
  });
  checkDimensions();
  fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm repacking" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Confirm repacking" }),
    ).toBeEnabled(),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Length (m) · 1")).toHaveValue(0.8);
  expect(
    screen.getByRole("region", { name: "Confirm repacking" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Confirm repacking" }));
  await screen.findByText("Packing updated");
  expect(mocks.write.mock.calls[0]![1]).toEqual(mocks.write.mock.calls[1]![1]);
  expect(mocks.close).not.toHaveBeenCalled();
});

it("intercepts outside dismissal without losing a dirty correction", async () => {
  render(component("edit"));
  fireEvent.change(screen.getByLabelText("Length (m) · 1"), {
    target: { value: "0.8" },
  });
  // Radix registers its document pointer handler after the opening event.
  await new Promise((resolve) => setTimeout(resolve, 0));
  fireEvent(
    document.body,
    new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
  );
  fireEvent.click(document.body);
  expect(
    await screen.findByRole("dialog", { name: "Discard packing changes?" }),
  ).toBeVisible();
  expect(mocks.close).not.toHaveBeenCalled();
  fireEvent.keyDown(
    screen.getByRole("dialog", { name: "Discard packing changes?" }),
    { key: "Escape" },
  );
  expect(screen.getByLabelText("Length (m) · 1")).toHaveValue(0.8);
  expect(mocks.close).not.toHaveBeenCalled();
});

it("keeps edits on cancelled Storage navigation and discards to the exact chosen destination", () => {
  render(component("edit", "en", "free-b"));
  fireEvent.change(screen.getByLabelText("Length (m) · 1"), {
    target: { value: "0.8" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Storage" }));
  fireEvent.click(screen.getByRole("button", { name: /P-001/ }));
  fireEvent.click(screen.getByRole("link", { name: "Move unit" }));
  expect(mocks.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit unit · P-003" }));
  expect(screen.getByLabelText("Length (m) · 1")).toHaveValue(0.8);
  fireEvent.click(screen.getByRole("button", { name: "Storage" }));
  fireEvent.click(screen.getByRole("link", { name: "Move unit" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(mocks.push).toHaveBeenCalledWith(
    "/finished-goods/pallets/stored/move",
  );
  expect(mocks.close).toHaveBeenCalledTimes(1);
  expect(mocks.write).not.toHaveBeenCalled();
});
it("warns before browser unload only while corrections are dirty", async () => {
  render(component("edit"));
  const clean = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);
  fireEvent.change(screen.getByLabelText("Length (m) · 1"), {
    target: { value: "0.8" },
  });
  const dirty = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
  checkDimensions();
  fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm repacking" }));
  await screen.findByText("Packing updated");
  await screen.findByRole("button", { name: "Close" });
  await waitFor(() => {
    const saved = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
  });
});

it("rejects sub-millimetre corrections instead of silently rounding measurements", () => {
  render(component("edit", "en", "free-a"));
  fireEvent.change(screen.getByLabelText("Length (m) · 1"), {
    target: { value: "0.5004" },
  });
  checkDimensions();
  expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
  expect(screen.getByText(/nearest millimetre/)).toBeVisible();
  expect(mocks.write).not.toHaveBeenCalled();
});
it("retains measured weight when correcting only dimensions", async () => {
  data = {
    ...data,
    units: data.units.map((unit) => ({ ...unit, weightKg: 25 })),
  };
  render(component("edit", "en", "free-a"));
  fireEvent.change(screen.getByLabelText("Length (m) · 1"), {
    target: { value: "0.8" },
  });
  checkDimensions();
  fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm repacking" }));
  await waitFor(() =>
    expect(mocks.write).toHaveBeenCalledWith(
      "finishedGoods/batchManagement:repackAvailable",
      expect.objectContaining({
        packages: [expect.objectContaining({ weightKg: 25, lengthMm: 800 })],
      }),
    ),
  );
});

it("drops old weights when available quantities are redistributed without changing the total", async () => {
  data = {
    ...data,
    units: data.units.map((unit) => ({ ...unit, weightKg: 25 })),
  };
  render(component("edit"));
  for (const index of [1, 2]) {
    fireEvent.change(screen.getByLabelText(`Quantity · ${index}`), {
      target: { value: "30" },
    });
  }
  checkDimensions();
  fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm repacking" }));
  await waitFor(() =>
    expect(mocks.write).toHaveBeenCalledWith(
      "finishedGoods/batchManagement:repackAvailable",
      expect.objectContaining({
        packages: [
          expect.not.objectContaining({ weightKg: 25 }),
          expect.not.objectContaining({ weightKg: 25 }),
        ],
      }),
    ),
  );
});
