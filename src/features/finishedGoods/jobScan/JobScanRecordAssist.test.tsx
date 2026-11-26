import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import { trackAppHistory } from "@/lib/browser/appHistory";
import type { RefValue } from "@/lib/convex/clientRef";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import {
  getTestMutation,
  registerTestMutation,
} from "@tests/fixtures/convex-mutation";
import { querySuccess, writeSuccess } from "@tests/fixtures/finished-goods-ui";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { JobScanRecordAssist } from "./JobScanRecordAssist";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  mutation: vi.fn(),
  interpret: vi.fn(),
  history: {} as Record<string, unknown>,
}));
vi.mock("@/hooks/useDraftKey", () => ({
  useDraftKey: (scope: string) => `${scope}:user`,
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  Link: () => null,
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.resolve }),
  useQuery: () => querySuccess(mocks.history),
  useMutation: getTestMutation,
}));

const record: RefValue<typeof fgRefs.listJobScans>["items"][number] = {
  id: "scan-a",
  factoryOrder: "FO12345",
  productBarcodeText: "SKU-A",
  locationText: "Dock",
  source: "AI",
  mapped: false,
  version: 3,
  createdAt: 1000,
  updatedAt: 1000,
  quantity: 24,
  partName: "Original product",
  customer: undefined,
  deliveryDate: undefined,
  manufacturingDate: undefined,
  factoryQuantity: undefined,
  customerQuantity: undefined,
  imageUrl: undefined,
  storageFormat: undefined,
  locationCode: undefined,
  locationName: undefined,
  buildingName: undefined,
  floorNumber: undefined,
};
const origin = "/th/finished-goods/scan?warehouse=one#camera";
const records = "/en/finished-goods/scan/records?warehouse=one#results";
beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(writeSuccess("scan-a"));
  mocks.interpret
    .mockReset()
    .mockResolvedValue({ locationCode: "F2-L12-3", fields: { quantity: 40 } });
  mocks.resolve.mockReset().mockResolvedValue({
    ok: true,
    value: {
      ok: true,
      location: { locationId: "location-a", code: "F2-L12-3" },
    },
  });
  mocks.history = { complete: true, items: [], current: record };
  registerTestMutation(fgRefs.updateJobScan, mocks.mutation);
  window.history.replaceState({ __NA: true }, "", origin);
  trackAppHistory();
  window.history.pushState({ __NA: true }, "", records);
});

function UI({ version = record.version }: { version?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <NavigationGuardProvider>
      <button onClick={() => setOpen(true)}>Open AI edit</button>
      {open && (
        <JobScanRecordAssist
          enabled
          record={{ ...record, version }}
          warehouseId="warehouse-a"
          interpret={mocks.interpret}
          onClose={() => setOpen(false)}
          onManualEdit={() => setOpen(false)}
        />
      )}
    </NavigationGuardProvider>
  );
}

