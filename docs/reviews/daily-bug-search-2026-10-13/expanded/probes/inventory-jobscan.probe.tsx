import type { ComponentProps, ReactNode } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../../../../../convex/schema";
import { saveJobScans } from "../../../../../convex/finishedGoods/jobScans";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../../../../../tests/fixtures/convex-tenant-world";
import { renderWithIntl } from "../../../../../tests/fixtures/intl-render";
import { JobScanScreen } from "../../../../../src/features/finishedGoods/jobScan/JobScanScreen";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  imageCodes: undefined as ((codes: string[]) => void) | undefined,
  warehouseId: "",
}));
vi.mock("@/features/finishedGoods/BarcodeCameraBox", () => ({
  BarcodeCameraBox: ({
    onImageCodes,
  }: {
    onImageCodes: (codes: string[]) => void;
  }) => {
    mocks.imageCodes = onImageCodes;
    return <div>Inventory scanner</div>;
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

it("INV-09 a 51-ticket group must not offer a save the actual backend always refuses", async () => {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  mocks.warehouseId = world.warehouses.alphaA;
  let backendResult: unknown;
  mocks.save.mockImplementation(async (args: unknown) => {
    backendResult = await world.t
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
      );
    return backendResult;
  });
  window.history.replaceState(
    { appNavigationIndex: 1 },
    "",
    "/en/finished-goods/scan",
  );
  renderWithIntl(<JobScanScreen />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "Pick Dock" }));
  fireEvent.click(screen.getByRole("button", { name: "Scan barcode" }));
  act(() => {
    for (let i = 0; i < 51; i++)
      mocks.imageCodes?.([`FO${String(i).padStart(5, "0")}`, `PRODUCT-${i}`]);
  });
  const saveButton = screen.getByRole("button", { name: "Save 51 tickets" });
  console.log(
    "INV-09 UI collection/save",
    screen.getAllByRole("textbox", { name: /Job No\./ }).length,
    !saveButton.hasAttribute("disabled"),
  );
  fireEvent.click(saveButton);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  await waitFor(() => expect(backendResult).toBeDefined());
  console.log("INV-09 real backend", JSON.stringify(backendResult));
  expect(
    await world.t.run((ctx) => ctx.db.query("finishedGoodsJobScans").collect()),
  ).toHaveLength(0);
  expect(saveButton).toBeDisabled();
}, 20_000);
