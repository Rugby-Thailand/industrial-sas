import { ConvexError } from "convex/values";
import { NextIntlClientProvider } from "next-intl";
import type * as ClerkModule from "@clerk/nextjs";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReturnType,
} from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { fgRefs } from "@/lib/convex/finishedGoodsApi";

const mocks = vi.hoisted(() => ({
  canManage: true,
  authLoaded: true,
  actorId: "user-a",
  warehouseId: "warehouse-a",
  push: vi.fn(),
  save: vi.fn<
    (
      args: FunctionArgs<typeof fgRefs.saveProduct>,
    ) => Promise<FunctionReturnType<typeof fgRefs.saveProduct>>
  >(),
  pallet:
    vi.fn<
      (
        args: FunctionArgs<typeof fgRefs.createPallet>,
      ) => Promise<FunctionReturnType<typeof fgRefs.createPallet>>
    >(),
  query: vi.fn<(name: string) => unknown>(),
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
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref).endsWith(":saveProduct") ? mocks.save : mocks.pallet,
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip" ? undefined : mocks.query(getFunctionName(ref)),
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (warehouseId: string) => ReactNode }) =>
    children(mocks.warehouseId),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: mocks.push }),
}));

import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  finishedGoodsWorkspace,
  measuredPalletDetail,
  reservedPalletDetail,
  createdPalletOutcome,
  finishedGoodProduct,
  finishedGoodsList,
  querySuccess,
  savedProductOutcome,
  writeFailure,
} from "@tests/fixtures/finished-goods-ui";
import { FinishedGoodsCatalogue, ProductScreen } from "./ProductScreens";
import { ProductBatches } from "./ProductBatches";

