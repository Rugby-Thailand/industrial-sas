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
    children("warehouse-a"),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: mocks.push }),
}));

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { chooseOption } from "@tests/fixtures/select-control";
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
  fireEvent.change(
    screen.getByRole("spinbutton", {
      name: "Default quantity per storage unit",
    }),
    { target: { value: "500" } },
  );
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
  localStorage.clear();
  mocks.canManage = true;
  mocks.authLoaded = true;
  mocks.actorId = "user-a";
  mocks.push.mockReset();
  mocks.save.mockReset().mockResolvedValue(savedProductOutcome);
  mocks.pallet.mockReset().mockResolvedValue(createdPalletOutcome);
  mocks.query.mockReset().mockImplementation((name) =>
    name.endsWith(":getProduct")
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
    fireEvent.click(screen.getByRole("button", { name: "Pack pallets" }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/finished-goods/products/product-a/packing",
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
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
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

  it("creates one product then one physical pallet and navigates to measurement", async () => {
    renderProduct();
    fillValidProduct();
    fireEvent.click(screen.getByRole("button", { name: "Next: Measure" }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/finished-goods/pallets/pallet-a/measure",
      ),
    );
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        warehouseId: "warehouse-a",
        sku: "FG-001",
        name: "Packaging cartons",
        unit: "pieces",
        defaultQuantity: 500,
        draft: false,
      }),
    );
    expect(mocks.pallet).toHaveBeenCalledWith(
      expect.objectContaining({
        warehouseId: "warehouse-a",
        productId: "product-a",
      }),
    );
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pallet.mock.invocationCallOrder[0]!,
    );
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

  it.each(["", "0", "-2"])(
    "rejects missing or non-positive quantity %j before writes",
    async (quantity) => {
      renderProduct();
      fillValidProduct();
      fireEvent.change(
        screen.getByRole("spinbutton", {
          name: "Default quantity per storage unit",
        }),
        { target: { value: quantity } },
      );
      // Direct submit also checks the component guard, not just native number validation.
      submitProduct();
      expect(await screen.findByRole("alert")).toBeVisible();
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.pallet).not.toHaveBeenCalled();
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
        "/finished-goods/pallets/pallet-a/measure",
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

  it("continues the already saved product if pallet creation fails", async () => {
    mocks.pallet.mockRejectedValueOnce(new Error("Connection lost"));
    renderProduct();
    fillValidProduct();
    submitProduct();
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(JSON.parse(localStorage.getItem(draftKey) ?? "{}")).toMatchObject({
      savedProductId: "product-a",
    });
    submitProduct();
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/finished-goods/pallets/pallet-a/measure",
      ),
    );
    expect(mocks.save.mock.calls[1]?.[0]).toHaveProperty(
      "productId",
      "product-a",
    );
    expect(mocks.pallet.mock.calls[0]?.[0].requestId).toBe(
      mocks.pallet.mock.calls[1]?.[0].requestId,
    );
  });

  it("restores local work after refresh and warns before discarding it", () => {
    localStorage.setItem(draftKey, JSON.stringify(storedDraft));
    renderProduct();
    expect(screen.getByRole("textbox", { name: "SKU" })).toHaveValue(
      "LOCAL-01",
    );
    expect(
      screen.getByRole("spinbutton", {
        name: "Default quantity per storage unit",
      }),
    ).toHaveValue(125);
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
      screen.getByRole("combobox", { name: "Storage format" }),
    ).toHaveTextContent("Pallet");
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

  it("adds a distinct pallet for an existing product without creating another product", async () => {
    renderProduct("product-a");
    fireEvent.click(
      screen.getByRole("button", { name: "Add pallet & measure" }),
    );
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/finished-goods/pallets/pallet-a/measure",
      ),
    );
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "product-a", draft: false }),
    );
    expect(mocks.pallet).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "product-a" }),
    );
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
        name.endsWith(":getProduct")
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
      screen.queryByRole("button", { name: "Next: Measure" }),
    ).not.toBeInTheDocument();
  });
  it("retains readable product values but cannot save or create a pallet", () => {
    renderProduct("product-a");
    expect(screen.getByRole("textbox", { name: "SKU" })).toHaveValue("FG-001");
    expect(
      screen.getByRole("textbox", { name: "Product name" }),
    ).toBeDisabled();
    const add = screen.queryByRole("button", { name: "Add pallet & measure" });
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
      screen.getByRole("combobox", { name: "Storage format" }),
    ).toBeDisabled();
    await act(async () => {
      finish?.(savedProductOutcome);
    });
  });

  it("retains the physical-pallet request identity across refresh after an uncertain response", async () => {
    mocks.pallet.mockRejectedValueOnce(
      new Error("Response lost after server committed"),
    );
    const first = renderProduct();
    fillValidProduct();
    submitProduct();
    expect(await screen.findByRole("alert")).toBeVisible();
    const firstRequest = mocks.pallet.mock.calls[0]?.[0].requestId;
    expect(firstRequest).toBeTruthy();
    first.unmount();
    renderProduct();
    submitProduct();
    await waitFor(() => expect(mocks.pallet).toHaveBeenCalledTimes(2));
    expect(mocks.pallet.mock.calls[1]?.[0].requestId).toBe(firstRequest);
  });
});

describe("finished goods catalogue", () => {
  const renderCatalogue = () =>
    renderWithIntl(<FinishedGoodsCatalogue />, {
      locale: "en",
      workspace: false,
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
    fireEvent.click(screen.getByRole("button", { name: "Pallets" }));
    expect(
      screen.getByRole("heading", { name: "No pallets yet" }),
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
    chooseOption("Status", "Draft");
    expect(
      screen.getByRole("heading", { name: "No matching records" }),
    ).toBeVisible();
    chooseOption("Status", "Ready");
    expect(
      screen.getByRole("heading", { name: "Packaging cartons" }),
    ).toBeVisible();
  });

  it("finds a pallet by its product name and sends unmeasured pallets to measurement", () => {
    renderCatalogue();
    fireEvent.click(screen.getByRole("button", { name: "Pallets" }));
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
        "/finished-goods/pallets/pallet-a/measure",
      ),
    );
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.pallet).toHaveBeenCalledOnce();
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
    fireEvent.click(screen.getByRole("button", { name: "Pallets" }));
    expect(screen.getByRole("table", { name: "Pallets table" })).toBeVisible();
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
