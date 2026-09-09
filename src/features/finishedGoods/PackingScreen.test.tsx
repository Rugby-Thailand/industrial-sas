import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type * as ClerkModule from "@clerk/nextjs";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
const mocks = vi.hoisted(() => ({
  canManage: true,
  actor: "user-a",
  status: "ACTIVE",
  unit: "pieces",
  save: vi.fn(),
  commit: vi.fn(),
  replace: vi.fn(),
  batch: null as unknown,
  batchEditable: true,
}));
vi.mock("@clerk/nextjs", async (importOriginal) => ({
  ...(await importOriginal<typeof ClerkModule>()),
  useAuth: () => ({ isLoaded: true, userId: mocks.actor }),
}));
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  useWorkspace: () => ({
    ...finishedGoodsWorkspace,
    navigationPermissions: mocks.canManage
      ? finishedGoodsWorkspace.navigationPermissions
      : ["masterData.storageLayout.read"],
  }),
}));
vi.mock("convex/react", () => ({
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref).endsWith("saveBatchDraft") ? mocks.save : mocks.commit,
  useQuery: (_ref: unknown, args: { batchId?: string }) =>
    args.batchId
      ? querySuccess({
          batch: mocks.batch ?? serverBatch("CREATED", 1),
          product: {
            ...finishedGoodProduct,
            status: mocks.status,
            unit: mocks.unit,
          },
          units: [],
          history: [],
          editable: mocks.batchEditable,
          blockedReason: mocks.batchEditable
            ? undefined
            : "BATCH_UNITS_RESERVED",
        })
      : querySuccess({
          ...finishedGoodProduct,
          status: mocks.status,
          unit: mocks.unit,
        }),
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (warehouseId: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ replace: mocks.replace, push: mocks.replace }),
}));
import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  finishedGoodsWorkspace,
  finishedGoodProduct,
  querySuccess,
} from "@tests/fixtures/finished-goods-ui";
import { PackingScreen } from "./PackingScreen";
const key = "fg-batch-packing:user-a:warehouse-a:new:product-a";
const show = (batchId?: string, locale: "en" | "th" = "en") =>
  renderWithIntl(
    <PackingScreen {...(batchId ? { batchId } : { productId: "product-a" })} />,
    { locale, workspace: false },
  );
const input = (name: string, value: string) =>
  fireEvent.change(screen.getByRole("spinbutton", { name }), {
    target: { value },
  });
function split(total = "100", capacity = "50") {
  input("Batch total quantity", total);
  input("Quantity per pallet", capacity);
}
function selectUnit(n: number, name = "pallet") {
  fireEvent.click(
    screen.getByRole("button", { name: `${name} ${n}`, pressed: false }),
  );
}
const check = () =>
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I checked this unit/ }),
  );