function chooseStatus(label: string) {
  fireEvent.click(screen.getByRole("button", { name: /^Filters(?: \(|$)/ }));
  const dialog = screen.getByRole("dialog");
  const status = within(dialog).getByRole("group", { name: "Status" });
  for (const option of within(status).getAllByRole("checkbox")) {
    if ((option as HTMLInputElement).checked) fireEvent.click(option);
  }
  fireEvent.click(within(status).getByRole("checkbox", { name: label }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
}
const renderProduct = (productId?: string) =>
  renderWithIntl(<ProductScreen {...(productId ? { productId } : {})} />, {
    locale: "en",
    workspace: false,
  });
const draftKey = "fg-product:user-a:warehouse-a:new";
function fillValidProduct() {
  fireEvent.change(screen.getByRole("textbox", { name: "SKU" }), {
    target: { value: "FG-001" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Product name" }), {
    target: { value: "Packaging cartons" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Counting unit" }), {
    target: { value: "pieces" },
  });
}
function submitProduct() {
  const form = screen.getByRole("textbox", { name: "SKU" }).closest("form");
  if (!form) throw new Error("Product form missing");
  fireEvent.submit(form);
}
const storedDraft = {
  sku: "LOCAL-01",
  name: "Recovered cartons",
  unit: "pieces",
  storageFormat: "PALLET",
  defaultQuantity: "125",
  storageCondition: "ANY",
  notes: "Keep dry",
  customerReference: "",
  productReference: "",
};

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  localStorage.clear();
  mocks.canManage = true;
  mocks.authLoaded = true;
  mocks.actorId = "user-a";
  mocks.warehouseId = "warehouse-a";
  mocks.push.mockReset();
  mocks.save.mockReset().mockResolvedValue(savedProductOutcome);
  mocks.pallet.mockReset().mockResolvedValue(createdPalletOutcome);
  mocks.query.mockReset().mockImplementation((name) =>
    name.endsWith(":listProductBatches")
      ? querySuccess({ batches: [], legacyUnits: [] })
      : name.endsWith(":getProduct")
        ? querySuccess(finishedGoodProduct)
        : name.endsWith(":getPallet")
          ? querySuccess({
              ...measuredPalletDetail,
              pallet: {
                ...measuredPalletDetail.pallet,
                _id: "pallet-original",
              },
            })
          : querySuccess(finishedGoodsList),
  );
});

describe("finished good creation", () => {
  it("saves product edits before packing without creating a spare pallet", async () => {
    renderProduct("product-a");
    fireEvent.change(screen.getByRole("textbox", { name: "Product name" }), {
      target: { value: "Edited packing product" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare more goods" }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        expect.stringMatching(
          /^\/finished-goods\/products\/product-a\/packing\?draft=[0-9a-f-]+$/,
        ),
      ),
    );
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: "product-a",
        name: "Edited packing product",
        draft: false,
      }),
    );
    expect(mocks.pallet).not.toHaveBeenCalled();
  });

  it("saves an existing finished good without adding pallets", async () => {
    renderProduct("product-a");
    fireEvent.change(screen.getByRole("textbox", { name: "Product name" }), {
      target: { value: "Renamed finished good" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save product details" }),
    );
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/finished-goods"),
    );
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: "product-a",
        name: "Renamed finished good",
        draft: false,
      }),
    );
    expect(mocks.pallet).not.toHaveBeenCalled();
  });

  it("saves a product and opens packing without creating physical pallets", async () => {
    renderProduct();
    fillValidProduct();
    fireEvent.click(screen.getByRole("button", { name: "Next: Packing" }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/finished-goods/products/product-a/packing",
      ),
    );
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        warehouseId: "warehouse-a",
        sku: "FG-001",
        name: "Packaging cartons",
        unit: "pieces",
        draft: false,
      }),
    );
    expect(mocks.pallet).not.toHaveBeenCalled();
    expect(localStorage.getItem(draftKey)).toBeNull();
  });

  it("saves an incomplete draft without creating a physical pallet", async () => {
    renderProduct();
    fireEvent.change(screen.getByRole("textbox", { name: "Product name" }), {
      target: { value: "Unfinished product" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/finished-goods"),
    );
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        sku: "",
        name: "Unfinished product",
        draft: true,
      }),
    );
    expect(mocks.save.mock.calls[0]?.[0]).not.toHaveProperty("defaultQuantity");
    expect(mocks.pallet).not.toHaveBeenCalled();
  });

  it.each(["SKU", "Product name", "Counting unit"])(
    "rejects an empty %s before writes",
    async (field) => {
      renderProduct();
      fillValidProduct();
      fireEvent.change(screen.getByRole("textbox", { name: field }), {
        target: { value: "" },
      });
      submitProduct();
      expect(await screen.findByRole("alert")).toBeVisible();
      expect(mocks.save).not.toHaveBeenCalled();
    },
  );

  it("retains entered values and allows retry after mutation rejection", async () => {
    mocks.save.mockRejectedValueOnce(new Error("Connection lost"));
    renderProduct();
    fillValidProduct();
    submitProduct();
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Product name" })).toHaveValue(
      "Packaging cartons",
    );
    expect(mocks.pallet).not.toHaveBeenCalled();
    submitProduct();
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/finished-goods/products/product-a/packing",
      ),
    );
    expect(mocks.save.mock.calls[0]?.[0].requestId).toBe(
      mocks.save.mock.calls[1]?.[0].requestId,
    );
  });

  it("shows duplicate-SKU feedback for the actual backend DUPLICATE_KEY refusal", async () => {
    mocks.save.mockResolvedValue(writeFailure("DUPLICATE_KEY", "sku"));
    renderProduct();
    fillValidProduct();
    submitProduct();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /SKU.*already exists/i,
    );
    expect(mocks.pallet).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "Open existing product" }),
    ).toHaveAttribute("href", "/finished-goods/products/product-a");
  });

  it("continues an already saved product recovered from a local draft without creating pallets", async () => {
    localStorage.setItem(
      draftKey,
      JSON.stringify({ ...storedDraft, savedProductId: "product-a" }),
    );
    renderProduct();
    submitProduct();
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/finished-goods/products/product-a/packing",
      ),
    );
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "product-a", sku: "LOCAL-01" }),
    );
    expect(mocks.pallet).not.toHaveBeenCalled();
  });

  it("restores local work after refresh and warns before discarding it", () => {
    localStorage.setItem(draftKey, JSON.stringify(storedDraft));
    renderProduct();
    expect(screen.getByRole("textbox", { name: "SKU" })).toHaveValue(
      "LOCAL-01",
    );
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("dialog", { name: "Discard unsaved changes?" }),
    ).toBeVisible();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("retains valid fields and recovers safely from malformed optional local draft values", () => {
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        ...storedDraft,
        unit: null,
        notes: {},
        storageFormat: "UNKNOWN",
      }),
    );
    expect(() => renderProduct()).not.toThrow();
    expect(
      screen.getByRole("textbox", { name: "Counting unit" }),
    ).not.toHaveValue("[object Object]");
    expect(screen.getByRole("textbox", { name: "Storage notes" })).toHaveValue(
      "",
    );
    expect(
      screen.queryByRole("combobox", { name: "Storage format" }),
    ).not.toBeInTheDocument();
  });

  it("ignores invalid JSON drafts", () => {
    localStorage.setItem(draftKey, "{unfinished");
    renderProduct();
    expect(screen.getByRole("textbox", { name: "SKU" })).toHaveValue("");
  });

  it("keeps editing or explicitly discards unsaved work", () => {
    renderProduct();
    fillValidProduct();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue editing" }));
    expect(screen.getByRole("textbox", { name: "SKU" })).toHaveValue("FG-001");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(localStorage.getItem(draftKey)).toBeNull();
    expect(mocks.push).toHaveBeenCalledWith("/finished-goods");
  });

  it("repeated product detail edits never submit packing settings or create storage units", async () => {
    renderProduct("product-a");
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Storage format" }),
    ).not.toBeInTheDocument();
    for (const name of ["First edit", "Second edit"]) {
      fireEvent.change(screen.getByRole("textbox", { name: "Product name" }), {
        target: { value: name },
      });
      submitProduct();
      await waitFor(() =>
        expect(mocks.save).toHaveBeenLastCalledWith(
          expect.objectContaining({
            productId: "product-a",
            name,
            draft: false,
          }),
        ),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Save product details" }),
        ).toBeEnabled(),
      );
    }
    for (const [payload] of mocks.save.mock.calls) {
      expect(payload).not.toHaveProperty("defaultQuantity");
      expect(payload).not.toHaveProperty("storageFormat");
    }
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.pallet).not.toHaveBeenCalled();
  });
});

