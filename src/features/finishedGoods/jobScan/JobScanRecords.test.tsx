import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { writeSuccess } from "@tests/fixtures/finished-goods-ui";
import { JobScanRecordsScreen } from "./JobScanRecords";

const mocks = vi.hoisted(() => ({ assign: vi.fn() }));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.assign,
  useQuery: () => ({
    ok: true,
    value: {
      items: [
        {
          id: "scan-a",
          factoryOrder: "QA-FO-001",
          productBarcodeText: "QA-BOX",
          locationText: "QA-DOCK",
          mapped: false,
          source: "MANUAL",
          createdAt: 1791468000000,
        },
      ],
      isDone: true,
    },
  }),
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (id: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("@/hooks/useCanManage", () => ({ useCanManage: () => true }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));
vi.mock("./JobScanScreen", () => ({
  LocationSummary: ({ code }: { code: string }) => <span>{code}</span>,
}));
vi.mock("./LocationPicker", () => ({
  LocationPicker: ({
    onPick,
  }: {
    onPick: (location: { text: string; zoneId: string }) => void;
  }) => (
    <button onClick={() => onPick({ text: "QA-ZONE", zoneId: "zone-a" })}>
      Choose QA location
    </button>
  ),
}));

beforeEach(() => {
  mocks.assign.mockReset().mockResolvedValue(writeSuccess("scan-a"));
});

function selectRecord() {
  renderWithIntl(<JobScanRecordsScreen />, { locale: "en" });
  fireEvent.click(screen.getByRole("checkbox", { name: /QA-FO-001/ }));
  fireEvent.click(screen.getByRole("button", { name: /Set location for 1/ }));
}

it("retains the selection and reuses the request after an assignment response is lost", async () => {
  mocks.assign.mockRejectedValueOnce(new Error("NETWORK_ERROR"));
  selectRecord();
  fireEvent.click(screen.getByRole("button", { name: "Choose QA location" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Choose QA location" }),
    ).toBeEnabled(),
  );
  expect(screen.getByRole("checkbox", { name: /QA-FO-001/ })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Choose QA location" }));
  await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(2));
  expect(mocks.assign.mock.calls[0]![0]).toEqual(
    mocks.assign.mock.calls[1]![0],
  );
  await waitFor(() =>
    expect(
      screen.getByRole("checkbox", { name: /QA-FO-001/ }),
    ).not.toBeChecked(),
  );
});

it("locks record selection, search and location choice while assignment is pending", async () => {
  let resolve!: (value: ReturnType<typeof writeSuccess>) => void;
  mocks.assign.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  selectRecord();
  fireEvent.click(screen.getByRole("button", { name: "Choose QA location" }));
  expect(screen.getByRole("checkbox", { name: /QA-FO-001/ })).toBeDisabled();
  expect(screen.getByRole("textbox")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Choose QA location" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "All" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Choose QA location" }));
  expect(mocks.assign).toHaveBeenCalledTimes(1);
  resolve(writeSuccess("scan-a"));
  await waitFor(() => expect(screen.getByRole("textbox")).toBeEnabled());
});