function measure() {
  input("Length (m)", "1.001");
  input("Width (m)", "1");
  input("Height (m)", "1.4");
  check();
}
function prepare() {
  split();
  measure();
  selectUnit(2);
  measure();
}
function review() {
  fireEvent.click(screen.getByRole("button", { name: "Review and create" }));
}
function confirm() {
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm create 2 pallets" }),
  );
}
const packageValue = {
  quantity: 50,
  lengthMm: 1001,
  widthMm: 1000,
  heightMm: 1400,
  dimensionsChecked: true,
};
const serverBatch = (status = "DRAFT", revision = 1) => ({
  _id: "batch-a",
  status,
  revision,
  totalQuantity: 100,
  storageFormat: "PALLET",
  splitMode: "CAPACITY",
  capacity: 50,
  packages: [packageValue, packageValue],
});
const success = (palletIds: string[] = []) => ({
  ok: true,
  requestId: "test",
  value: {
    written: true,
    documentId: "batch-a",
    batchId: "batch-a",
    revision: 1,
    palletIds,
    replayed: false,
  },
});
beforeEach(() => {
  localStorage.clear();
  mocks.canManage = true;
  mocks.actor = "user-a";
  mocks.status = "ACTIVE";
  mocks.unit = "pieces";
  mocks.batch = null;
  mocks.batchEditable = true;
  mocks.save.mockReset().mockResolvedValue(success());
  mocks.commit.mockReset().mockResolvedValue(success(["unit-a", "unit-b"]));
  mocks.replace.mockReset();
});
describe("batch packing", () => {
  it("starts without inventing a batch total from the product default", () => {
    show();
    expect(
      screen.getByRole("spinbutton", { name: "Batch total quantity" }),
    ).toHaveValue(null);
    expect(
      screen.getByRole("button", { name: "Review and create" }),
    ).toBeDisabled();
  });
  it("automatically previews pristine 100 / 50 as two actual rows and 110 / 50 as 50 + 50 + 10", () => {
    show();
    split();
    expect(
      screen.getByText("Packing preview: 100 pieces → 2 pallets (50 + 50)"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "pallet 2", pressed: false }),
    ).toBeVisible();
    input("Batch total quantity", "110");
    expect(
      screen.getByText(
        "Packing preview: 110 pieces → 3 pallets (50 + 50 + 10)",
      ),
    ).toBeVisible();
    selectUnit(3);
    expect(
      screen.getByRole("spinbutton", { name: "Unit quantity" }),
    ).toHaveValue(10);
  });
  it("requires applying a changed split after measurement and clears sizes without appending units", () => {
    show();
    split("100", "25");
    measure();
    input("Quantity per pallet", "50");
    expect(
      screen.getByRole("button", { name: "pallet 4", pressed: false }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Review and create" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Apply this split" }));
    expect(
      screen.queryByRole("button", { name: "pallet 3", pressed: false }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Length (m)" })).toHaveValue(
      null,
    );
    expect(
      screen.getByText("Packing preview: 100 pieces → 2 pallets (50 + 50)"),
    ).toBeVisible();
  });
  it("keeps manual row edits when rejecting a new split", () => {
    show();
    split();
    input("Unit quantity", "45");
    fireEvent.change(screen.getByRole("combobox", { name: "Split method" }), {
      target: { value: "CAPACITY" },
    });
    input("Quantity per pallet", "25");
    fireEvent.click(
      screen.getByRole("button", { name: "Keep current entries" }),
    );
    expect(screen.getByRole("combobox", { name: "Split method" })).toHaveValue(
      "MANUAL",
    );
    expect(
      screen.getByRole("spinbutton", { name: "Unit quantity" }),
    ).toHaveValue(45);
  });
  it("saves incomplete dimensions as a server draft and navigates to the same batch", async () => {
    show();
    split();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({
      totalQuantity: 100,
      storageFormat: "PALLET",
      packages: [
        { quantity: 50, dimensionsChecked: false },
        { quantity: 50, dimensionsChecked: false },
      ],
    });
    expect(mocks.commit).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/finished-goods/batches/batch-a",
      ),
    );
  });
  it("loads and saves an existing draft with its revision", async () => {
    mocks.batch = serverBatch();
    show("batch-a");
    input("Unit quantity", "40");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({
      batchId: "batch-a",
      expectedRevision: 1,
      packages: [
        { ...packageValue, quantity: 40, dimensionsChecked: false },
        packageValue,
      ],
    });
  });
  it("shows quantities and dimensions in a confirmation dialog before one atomic create", async () => {
    show();
    prepare();
    review();
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("Batch total: 100 pieces · 2 pallets"),
    ).toBeVisible();
    expect(within(dialog).getAllByText("1.001 × 1 × 1.4 m")).toHaveLength(2);
    expect(mocks.commit).not.toHaveBeenCalled();
    confirm();
    await waitFor(() =>
      expect(screen.getByText("Storage units created")).toBeVisible(),
    );
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.commit.mock.calls[0]?.[0]).toMatchObject({
      totalQuantity: 100,
      packages: [packageValue, packageValue],
    });
    expect(
      screen.getByRole("link", { name: "Find storage · pallet 1" }),
    ).toHaveAttribute("href", "/finished-goods/pallets/unit-a/storage");
  });
  it("preserves actual mm and checked acknowledgement when switching metres to centimetres", () => {
    show();
    split();
    measure();
    fireEvent.click(screen.getByRole("button", { name: "Centimetres" }));
    expect(screen.getByRole("spinbutton", { name: "Length (cm)" })).toHaveValue(
      100.1,
    );
    expect(screen.getByRole("checkbox", { name: /I checked/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Metres" }));
    expect(screen.getByRole("spinbutton", { name: "Length (m)" })).toHaveValue(
      1.001,
    );
    expect(screen.getByRole("checkbox", { name: /I checked/ })).toBeChecked();
  });
  it("invalidates measurement acknowledgement when quantity changes", () => {
    show();
    split();
    measure();
    input("Unit quantity", "40");
    expect(
      screen.getByRole("checkbox", { name: /I checked/ }),
    ).not.toBeChecked();
  });
  it("copies only selected targets and requires their own acknowledgement", () => {
    show();
    split("150", "50");
    measure();
    fireEvent.click(screen.getByRole("checkbox", { name: "pallet 2" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Copy selected dimensions" }),
    );
    selectUnit(2);
    expect(screen.getByRole("spinbutton", { name: "Length (m)" })).toHaveValue(
      1.001,
    );
    expect(
      screen.getByRole("checkbox", { name: /I checked/ }),
    ).not.toBeChecked();
    selectUnit(3);
    expect(screen.getByRole("spinbutton", { name: "Length (m)" })).toHaveValue(
      null,
    );
  });
  it.each(["0", "-1", "", "0.5"])(
    "rejects invalid piece quantity %s",
    (value) => {
      show();
      split();
      input("Unit quantity", value);
      expect(
        screen.getByRole("button", { name: "Review and create" }),
      ).toBeDisabled();
    },
  );
  it("keeps decimal totals exact and adds only the remainder", () => {
    mocks.unit = "kg";
    show();
    fireEvent.change(screen.getByRole("combobox", { name: "Split method" }), {
      target: { value: "MANUAL" },
    });
    input("Batch total quantity", "0.3");
    input("Unit quantity", "0.1");
    expect(screen.getByText("Remaining: 0.2 kg")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Add unit/ }));
    expect(
      screen.getByRole("spinbutton", { name: "Unit quantity" }),
    ).toHaveValue(0.2);
    expect(screen.getByText("0.3 / 0.3")).toBeVisible();
  });
  it("uses box and other storage-unit nouns and never raw OTHER", () => {
    show();
    fireEvent.change(screen.getByRole("combobox", { name: "Packing format" }), {
      target: { value: "BOX" },
    });
    expect(
      screen.getByRole("spinbutton", { name: "Quantity per box" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "box 1", pressed: true }),
    ).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Packing format" }), {
      target: { value: "OTHER" },
    });
    expect(
      screen.getByRole("spinbutton", { name: "Quantity per storage unit" }),
    ).toBeVisible();
    expect(screen.queryByText("OTHER")).not.toBeInTheDocument();
  });
  it("keeps an uncertain commit visible in review and retries the same command", async () => {
    mocks.commit.mockRejectedValueOnce(new Error("offline"));
    show();
    prepare();
    review();
    confirm();
    const dialog = screen.getByRole("dialog");
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Retry saved request" }),
      ).toBeEnabled(),
    );
    expect(
      within(dialog).getByText("Checking the previous save"),
    ).toBeVisible();
    const first = mocks.commit.mock.calls[0]?.[0];
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Retry saved request" }),
    );
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(2));
    expect(mocks.commit.mock.calls[1]?.[0]).toEqual(first);
    await waitFor(() =>
      expect(screen.getByText("Storage units created")).toBeVisible(),
    );
  });
  it("recovers the same uncertain commit request after refresh", async () => {
    mocks.commit.mockRejectedValueOnce(new Error("offline"));
    const view = show();
    prepare();
    review();
    confirm();
    await waitFor(() =>
      expect(screen.getByText("Checking the previous save")).toBeVisible(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Retry saved request" }),
      ).toBeEnabled(),
    );
    const sent = mocks.commit.mock.calls[0]?.[0];
    view.unmount();
    show();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry saved request" }),
    );
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(2));
    expect(mocks.commit.mock.calls[1]?.[0]).toEqual(sent);
    await waitFor(() =>
      expect(screen.getByText("Storage units created")).toBeVisible(),
    );
  });
  it("recovers an uncertain save draft using the same request", async () => {
    mocks.save.mockRejectedValueOnce(new Error("offline"));
    const view = show();
    split();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Retry saved request" }),
      ).toBeEnabled(),
    );
    const sent = mocks.save.mock.calls[0]?.[0];
    view.unmount();
    show();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry saved request" }),
    );
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1]?.[0]).toEqual(sent);
  });
  it("repacking targets the existing batch with before/after review and immutable total", async () => {
    mocks.batch = {
      ...serverBatch("CREATED"),
      capacity: 25,
      packages: Array.from({ length: 4 }, () => ({
        ...packageValue,
        quantity: 25,
      })),
    };
    show("batch-a");
    expect(
      screen.getByRole("spinbutton", { name: "Batch total quantity" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save draft" }),
    ).not.toBeInTheDocument();
    input("Quantity per pallet", "50");
    fireEvent.click(screen.getByRole("button", { name: "Apply this split" }));
    measure();
    selectUnit(2);
    measure();
    fireEvent.click(screen.getByRole("button", { name: "Review repacking" }));
    expect(
      within(screen.getByRole("dialog")).getByText(
        "Before: 4 pallets → After: 2 pallets",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirm repacking" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledOnce());
    expect(mocks.commit.mock.calls[0]?.[0]).toMatchObject({
      batchId: "batch-a",
      expectedRevision: 1,
      totalQuantity: 100,
    });
  });
  it("blocks stale local edits instead of overwriting a newer batch", () => {
    mocks.batch = serverBatch();
    const view = show("batch-a");
    input("Unit quantity", "40");
    view.unmount();
    mocks.batch = serverBatch("DRAFT", 2);
    show("batch-a");
    expect(
      screen.getByText("This batch changed in another session."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Load latest batch" }));
    expect(
      screen.getByRole("spinbutton", { name: "Unit quantity" }),
    ).toHaveValue(50);
  });
  it("blocks repacking reserved, moving or stored batches", () => {
    mocks.batch = serverBatch("CREATED");
    mocks.batchEditable = false;
    show("batch-a");
    expect(
      screen.getByRole("button", { name: "Review repacking" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "This batch cannot be repacked while its units are reserved, moving or stored.",
      ),
    ).toBeVisible();
  });
  it("does not reuse a different actor’s unsaved draft", () => {
    const view = show();
    split();
    view.unmount();
    mocks.actor = "user-b";
    show();
    expect(
      screen.getByRole("spinbutton", { name: "Batch total quantity" }),
    ).toHaveValue(null);
  });
  it("stops on damaged local recovery data", () => {
    localStorage.setItem(key, '{"pending":true}');
    show();
    expect(screen.getByText("Saved batch needs recovery")).toBeVisible();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("has accessible empty, measured, and review states", async () => {
    const { container } = show();
    expect(await axe(container)).toHaveNoViolations();
    prepare();
    expect(await axe(container)).toHaveNoViolations();
    review();
    expect(await axe(document.body)).toHaveNoViolations();
  });
  it("renders Thai labels for the batch and unit flow", () => {
    show(undefined, "th");
    expect(
      screen.getByRole("spinbutton", { name: "จำนวนสินค้ารวมของชุดนี้" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "บันทึกฉบับร่าง" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "ตรวจสอบและสร้าง" }),
    ).toBeDisabled();
  });
  it("does not offer mutation controls to read-only users", () => {
    mocks.canManage = false;
    show();
    expect(
      screen.queryByRole("button", { name: "Save draft" }),
    ).not.toBeInTheDocument();
  });
  it("can explicitly reopen a completed batch using the latest server revision", async () => {
    mocks.batch = serverBatch("CREATED", 1);
    const view = show("batch-a");
    fireEvent.click(screen.getByRole("button", { name: "Review repacking" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm repacking" }));
    await waitFor(() =>
      expect(screen.getByText("Storage units created")).toBeVisible(),
    );
    view.unmount();
    mocks.batch = serverBatch("CREATED", 2);
    show("batch-a");
    fireEvent.click(screen.getByRole("button", { name: "Load latest batch" }));
    expect(
      screen.getByRole("spinbutton", { name: "Batch total quantity" }),
    ).toHaveValue(100);
    expect(
      screen.queryByText("This batch changed in another session."),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review repacking" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm repacking" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(2));
    expect(mocks.commit.mock.calls[1]?.[0]).toMatchObject({
      batchId: "batch-a",
      expectedRevision: 2,
    });
  });
  it("starts an explicitly requested next batch without reusing the completed batch ID", async () => {
    show();
    prepare();
    review();
    confirm();
    await waitFor(() =>
      expect(screen.getByText("Storage units created")).toBeVisible(),
    );
    const firstRequest = mocks.commit.mock.calls[0]?.[0].requestId;
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare another batch" }),
    );
    expect(
      screen.getByRole("spinbutton", { name: "Batch total quantity" }),
    ).toHaveValue(null);
    prepare();
    review();
    confirm();
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(2));
    expect(mocks.commit.mock.calls[1]?.[0].batchId).toBeUndefined();
    expect(mocks.commit.mock.calls[1]?.[0].requestId).not.toBe(firstRequest);
  });
  it.each(["productId", "warehouseId", "batchId"])(
    "blocks a corrupted pending %s scope before resend",
    async (field) => {
      mocks.commit.mockRejectedValueOnce(new Error("offline"));
      const view = show();
      prepare();
      review();
      confirm();
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Retry saved request" }),
        ).toBeEnabled(),
      );
      view.unmount();
      const value = JSON.parse(localStorage.getItem(key) ?? "{}");
      value.pending.payload[field] = "other-scope";
      localStorage.setItem(key, JSON.stringify(value));
      show();
      expect(screen.getByText("Saved batch needs recovery")).toBeVisible();
      expect(mocks.commit).toHaveBeenCalledTimes(1);
    },
  );
  it("keeps explicit new-batch tokens separate and restores the same token on refresh", () => {
    const tokenA = crypto.randomUUID(),
      tokenB = crypto.randomUUID();
    const renderToken = (draftToken: string) =>
      renderWithIntl(
        <PackingScreen productId="product-a" draftToken={draftToken} />,
        { locale: "en", workspace: false },
      );
    const first = renderToken(tokenA);
    split("110", "50");
    first.unmount();
    const second = renderToken(tokenB);
    expect(
      screen.getByRole("spinbutton", { name: "Batch total quantity" }),
    ).toHaveValue(null);
    split("200", "50");
    second.unmount();
    renderToken(tokenA);
    expect(
      screen.getByRole("spinbutton", { name: "Batch total quantity" }),
    ).toHaveValue(110);
    expect(
      screen.getByText(
        "Packing preview: 110 pieces → 3 pallets (50 + 50 + 10)",
      ),
    ).toBeVisible();
  });
  it("preserves the pending request when refreshing an explicit new-batch token", async () => {
    const draftToken = crypto.randomUUID();
    const renderToken = () =>
      renderWithIntl(
        <PackingScreen productId="product-a" draftToken={draftToken} />,
        { locale: "en", workspace: false },
      );
    mocks.commit.mockRejectedValueOnce(new Error("offline"));
    const first = renderToken();
    prepare();
    review();
    confirm();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Retry saved request" }),
      ).toBeEnabled(),
    );
    const sent = mocks.commit.mock.calls[0]?.[0];
    first.unmount();
    renderToken();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry saved request" }),
    );
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(2));
    expect(mocks.commit.mock.calls[1]?.[0]).toEqual(sent);
  });
  it("auto-splits a pristine box batch after selecting its packing format", () => {
    show();
    input("Batch total quantity", "110");
    fireEvent.change(screen.getByRole("combobox", { name: "Packing format" }), {
      target: { value: "BOX" },
    });
    input("Quantity per box", "50");
    expect(
      screen.getByText("Packing preview: 110 pieces → 3 boxes (50 + 50 + 10)"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "box 3", pressed: false }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Apply this split" }),
    ).not.toBeInTheDocument();
    selectUnit(3, "box");
    expect(
      screen.getByRole("spinbutton", { name: "Unit quantity" }),
    ).toHaveValue(10);
  });
  it("preserves measured entries and asks to apply a new split after a format change", () => {
    show();
    split("100", "25");
    measure();
    fireEvent.change(screen.getByRole("combobox", { name: "Packing format" }), {
      target: { value: "BOX" },
    });
    expect(
      screen.getByRole("checkbox", { name: /I checked/ }),
    ).not.toBeChecked();
    expect(screen.getByRole("spinbutton", { name: "Length (m)" })).toHaveValue(
      1.001,
    );
    input("Quantity per box", "50");
    expect(
      screen.getByRole("button", { name: "box 4", pressed: false }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Apply this split" }),
    ).toBeVisible();
  });
  it("hides retired completion links when a canonical batch has a newer revision", () => {
    mocks.batch = serverBatch("CREATED", 2);
    localStorage.setItem(
      "fg-batch-packing:user-a:warehouse-a:batch:batch-a",
      JSON.stringify({
        total: "100",
        capacity: "25",
        count: "4",
        storageFormat: "PALLET",
        lot: "",
        mode: "CAPACITY",
        customized: true,
        splitPending: false,
        displayUnit: "m",
        batchId: "batch-a",
        revision: 1,
        selected: "row-1",
        rows: [
          {
            id: "row-1",
            quantity: "25",
            length: "1",
            width: "1",
            height: "1",
            weight: "",
            checked: true,
          },
        ],
        completed: ["retired-1", "retired-2", "retired-3", "retired-4"],
      }),
    );
    show("batch-a");
    expect(
      screen.getByText("A newer packing revision is available."),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Find storage/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("100 pieces · 4 pallets"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load latest batch" }));
    expect(
      screen.getByRole("button", { name: "pallet 2", pressed: false }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "pallet 3", pressed: false }),
    ).not.toBeInTheDocument();
  });
  it("checks the current server revision before showing a product-route completion receipt", async () => {
    const view = show();
    prepare();
    review();
    confirm();
    await waitFor(() =>
      expect(screen.getByText("Storage units created")).toBeVisible(),
    );
    view.unmount();
    mocks.batch = serverBatch("CREATED", 2);
    show();
    expect(
      screen.getByText("A newer packing revision is available."),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Find storage/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load latest batch" }));
    expect(mocks.replace).toHaveBeenCalledWith(
      "/finished-goods/batches/batch-a",
    );
  });
});

it("clears stale measured weight and confirmation when a unit quantity changes", () => {
  show();
  prepare();
  input("Weight (kg, optional)", "25");
  input("Unit quantity", "40");
  expect(
    screen.getByRole("spinbutton", { name: "Weight (kg, optional)" }),
  ).toHaveValue(null);
  expect(
    screen.getByRole("checkbox", { name: /I checked this unit/ }),
  ).not.toBeChecked();
  expect(
    screen.getByRole("button", { name: "Review and create" }),
  ).toBeDisabled();
});