const command = "Move to F2-L12-3 and set quantity to 40";
async function start(prompt = command) {
  const view = renderWithIntl(<UI />, {
    locale: "en",
    workspace: false,
    preserveProviders: true,
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open AI edit" }));
  await user.type(
    screen.getByRole("textbox", { name: "What should change?" }),
    prompt,
  );
  return { view, user };
}

async function propose(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Review changes" }));
  return within(await screen.findByRole("dialog", { name: "Review changes" }));
}

it("resolves a multiword destination in the warehouse before offering a move for confirmation", async () => {
  mocks.interpret.mockResolvedValueOnce({ locationCode: "DOCK NORTH" });
  mocks.resolve.mockResolvedValueOnce({
    ok: true,
    value: {
      ok: true,
      location: { locationId: "location-a", code: "DOCK NORTH" },
    },
  });
  const { user } = await start("Move to DOCK NORTH");
  const review = await propose(user);
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(
    fgRefs.resolveJobScanLocation,
    { warehouseId: "warehouse-a", code: "DOCK NORTH" },
  );
  expect(review.getByText("DOCK NORTH")).toBeVisible();
  expect(mocks.mutation).not.toHaveBeenCalled();
});

it("reviews both values, saves the same version atomically and consumes both dialogs before the next Back", async () => {
  const { user } = await start();
  const review = await propose(user);
  expect(review.getByText("Dock")).toBeVisible();
  expect(review.getByText("F2-L12-3")).toBeVisible();
  expect(review.getByText("24")).toBeVisible();
  expect(review.getByText("40")).toBeVisible();
  expect(mocks.mutation).not.toHaveBeenCalled();
  await user.click(review.getByRole("button", { name: "Confirm and save" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(mocks.mutation).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      warehouseId: "warehouse-a",
      jobScanId: "scan-a",
      expectedVersion: 3,
      ticketPatch: { quantity: 40 },
      location: { locationId: "location-a" },
    }),
  );
  expect(
    window.location.pathname + window.location.search + window.location.hash,
  ).toBe(records);
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe(origin),
  );
});

it("native Back closes AI review first, retains the request and does not save", async () => {
  const { user } = await start();
  await propose(user);
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Review changes" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("textbox", { name: "What should change?" }),
  ).toHaveValue(command);
  expect(mocks.mutation).not.toHaveBeenCalled();
  act(() => window.history.forward());
  expect(
    await screen.findByRole("dialog", { name: "Review changes" }),
  ).toBeVisible();
  expect(mocks.interpret).toHaveBeenCalledOnce();
});

it("protects a pending AI save and retries the immutable command after a lost response", async () => {
  let reject!: () => void;
  mocks.mutation.mockImplementationOnce(
    () =>
      new Promise((_resolve, rejectAttempt) => {
        reject = () => rejectAttempt(new Error("response lost"));
      }),
  );
  const { user, view } = await start();
  const review = await propose(user);
  await user.click(review.getByRole("button", { name: "Confirm and save" }));
  await waitFor(() => expect(mocks.mutation).toHaveBeenCalledOnce());
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      screen.getByRole("dialog", { name: "Review changes" }),
    ).toBeVisible(),
  );
  await act(async () => reject());
  const retry = await review.findByRole("button", { name: "Retry correction" });
  view.rerender(<UI version={4} />);
  expect(retry).toBeEnabled();
  await user.click(retry);
  await waitFor(() => expect(mocks.mutation).toHaveBeenCalledTimes(2));
  expect(mocks.mutation.mock.calls[1]).toEqual(mocks.mutation.mock.calls[0]);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

it("refuses unknown locations and disables new writes when the reviewed ticket changes", async () => {
  mocks.resolve.mockResolvedValueOnce({ ok: true, value: { ok: false } });
  const { user, view } = await start();
  await user.click(screen.getByRole("button", { name: "Review changes" }));
  expect(
    await screen.findByText(/location could not be verified/i),
  ).toBeVisible();
  expect(mocks.mutation).not.toHaveBeenCalled();
  const review = await propose(user);
  view.rerender(<UI version={4} />);
  expect(
    review.getByRole("button", { name: "Confirm and save" }),
  ).toBeDisabled();
  expect(mocks.mutation).not.toHaveBeenCalled();
});

it("blocks an unreviewed customer link change and points back to the full ticket editor", async () => {
  mocks.interpret.mockResolvedValueOnce({ fields: { customer: "Beta Co" } });
  mocks.mutation.mockResolvedValueOnce(
    querySuccess({
      written: false,
      error: { code: "CUSTOMER_LINK_REVIEW_REQUIRED", field: "customer" },
    }),
  );
  const { user } = await start();
  const review = await propose(user);
  expect(review.getByText("Beta Co")).toBeVisible();
  const save = review.getByRole("button", { name: "Confirm and save" });
  await user.click(save);
  expect(await review.findByRole("alert")).toHaveTextContent(
    "Use the ticket editor to review this customer link change.",
  );
  expect(save).toBeDisabled();
  expect(mocks.mutation).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ ticketPatch: { customer: "Beta Co" } }),
  );
  await user.click(review.getByRole("button", { name: "Edit request" }));
  expect(
    await screen.findByRole("button", { name: "Correct ticket details" }),
  ).toBeEnabled();
});
