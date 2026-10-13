import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  writeFailure,
  writeSuccess,
  querySuccess,
} from "@tests/fixtures/finished-goods-ui";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import { JobScanRecordEditor } from "./JobScanRecordEditor";
import { useState } from "react";
import { trackAppHistory } from "@/lib/browser/appHistory";
import type { RefValue } from "@/lib/convex/clientRef";
import type { fgRefs } from "@/lib/convex/finishedGoodsApi";

const mocks = vi.hoisted(() => ({ save: vi.fn(), close: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  Link: () => null,
}));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.save,
  useQuery: () => querySuccess({ complete: true, items: [] }),
}));
const record: RefValue<typeof fgRefs.listJobScans>["items"][number] = {
  partName: undefined,
  customer: undefined,
  deliveryDate: undefined,
  manufacturingDate: undefined,
  quantity: undefined,
  factoryQuantity: undefined,
  customerQuantity: undefined,
  imageUrl: undefined,
  storageFormat: undefined,
  locationCode: undefined,
  locationName: undefined,
  buildingName: undefined,
  floorNumber: undefined,
  id: "scan-a",
  factoryOrder: "FO12345",
  productBarcodeText: "SKU-A",
  locationText: "Dock",
  mapped: false,
  source: "AI",
  createdAt: 1000,
  version: 3,
  updatedAt: 1000,
};
beforeEach(() => {
  window.history.replaceState(
    { __NA: true },
    "",
    "/en/finished-goods/scan/records?status=ALL#rows",
  );
  mocks.save.mockReset().mockResolvedValue(writeSuccess("scan-a"));
  mocks.close.mockReset();
});
function show() {
  return renderWithIntl(
    <NavigationGuardProvider>
      <JobScanRecordEditor
        record={record}
        warehouseId="warehouse-a"
        onClose={mocks.close}
      />
    </NavigationGuardProvider>,
    { locale: "en", workspace: false, preserveProviders: true },
  );
}
it("saves only ticket fields with the reviewed version and preserves correction after conflict", async () => {
  mocks.save.mockResolvedValueOnce(writeFailure("STALE_REVISION"));
  show();
  fireEvent.change(screen.getByRole("textbox", { name: "Job No." }), {
    target: { value: "FO99999" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Save correction" }),
    ).toBeEnabled(),
  );
  expect(screen.getByRole("textbox", { name: "Job No." })).toHaveValue(
    "FO99999",
  );
  expect(mocks.close).not.toHaveBeenCalled();
  const first = mocks.save.mock.calls[0]![0];
  expect(first).toMatchObject({
    jobScanId: "scan-a",
    expectedVersion: 3,
    warehouseId: "warehouse-a",
    fields: { factoryOrder: "FO99999", productBarcodeText: "SKU-A" },
  });
  expect(first.fields).not.toHaveProperty("locationId");
  expect(first.fields).not.toHaveProperty("source");
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[1]![0]).toEqual(first);
});
it("retains a stale correction draft until the user explicitly loads the current ticket", async () => {
  const view = show();
  fireEvent.change(screen.getByRole("textbox", { name: "Job No." }), {
    target: { value: "FO99999" },
  });
  view.rerender(
    <NavigationGuardProvider>
      <JobScanRecordEditor
        record={{ ...record, version: 4, productBarcodeText: "SERVER-SKU" }}
        warehouseId="warehouse-a"
        onClose={mocks.close}
      />
    </NavigationGuardProvider>,
  );
  expect(
    screen.getByRole("button", { name: "Save correction" }),
  ).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "Job No." })).toHaveValue(
    "FO99999",
  );
  fireEvent.click(screen.getByRole("button", { name: "Load current ticket" }));
  expect(screen.getByRole("textbox", { name: "Product barcode" })).toHaveValue(
    "SERVER-SKU",
  );
  expect(mocks.save).not.toHaveBeenCalled();
});
it("guards dirty ticket Cancel and keeps the correction when dismissal is canceled", async () => {
  show();
  fireEvent.change(screen.getByRole("textbox", { name: "Job No." }), {
    target: { value: "FO99999" },
  });
  fireEvent.click(screen.getAllByRole("button", { name: "Cancel" }).at(-1)!);
  await waitFor(() =>
    expect(
      screen.getByRole("dialog", { name: "Save changes before leaving?" }),
    ).toBeVisible(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByRole("textbox", { name: "Job No." })).toHaveValue(
    "FO99999",
  );
  expect(mocks.close).not.toHaveBeenCalled();
});

function OwnedCorrection() {
  const [open, setOpen] = useState(true);
  return (
    <NavigationGuardProvider>
      {open ? (
        <JobScanRecordEditor
          record={record}
          warehouseId="warehouse-a"
          onClose={() => {
            mocks.close();
            setOpen(false);
          }}
        />
      ) : (
        <p>Correction closed</p>
      )}
    </NavigationGuardProvider>
  );
}
it.each(["Cancel", "Save correction"])(
  "ticket %s consumes its editor before the next native Back",
  async (action) => {
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/en/finished-goods/scan?source=kept#scan",
    );
    const stop = trackAppHistory();
    window.history.pushState(
      {},
      "",
      "/en/finished-goods/scan/records?status=ALL#rows",
    );
    const view = renderWithIntl(<OwnedCorrection />, {
      locale: "en",
      workspace: false,
    });
    try {
      if (action === "Save correction") {
        fireEvent.change(screen.getByRole("textbox", { name: "Job No." }), {
          target: { value: "FO99999" },
        });
      }
      fireEvent.click(screen.getAllByRole("button", { name: action }).at(-1)!);
      await screen.findByText("Correction closed");
      await waitFor(() =>
        expect(window.location.search + window.location.hash).toBe(
          "?status=ALL#rows",
        ),
      );
      act(() => window.history.back());
      await waitFor(() =>
        expect(window.location.pathname).toBe("/en/finished-goods/scan"),
      );
      expect(window.location.search + window.location.hash).toBe(
        "?source=kept#scan",
      );
      expect(mocks.close).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
      stop();
    }
  },
);

