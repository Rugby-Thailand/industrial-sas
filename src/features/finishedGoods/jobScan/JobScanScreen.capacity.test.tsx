import type { ComponentProps, ReactNode } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../../../../convex/schema";
import { saveJobScans } from "../../../../convex/finishedGoods/jobScans";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "@tests/fixtures/convex-tenant-world";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { JobScanScreen } from "./JobScanScreen";
import type * as PreparePhotoModule from "./prepareJobTicketPhoto";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  imageCodes: undefined as ((codes: string[]) => void) | undefined,
  warehouseId: "warehouse-a",
  decode: undefined as ((code: string) => void) | undefined,
  photos: undefined as ((files: File[]) => boolean | void) | undefined,
  maxPhotos: undefined as number | undefined,
}));
vi.mock("@/features/finishedGoods/BarcodeCameraBox", () => ({
  BarcodeCameraBox: ({
    onImageCodes,
    onCode,
    feedback,
  }: {
    onImageCodes: (codes: string[]) => void;
    onCode: (code: string) => void;
    feedback?: string;
  }) => {
    mocks.imageCodes = onImageCodes;
    mocks.decode = onCode;
    return (
      <div>Inventory scanner{feedback && <p role="status">{feedback}</p>}</div>
    );
  },
}));
vi.mock("@/features/finishedGoods/jobScan/LocationPicker", () => ({
  LocationPicker: ({
    onPick,
  }: {
    onPick: (location: { text: string }) => void;
  }) => <button onClick={() => onPick({ text: "Dock" })}>Pick Dock</button>,
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (id: string) => ReactNode }) =>
    children(mocks.warehouseId),
}));
vi.mock("@/hooks/useDraftKey", () => ({
  useDraftKey: () => "inventory-actor",
}));
vi.mock("@/hooks/useCanManage", () => ({ useCanManage: () => true }));
vi.mock("@/lib/uploadthing", () => ({
  useUploadThing: () => ({ startUpload: vi.fn() }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.save,
  useAction: () => vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("./PhotoCapture", () => ({
  PhotoCapture: ({
    onSubmit,
    selection,
  }: {
    onSubmit: (files: File[]) => boolean | void;
    selection: { limit: number };
  }) => {
    mocks.photos = onSubmit;
    mocks.maxPhotos = selection.limit;
    return <div>Inventory photo panel</div>;
  },
}));
vi.mock("./prepareJobTicketPhoto", async (original) => ({
  ...(await original<typeof PreparePhotoModule>()),
  prepareJobTicketPhoto: () => Promise.reject(new Error("Bad test photo")),
}));
beforeEach(() => {
  mocks.save.mockReset();
  window.history.replaceState(
    { appNavigationIndex: 1 },
    "",
    "/en/finished-goods/scan",
  );
  vi.spyOn(URL, "createObjectURL").mockImplementation(
    () => `blob:${crypto.randomUUID()}`,
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
function start() {
  renderWithIntl(<JobScanScreen />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "Pick Dock" }));
}
function scanPairs(count: number) {
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
  act(() => {
    for (let i = 0; i < count; i++)
      mocks.imageCodes?.([`FO${String(i).padStart(5, "0")}`, `PRODUCT-${i}`]);
  });
}

it("INV-09 rejects the 51st ticket before save and persists the accepted 50 through the actual backend", async () => {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  mocks.warehouseId = world.warehouses.alphaA;
  mocks.save.mockImplementation((args: unknown) =>
    world.t
      .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
      .run((ctx) =>
        (
          saveJobScans as unknown as {
            _handler: (
              ctx: GenericMutationCtx<DataModel>,
              args: unknown,
            ) => Promise<unknown>;
          }
        )._handler(ctx as GenericMutationCtx<DataModel>, args),
      ),
  );
  start();
  scanPairs(51);
  expect(screen.getAllByRole("textbox", { name: /Job No\./ })).toHaveLength(50);
  expect(
    screen.queryByRole("button", { name: "Save 51 tickets" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
  expect(screen.getByRole("button", { name: "Save 50 tickets" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Save 50 tickets" }));
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Saved 50 tickets" }),
    ).toBeVisible(),
  );
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(
    await world.t.run((ctx) => ctx.db.query("finishedGoodsJobScans").collect()),
  ).toHaveLength(50);
}, 20000);

it("caps manual additions and permits completing an existing 50th ticket with a single barcode", () => {
  start();
  fireEvent.click(screen.getByRole("button", { name: "Manual" }));
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
  act(() => {
    for (let i = 0; i < 49; i++)
      mocks.imageCodes?.([`FO${String(i).padStart(5, "0")}`, `PRODUCT-${i}`]);
    mocks.decode?.("FO99999");
    mocks.decode?.("LAST-PRODUCT");
    mocks.decode?.("FO88888");
  });
  expect(screen.getAllByRole("textbox", { name: /Job No\./ })).toHaveLength(50);
  expect(
    screen.getAllByRole("textbox", { name: /Product barcode/ }).at(-1),
  ).toHaveValue("LAST-PRODUCT");
  expect(screen.getByText(/This group holds up to 50 tickets/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Manual" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Scan code" }));
  expect(screen.getAllByRole("textbox", { name: /Job No\./ })).toHaveLength(50);
  expect(screen.getByRole("button", { name: "Save 50 tickets" })).toBeEnabled();
}, 20000);

it("rejects an oversized multi-code image atomically without keeping only part of its tickets", () => {
  start();
  scanPairs(49);
  act(() => mocks.imageCodes?.(["FO60000", "FO60001", "NEW-A", "NEW-B"]));
  expect(screen.getAllByRole("textbox", { name: /Job No\./ })).toHaveLength(49);
  expect(screen.queryByDisplayValue("FO60000")).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue("FO60001")).not.toBeInTheDocument();
}, 20000);

it("caps repeated photo groups and leaves an oversized group in its panel for correction", async () => {
  start();
  const files = (n: number) =>
    Array.from(
      { length: n },
      (_, i) => new File(["photo"], `ticket-${i}.jpg`, { type: "image/jpeg" }),
    );
  for (let i = 0; i < 2; i++) {
    fireEvent.click(screen.getByRole("button", { name: "Photo AI" }));
    act(() => {
      expect(mocks.photos?.(files(20))).toBe(true);
    });
  }
  await waitFor(() =>
    expect(screen.getAllByRole("textbox", { name: /Job No\./ })).toHaveLength(
      40,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Photo AI" }));
  expect(mocks.maxPhotos).toBe(10);
  act(() => {
    expect(mocks.photos?.(files(11))).toBe(false);
  });
  expect(screen.getByText("Inventory photo panel")).toBeVisible();
  expect(screen.getByText(/This group holds up to 50 tickets/)).toBeVisible();
  expect(screen.getAllByRole("textbox", { name: /Job No\./ })).toHaveLength(40);
  expect(mocks.save).not.toHaveBeenCalled();
}, 20000);

it("saves a ticket acquired just before submit without silently dropping it from an older render", async () => {
  mocks.save.mockResolvedValue({
    ok: true,
    requestId: "save",
    value: { written: true, replayed: false, documentId: "scan" },
  });
  start();
  scanPairs(49);
  const submit = screen.getByRole("button", { name: "Save 49 tickets" });
  act(() => {
    mocks.imageCodes?.(["FO99999", "LAST-PRODUCT"]);
    fireEvent.click(submit);
  });
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0]?.[0].items).toHaveLength(50);
  expect(
    await screen.findByRole("heading", { name: "Saved 50 tickets" }),
  ).toBeVisible();
}, 20000);
