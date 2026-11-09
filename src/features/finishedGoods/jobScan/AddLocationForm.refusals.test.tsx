import {
  getTestMutation,
  registerTestMutation,
} from "@tests/fixtures/convex-mutation";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { querySuccess, writeFailure } from "@tests/fixtures/finished-goods-ui";
import { AddLocationForm } from "./AddLocationForm";

// Regression: jobScanLocations.create refuses an existing location code with
// { code: "DUPLICATE_KEY", field: "code" } and an inactive/removed building with
// { code: "REFERENCE_NOT_FOUND", field: "buildingId" } (convex/finishedGoods/
// jobScanLocations.ts). The form resolves both through the finished-goods
// product catalogue (FG_*), so the location-code field reads a product SKU
// message and the building field reads the generic connection error.

const mocks = vi.hoisted(() => ({ create: vi.fn(), resolve: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("convex/react", () => ({
  useMutation: getTestMutation,
  useConvex: () => ({ query: mocks.resolve }),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip"
      ? undefined
      : getFunctionName(ref).endsWith(":options")
        ? querySuccess({
            buildings: [
              {
                id: "building-a",
                code: "A",
                name: "Building A",
                floors: [{ id: "floor-1", number: 1 }],
              },
            ],
          })
        : querySuccess({ ok: false, error: { code: "LOCATION_UNAVAILABLE" } }),
}));
beforeEach(() => {
  registerTestMutation(fgRefs.createJobScanLocation, mocks.create);
  mocks.create.mockReset();
  mocks.resolve.mockReset();
});

async function submitWith(failure: ReturnType<typeof writeFailure>) {
  mocks.create.mockResolvedValue(failure);
  renderWithIntl(
    <AddLocationForm
      warehouseId="warehouse-a"
      initialCode="DOCK-9"
      onPick={vi.fn()}
      onCancel={vi.fn()}
    />,
    { locale: "en", preserveProviders: true },
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Building" }));
  await user.click(screen.getByRole("option", { name: "A · Building A" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Create and use location" }),
  );
  return (await screen.findByRole("alert")).textContent ?? "";
}

it("describes a duplicate location code as a location, not a product SKU", async () => {
  const message = await submitWith(writeFailure("DUPLICATE_KEY", "code"));
  console.info(JSON.stringify({ duplicateCodeMessage: message }));
  const mentionsSku = /SKU|product/i.test(message) ? 1 : 0;
  expect(mentionsSku).toBe(0);
});

it("names the unavailable building instead of a generic connection error", async () => {
  const message = await submitWith(
    writeFailure("REFERENCE_NOT_FOUND", "buildingId"),
  );
  console.info(JSON.stringify({ missingBuildingMessage: message }));
  const generic = /connection/i.test(message) ? 1 : 0;
  expect(generic).toBe(0);
});