it("retries an accepted ticket correction after losing the response and observing the advanced revision", async () => {
  mocks.save.mockRejectedValueOnce(
    new Error("Response lost after server committed"),
  );
  const view = show();
  fireEvent.change(screen.getByRole("textbox", { name: "Job No." }), {
    target: { value: "FO99999" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await screen.findByRole("button", { name: "Retry correction" });
  const original = mocks.save.mock.calls[0]![0];
  view.rerender(
    <NavigationGuardProvider>
      <JobScanRecordEditor
        record={{
          ...record,
          factoryOrder: "FO99999",
          version: 4,
          updatedAt: 1001,
        }}
        warehouseId="warehouse-a"
        onClose={mocks.close}
      />
    </NavigationGuardProvider>,
  );
  expect(screen.getByRole("textbox", { name: "Job No." })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry correction" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[1]![0]).toEqual(original);
  expect(original.expectedVersion).toBe(3);
  await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
});
it("keeps normal new correction writes blocked on a newer revision after a known rejection", async () => {
  mocks.save.mockResolvedValueOnce(writeFailure("STALE_REVISION"));
  const view = show();
  fireEvent.change(screen.getByRole("textbox", { name: "Job No." }), {
    target: { value: "FO99999" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Save correction" }),
    ).toBeEnabled(),
  );
  view.rerender(
    <NavigationGuardProvider>
      <JobScanRecordEditor
        record={{ ...record, version: 4, updatedAt: 1001 }}
        warehouseId="warehouse-a"
        onClose={mocks.close}
      />
    </NavigationGuardProvider>,
  );
  expect(
    screen.getByRole("button", { name: "Save correction" }),
  ).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Retry correction" })).toBeNull();
  expect(mocks.save).toHaveBeenCalledOnce();
});