describe("returning to an existing measurement", () => {
  it("resumes the original pallet after saving product edits without creating another pallet", async () => {
    renderWithIntl(
      <ProductScreen productId="product-a" resumePalletId="pallet-original" />,
      { locale: "en", workspace: false },
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Product name" }), {
      target: { value: "Updated cartons" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Return to measurement" }),
    );
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/finished-goods/pallets/pallet-original/measure",
      ),
    );
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: "product-a",
        name: "Updated cartons",
        draft: false,
      }),
    );
    expect(mocks.pallet).not.toHaveBeenCalled();
  });
});

describe("resume context validation", () => {
  it.each(["wrong-product", "RESERVED", "STORED"])(
    "does not use an invalid %s pallet as a resume target",
    (caseName) => {
      const invalid =
        caseName === "wrong-product"
          ? {
              ...measuredPalletDetail,
              pallet: {
                ...measuredPalletDetail.pallet,
                productId: "product-other",
              },
              product: { ...finishedGoodProduct, _id: "product-other" },
            }
          : {
              ...reservedPalletDetail,
              pallet: {
                ...reservedPalletDetail.pallet,
                status:
                  caseName === "RESERVED"
                    ? ("RESERVED" as const)
                    : ("STORED" as const),
              },
            };
      mocks.query.mockImplementation((name) =>
        name.endsWith(":listProductBatches")
          ? querySuccess({ batches: [], legacyUnits: [] })
          : name.endsWith(":getProduct")
            ? querySuccess(finishedGoodProduct)
            : name.endsWith(":getPallet")
              ? querySuccess(invalid)
              : querySuccess(finishedGoodsList),
      );
      renderWithIntl(
        <ProductScreen productId="product-a" resumePalletId="pallet-a" />,
        { locale: "en", workspace: false },
      );
      expect(
        screen.queryByRole("button", { name: "Return to measurement" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Add pallet & measure" }),
      ).not.toBeInTheDocument();
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.pallet).not.toHaveBeenCalled();
    },
  );
});

describe("read-only product access", () => {
  beforeEach(() => {
    mocks.canManage = false;
  });
  it("shows the catalogue without offering creation", () => {
    renderWithIntl(<FinishedGoodsCatalogue />, {
      locale: "en",
      workspace: false,
    });
    expect(
      screen.getByRole("heading", { name: "Packaging cartons" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Add finished good" }),
    ).not.toBeInTheDocument();
  });
  it("keeps empty catalogue read-only", () => {
    mocks.query.mockReturnValue(querySuccess({ products: [], pallets: [] }));
    renderWithIntl(<FinishedGoodsCatalogue />, {
      locale: "en",
      workspace: false,
    });
    expect(
      screen.queryByRole("link", { name: "Create finished good" }),
    ).not.toBeInTheDocument();
  });
  it("gates a direct new-product URL", () => {
    renderProduct();
    expect(
      screen.queryByRole("textbox", { name: "SKU" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Next: Packing" }),
    ).not.toBeInTheDocument();
  });
  it("retains readable product values but cannot save or create a pallet", () => {
    renderProduct("product-a");
    expect(screen.getByRole("textbox", { name: "SKU" })).toHaveValue("FG-001");
    expect(
      screen.getByRole("textbox", { name: "Product name" }),
    ).toBeDisabled();
    const add = screen.queryByRole("button", { name: "Prepare more goods" });
    if (add) expect(add).toBeDisabled();
    submitProduct();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.pallet).not.toHaveBeenCalled();
  });
});

describe("product async save safety", () => {
  it("protects edits while a save is in progress", async () => {
    let finish:
      | ((value: FunctionReturnType<typeof fgRefs.saveProduct>) => void)
      | undefined;
    mocks.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderProduct();
    fillValidProduct();
    submitProduct();
    expect(
      screen.getByRole("textbox", { name: "Product name" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Storage condition" }),
    ).toBeDisabled();
    await act(async () => {
      finish?.(savedProductOutcome);
    });
  });

  it("retains the product request identity across refresh after an uncertain save without adding pallets", async () => {
    mocks.save.mockRejectedValueOnce(
      new Error("Response lost after server committed"),
    );
    const first = renderProduct();
    fillValidProduct();
    submitProduct();
    expect(await screen.findByRole("alert")).toBeVisible();
    const firstRequest = mocks.save.mock.calls[0]?.[0].requestId;
    expect(firstRequest).toBeTruthy();
    first.unmount();
    renderProduct();
    submitProduct();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1]?.[0].requestId).toBe(firstRequest);
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/finished-goods/products/product-a/packing",
      ),
    );
    expect(mocks.pallet).not.toHaveBeenCalled();
  });
});

describe("finished goods catalogue", () => {
  const renderCatalogue = () =>
    renderWithIntl(<FinishedGoodsCatalogue />, {
      locale: "en",
      workspace: false,
    });
  it("restores search, status, tab and table layout after returning to the catalogue", () => {
    const first = renderCatalogue();
    fireEvent.click(screen.getByRole("button", { name: "Storage units" }));
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search finished goods" }),
      { target: { value: "Packaging cartons" } },
    );
    chooseStatus("Awaiting measurement");
    first.unmount();
    renderCatalogue();
    expect(
      screen.getByRole("textbox", { name: "Search finished goods" }),
    ).toHaveValue("Packaging cartons");
    expect(
      screen.getByRole("button", { name: "Storage units" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Table view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", {
        name: "Remove filter Status: Awaiting measurement",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("table", { name: "Storage units table" }),
    ).toBeVisible();
  });

  it("keeps catalogue context separate for each actor and warehouse", () => {
    const element = () => (
      <NextIntlClientProvider locale="en" messages={{}} timeZone="Asia/Bangkok">
        <FinishedGoodsCatalogue />
      </NextIntlClientProvider>
    );
    const view = render(element());
    const search = () =>
      screen.getByRole("textbox", { name: "Search finished goods" });
    fireEvent.change(search(), { target: { value: "Actor A warehouse A" } });
    mocks.actorId = "user-b";
    view.rerender(element());
    expect(search()).toHaveValue("");
    fireEvent.change(search(), { target: { value: "Actor B warehouse A" } });
    mocks.warehouseId = "warehouse-b";
    view.rerender(element());
    expect(search()).toHaveValue("");
    fireEvent.change(search(), { target: { value: "Actor B warehouse B" } });
    mocks.warehouseId = "warehouse-a";
    view.rerender(element());
    expect(search()).toHaveValue("Actor B warehouse A");
    mocks.actorId = "user-a";
    view.rerender(element());
    expect(search()).toHaveValue("Actor A warehouse A");
    mocks.authLoaded = false;
    view.rerender(element());
    expect(
      screen.queryByRole("textbox", { name: "Search finished goods" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    "{broken",
    "null",
    "[]",
    JSON.stringify({
      tab: "unknown",
      search: 42,
      status: "STORED",
      layout: "unknown",
    }),
  ])("recovers invalid saved catalogue context %s", (saved) => {
    localStorage.setItem("fg-catalogue:user-a:warehouse-a", saved);
    renderCatalogue();
    expect(
      screen.getByRole("textbox", { name: "Search finished goods" }),
    ).toHaveValue("");
    expect(screen.getByRole("button", { name: "Products" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Card view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByRole("button", { name: /^Remove filter Status:/ }),
    ).not.toBeInTheDocument();
  });

  it("persists cleared filters while preserving the chosen tab and layout", () => {
    const first = renderCatalogue();
    fireEvent.click(screen.getByRole("button", { name: "Storage units" }));
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    chooseStatus("Stored");
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search finished goods" }),
      {
        target: { value: "No such unit" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    first.unmount();
    renderCatalogue();
    expect(
      screen.getByRole("textbox", { name: "Search finished goods" }),
    ).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: /^Remove filter Status:/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Storage units table" }),
    ).toBeVisible();
  });

  it("restores the same view when the catalogue is reopened in Thai", () => {
    const first = renderCatalogue();
    fireEvent.click(screen.getByRole("button", { name: "Storage units" }));
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search finished goods" }),
      { target: { value: "Packaging cartons" } },
    );
    first.unmount();
    renderWithIntl(<FinishedGoodsCatalogue />, {
      locale: "th",
      workspace: false,
    });
    expect(
      screen.getByRole("textbox", { name: "ค้นหาสินค้าสำเร็จรูป" }),
    ).toHaveValue("Packaging cartons");
    expect(
      screen.getByRole("table", { name: "ตารางหน่วยจัดเก็บ" }),
    ).toBeVisible();
  });

  it("continues filtering when browser storage cannot be read or written", () => {
    const read = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("Storage unavailable");
      });
    const write = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("Storage unavailable");
      });
    try {
      renderCatalogue();
      fireEvent.change(
        screen.getByRole("textbox", { name: "Search finished goods" }),
        {
          target: { value: "No such unit" },
        },
      );
      expect(
        screen.getByRole("heading", { name: "No matching records" }),
      ).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
      expect(
        screen.getByRole("heading", { name: "Packaging cartons" }),
      ).toBeVisible();
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });

  it("shows a useful empty state and creation link", () => {
    mocks.query.mockReturnValue(querySuccess({ products: [], pallets: [] }));
    renderCatalogue();
    expect(
      screen.getByRole("heading", {
        name: "Your first finished good starts here",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Create finished good" }),
    ).toHaveAttribute("href", "/finished-goods/new");
    fireEvent.click(screen.getByRole("button", { name: "Storage units" }));
    expect(
      screen.getByRole("heading", { name: "No storage units yet" }),
    ).toBeVisible();
  });

  it("filters product names and statuses and can clear no-match results", () => {
    renderCatalogue();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search finished goods" }),
      { target: { value: "not found" } },
    );
    expect(
      screen.getByRole("heading", { name: "No matching records" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(
      screen.getByRole("heading", { name: "Packaging cartons" }),
    ).toBeVisible();
    chooseStatus("Draft");
    expect(
      screen.getByRole("heading", { name: "No matching records" }),
    ).toBeVisible();
    chooseStatus("Ready");
    expect(
      screen.getByRole("heading", { name: "Packaging cartons" }),
    ).toBeVisible();
  });

  it("finds a pallet by its product name and sends unmeasured pallets to measurement", () => {
    renderCatalogue();
    fireEvent.click(screen.getByRole("button", { name: "Storage units" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search finished goods" }),
      { target: { value: "Packaging cartons" } },
    );
    const name = screen.getByRole("heading", { name: "Packaging cartons" });
    const card = name.closest("a");
    expect(card).toHaveAttribute(
      "href",
      "/finished-goods/pallets/pallet-a/measure",
    );
    if (!card) throw new Error("Pallet card missing");
    expect(within(card).getByText("P-001")).toBeVisible();
  });
});

describe("draft privacy on shared warehouse devices", () => {
  it("remounts when the signed-in actor changes and restores only that actor's draft", () => {
    const element = () => (
      <NextIntlClientProvider locale="en" messages={{}} timeZone="Asia/Bangkok">
        <ProductScreen />
      </NextIntlClientProvider>
    );
    const view = render(element());
    fireEvent.change(screen.getByRole("textbox", { name: "Product name" }), {
      target: { value: "Actor A private draft" },
    });
    mocks.actorId = "user-b";
    view.rerender(element());
    expect(screen.getByRole("textbox", { name: "Product name" })).toHaveValue(
      "",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Product name" }), {
      target: { value: "Actor B private draft" },
    });
    mocks.actorId = "user-a";
    view.rerender(element());
    expect(screen.getByRole("textbox", { name: "Product name" })).toHaveValue(
      "Actor A private draft",
    );
  });
  it("ignores legacy drafts without an owner and waits for a known signed-in actor", () => {
    localStorage.setItem(
      "fg-product:warehouse-a:new",
      JSON.stringify(storedDraft),
    );
    mocks.authLoaded = false;
    const pending = renderProduct();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(
      screen.queryByRole("textbox", { name: "SKU" }),
    ).not.toBeInTheDocument();
    pending.unmount();
    mocks.authLoaded = true;
    renderProduct();
    expect(screen.getByRole("textbox", { name: "SKU" })).toHaveValue("");
  });
  it("does not reuse another actor's uncertain command for identical product input", async () => {
    mocks.save.mockRejectedValue(new Error("Connection lost"));
    const first = renderProduct();
    fillValidProduct();
    submitProduct();
    await screen.findByRole("alert");
    const firstRequest = mocks.save.mock.calls[0]?.[0].requestId;
    first.unmount();
    mocks.actorId = "user-b";
    renderProduct();
    fillValidProduct();
    submitProduct();
    await screen.findByRole("alert");
    expect(mocks.save.mock.calls[1]?.[0].requestId).not.toBe(firstRequest);
  });
});

it("shows the actual structured Convex error instead of treating its wrapper message as a code", async () => {
  mocks.save.mockRejectedValue(
    new ConvexError({ code: "CAPACITY_DATA_LIMIT" }),
  );
  renderProduct();
  fillValidProduct();
  submitProduct();
  expect(await screen.findByRole("alert")).toHaveTextContent(/too many|limit/i);
  expect(mocks.pallet).not.toHaveBeenCalled();
});

it("can create a product when browser recovery storage is unavailable", async () => {
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
  const remove = vi
    .spyOn(Storage.prototype, "removeItem")
    .mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
  try {
    renderProduct();
    fillValidProduct();
    submitProduct();
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/finished-goods/products/product-a/packing",
      ),
    );
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.pallet).not.toHaveBeenCalled();
  } finally {
    read.mockRestore();
    write.mockRestore();
    remove.mockRestore();
  }
});

describe("catalogue table view", () => {
  it("switches layouts and keeps search, pallet navigation and empty states working", () => {
    renderWithIntl(<FinishedGoodsCatalogue />, {
      locale: "en",
      workspace: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    const table = screen.getByRole("table", { name: "Finished goods table" });
    expect(
      within(table).getByRole("link", {
        name: "Packaging cartons",
      }),
    ).toHaveAttribute("href", "/finished-goods/products/product-a");
    expect(
      within(table).getByRole("link", { name: "Edit FG-001" }),
    ).toBeVisible();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search finished goods" }),
      { target: { value: "missing-sku" } },
    );
    expect(
      screen.getByRole("heading", { name: "No matching records" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("table")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Storage units" }));
    expect(
      screen.getByRole("table", { name: "Storage units table" }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("table")).getByRole("link", {
        name: finishedGoodsList.pallets[0]!.code,
      }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("/finished-goods/pallets/"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Card view" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("offers view links instead of edit actions to read-only users", () => {
    mocks.canManage = false;
    renderWithIntl(<FinishedGoodsCatalogue />, {
      locale: "en",
      workspace: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    expect(
      screen.queryByRole("link", { name: "Edit FG-001" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View FG-001" })).toHaveAttribute(
      "href",
      "/finished-goods/products/product-a",
    );
  });
});

describe("pallet relocation in catalogue", () => {
  it("shows moving pallets separately from stored stock in cards, tables and filters", () => {
    const pallet = finishedGoodsList.pallets[0]!;
    mocks.query.mockReturnValue(
      querySuccess({
        ...finishedGoodsList,
        pallets: [{ ...pallet, status: "STORED", moveStatus: "IN_TRANSIT" }],
      }),
    );
    renderWithIntl(<FinishedGoodsCatalogue />, {
      locale: "en",
      workspace: false,
    });
    expect(screen.getByText("Moving units: 1")).toBeVisible();
    expect(screen.getByText("Stored units").parentElement).toHaveTextContent(
      "Stored units0",
    );
    fireEvent.click(screen.getByRole("button", { name: "Storage units" }));
    expect(screen.getByText("Moving", { exact: true })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    expect(within(screen.getByRole("table")).getByText("Moving")).toBeVisible();
    chooseStatus("Stored");
    expect(
      screen.getByRole("heading", { name: "No matching records" }),
    ).toBeVisible();
    chooseStatus("Moving");
    expect(screen.getByRole("table")).toBeVisible();
  });
});

describe("product quantity and recorded pallet count", () => {
  it("separates the saved total from the default quantity in cards and tables", () => {
    const product = {
      ...finishedGoodsList.products[0]!,
      defaultQuantity: 50,
      unit: "pieces",
    };
    const pallet = finishedGoodsList.pallets[0]!;
    mocks.query.mockReturnValue(
      querySuccess({
        products: [product],
        pallets: Array.from({ length: 4 }, (_, i) => ({
          ...pallet,
          _id: `pallet-${i}`,
          productId: product._id,
          quantity: 100,
        })),
      }),
    );
    renderWithIntl(<FinishedGoodsCatalogue />, {
      locale: "en",
      workspace: false,
    });
    expect(
      screen.getByText("Total in storage units: 400 pieces"),
    ).toBeVisible();
    expect(screen.getByText("4 pallets")).toBeVisible();
    expect(
      screen.queryByText("Default per storage unit: 50 pieces"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    expect(
      within(screen.getByRole("table")).getByText("400 pieces"),
    ).toBeVisible();
    expect(
      within(screen.getByRole("table")).queryByText("Default: 50 pieces"),
    ).not.toBeInTheDocument();
  });
  it("shows 100 pieces and two pallets when two 50-piece pallets are recorded", () => {
    const product = {
      ...finishedGoodsList.products[0]!,
      defaultQuantity: 100,
      unit: "pieces",
    };
    const pallet = finishedGoodsList.pallets[0]!;
    mocks.query.mockReturnValue(
      querySuccess({
        products: [product],
        pallets: [
          { ...pallet, _id: "pallet-1", productId: product._id, quantity: 50 },
          { ...pallet, _id: "pallet-2", productId: product._id, quantity: 50 },
        ],
      }),
    );
    renderWithIntl(<FinishedGoodsCatalogue />, {
      locale: "en",
      workspace: false,
    });
    expect(
      screen.getByText("Total in storage units: 100 pieces"),
    ).toBeVisible();
    expect(screen.getByText("2 pallets")).toBeVisible();
  });
});

describe("preparation batches and legacy review", () => {
  const renderBatches = (value: unknown, locale: "en" | "th" = "en") => {
    mocks.query.mockReturnValue(querySuccess(value));
    return renderWithIntl(
      <ProductBatches
        warehouseId="warehouse-a"
        product={finishedGoodProduct}
      />,
      { locale, workspace: false },
    );
  };
  const unit = {
    ...measuredPalletDetail.pallet,
    quantity: 50,
    storageFormat: "BOX",
    productId: finishedGoodProduct._id,
  };
  const batch = {
    _id: "batch-one",
    totalQuantity: 100,
    storageFormat: "BOX",
    status: "CREATED",
    lot: "LOT-QA",
  };
  it("separates saved batches, resumable drafts and legacy records without counting draft rows", () => {
    renderBatches({
      batches: [
        {
          batch,
          units: [unit, { ...unit, _id: "unit-2", code: "U-2" }],
          history: [],
          editable: true,
        },
        {
          batch: {
            ...batch,
            _id: "batch-draft",
            status: "DRAFT",
            totalQuantity: 900,
          },
          units: [],
          history: [],
          editable: true,
        },
      ],
      legacyUnits: [
        {
          ...unit,
          _id: "legacy-1",
          code: "OLD-1",
          quantity: 25,
          storageFormat: "OTHER",
        },
      ],
    });
    expect(
      screen.getByText(
        "Total in storage units: 125 pieces · 2 boxes · 1 storage unit",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Edit available units atch-one" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Resume draft" })).toHaveAttribute(
      "href",
      "/finished-goods/batches/batch-draft",
    );
    expect(
      screen.getByRole("heading", { name: "Legacy units — no recorded batch" }),
    ).toBeVisible();
    expect(screen.getByText("Storage unit · OLD-1")).toBeVisible();
  });
  it("reviews exact before and after totals and requires a reason before cancelling a legacy record", async () => {
    renderBatches({
      batches: [],
      legacyUnits: [unit, { ...unit, _id: "unit-2", code: "U-2" }],
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Review cancellation" })[0]!,
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("100 pieces · 2 storage units"),
    ).toBeVisible();
    expect(
      within(dialog).getByText("50 pieces · 1 storage unit"),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Confirm cancellation" }),
    ).toBeDisabled();
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "Cancellation reason" }),
      { target: { value: "Duplicate entered by mistake" } },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm cancellation" }),
    );
    await waitFor(() =>
      expect(mocks.pallet).toHaveBeenCalledWith(
        expect.objectContaining({
          palletId: unit._id,
          expectedUpdatedAt: unit.updatedAt,
          reason: "Duplicate entered by mistake",
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
  it("protects reserved and moving records and keeps read-only batch actions hidden", () => {
    mocks.canManage = false;
    renderBatches({
      batches: [
        {
          batch,
          units: [{ ...unit, status: "STORED", moveStatus: "IN_TRANSIT" }],
          history: [],
          editable: false,
          blockedReason: "BATCH_NOT_EDITABLE",
        },
      ],
      legacyUnits: [{ ...unit, status: "RESERVED" }],
    });
    expect(screen.getByText("Moving")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Review cancellation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Edit packing" }),
    ).not.toBeInTheDocument();
  });
  it("shows saved packing revisions and Thai format-aware unit names", () => {
    renderBatches(
      {
        batches: [
          {
            batch,
            units: [unit],
            history: [
              {
                ...batch,
                _id: "revision-one",
                revision: 1,
                palletIds: ["old-1", "old-2"],
                packages: [{ quantity: 50 }, { quantity: 50 }],
              },
            ],
            editable: true,
          },
        ],
        legacyUnits: [],
      },
      "th",
    );
    expect(screen.getByText(`กล่อง · ${unit.code}`)).toBeVisible();
    expect(screen.queryByText(/OTHER/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("ประวัติการแบ่งบรรจุ (1)"));
    expect(screen.getByText("ครั้งที่ 1 · 100 pieces · 2 กล่อง")).toBeVisible();
  });
});

describe("column filter interactions", () => {
  const catalogue = () =>
    renderWithIntl(<FinishedGoodsCatalogue />, {
      locale: "en",
      workspace: false,
    });
  it("applies and cancels header filters, shows chips and preserves filters between layouts", () => {
    catalogue();
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    expect(
      screen.getAllByRole("button", { name: /^Filter and sort/ }),
    ).toHaveLength(5);
    fireEvent.click(
      screen.getByRole("button", { name: "Filter and sort Product" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Name or SKU" }), {
      target: { value: "missing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("table")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Filter and sort Product" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Name or SKU" }), {
      target: { value: "FG-001" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), {
      target: { value: "sku:desc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(
      screen
        .getByRole("button", { name: "Filter and sort Product" })
        .closest("th"),
    ).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(screen.getByRole("button", { name: "Card view" }));
    expect(
      screen.getByRole("button", { name: "Remove filter Product: FG-001" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Packaging cartons" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(
      screen.queryByRole("group", { name: "Active filters" }),
    ).not.toBeInTheDocument();
  });
  it("blocks invalid quantity ranges and applies valid ranges from the shared sheet", () => {
    catalogue();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Quantity minimum" }),
      { target: { value: "100" } },
    );
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Counting unit" }), {
      target: { value: "pieces" },
    });
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Quantity maximum" }),
      { target: { value: "50" } },
    );
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Quantity maximum" }),
      { target: { value: "500" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(
      screen.getByRole("heading", { name: "Packaging cartons" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Remove filter Quantity: 100–500 pieces",
      }),
    ).toBeVisible();
  });
  it("migrates saved view preferences and restores them from a plain catalogue link", () => {
    localStorage.setItem(
      "fg-catalogue:user-a:warehouse-a",
      JSON.stringify({
        tab: "pallets",
        layout: "table",
        search: "LOT",
        status: "AWAITING_MEASUREMENT",
      }),
    );
    const first = catalogue();
    expect(
      screen.getByRole("table", { name: "Storage units table" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Remove filter Status: Awaiting measurement",
      }),
    ).toBeVisible();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search finished goods" }),
      { target: { value: "FG-001" } },
    );
    first.unmount();
    window.history.replaceState(null, "", "/finished-goods");
    catalogue();
    expect(
      screen.getByRole("textbox", { name: "Search finished goods" }),
    ).toHaveValue("FG-001");
  });
  it("lets Next synchronize external history updates instead of reusing its internal update markers", () => {
    window.history.replaceState(
      { __NA: true, _N: true, retained: true },
      "",
      "/finished-goods",
    );
    const replace = vi.spyOn(window.history, "replaceState");
    catalogue();
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    const data = replace.mock.calls.at(-1)?.[0];
    expect(data).toMatchObject({ retained: true });
    expect(data.__NA).toBeUndefined();
    expect(data._N).toBeUndefined();
    replace.mockRestore();
  });
  it("applies storage-unit dimensions and sorting after changing tabs", () => {
    catalogue();
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    fireEvent.click(screen.getByRole("button", { name: "Storage units" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Filter and sort Dimensions (m)" }),
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Length (m) maximum" }),
      { target: { value: "0.5" } },
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), {
      target: { value: "length:asc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(
      screen.getByRole("heading", { name: "No matching records" }),
    ).toBeVisible();
    const saved = JSON.parse(
      new URLSearchParams(window.location.search).get("fg")!,
    );
    expect(saved.pallets.length.max).toBe("0.5");
    expect(saved.pallets.sort).toBe("length:asc");
  });
  it("restores search, sorting, tab and layout on remount and browser navigation", () => {
    window.history.replaceState(
      { retained: true },
      "",
      "/finished-goods?other=keep#records",
    );
    const view = catalogue();
    fireEvent.click(screen.getByRole("button", { name: "Storage units" }));
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search finished goods" }),
      { target: { value: "LOT-001" } },
    );
    const saved = window.location.href;
    expect(new URL(saved).searchParams.get("other")).toBe("keep");
    expect(window.location.hash).toBe("#records");
    expect(window.history.state).toMatchObject({ retained: true });
    view.unmount();
    catalogue();
    expect(
      screen.getByRole("textbox", { name: "Search finished goods" }),
    ).toHaveValue("LOT-001");
    expect(
      screen.getByRole("table", { name: "Storage units table" }),
    ).toBeVisible();
    act(() => {
      window.history.replaceState(
        { fgCatalogueScope: "fg-catalogue:user-a:warehouse-a" },
        "",
        "/finished-goods",
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("button", { name: "Card view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    act(() => {
      window.history.replaceState(null, "", saved);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(
      screen.getByRole("table", { name: "Storage units table" }),
    ).toBeVisible();
  });
});
