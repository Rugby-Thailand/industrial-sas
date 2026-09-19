import type * as SharedModule from "./shared";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode, ComponentProps } from "react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  write: vi.fn(),
  cameraCode: (_code: string) => {},
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.query }),
  useMutation: () => mocks.write,
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (id: string) => ReactNode }) =>
    children("warehouse"),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("./shared", async (importOriginal) => ({
  ...(await importOriginal<typeof SharedModule>()),
  useDraftKey: () => "actor",
  useCanManage: () => true,
}));
vi.mock("./PackageScanCamera", () => ({
  PackageScanCamera: ({
    onCode,
    mode,
    active,
  }: {
    onCode: (code: string) => void;
    mode: string;
    active: boolean;
  }) => {
    mocks.cameraCode = onCode;
    return (
      <div>
        <span>{mode}</span>
        <button
          disabled={!active}
          onClick={() => onCode(mode === "PACKAGES" ? "A" : "ZONE")}
        >
          Decode
        </button>
      </div>
    );
  },
}));
import { PackageScanningScreen } from "./PackageScanningScreen";
beforeEach(() => {
  mocks.query.mockReset();
  mocks.write.mockReset();
  mocks.query.mockImplementation(
    async (_ref: unknown, args: { code: string }) =>
      args.code === "A"
        ? {
            ok: true,
            value: {
              ok: true,
              unit: {
                id: "unit-A",
                code: "A",
                productName: "Widgets",
                version: 1,
                fillPercent: 50,
              },
            },
          }
        : {
            ok: true,
            value: {
              ok: true,
              location: {
                zoneId: "zone",
                code: "ZONE",
                name: "Warehouse zone",
                version: "v",
              },
            },
          },
  );
  mocks.write.mockResolvedValue({
    ok: true,
    value: { written: true, documentId: "assignment" },
  });
});
it("requires location confirmation, supports rescan/back, and submits exact manual evidence", async () => {
  const user = userEvent.setup();
  render(<PackageScanningScreen />);
  expect(screen.getByRole("button", { name: "Scan Location" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Decode" }));
  await screen.findByText("Widgets");
  await user.click(screen.getByRole("button", { name: "Scan Location" }));
  await user.click(screen.getByRole("button", { name: "Decode" }));
  await screen.findByText("Location detected");
  expect(mocks.write).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Rescan location" }));
  await user.click(screen.getByRole("button", { name: "Back to packages" }));
  expect(screen.getByText("Widgets")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Scan Location" }));
  await user.type(
    screen.getByLabelText("Manual / handheld code verification"),
    "ZONE",
  );
  await user.click(screen.getByRole("button", { name: "Check code" }));
  await screen.findByText("Location detected");
  await user.click(screen.getByRole("button", { name: "Confirm Location" }));
  await screen.findByText("Packages assigned");
  expect(mocks.write.mock.calls[0]?.[0]).toMatchObject({
    units: [{ unitId: "unit-A", version: 1, fillPercent: 50 }],
    location: { method: "MANUAL" },
    physicalConfirmed: true,
  });
});
it("retries an ambiguous network failure with the identical request and payload", async () => {
  mocks.write
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce({
      ok: true,
      value: { written: true, documentId: "assignment" },
    });
  const user = userEvent.setup();
  render(<PackageScanningScreen />);
  await user.click(screen.getByRole("button", { name: "Decode" }));
  await screen.findByText("Widgets");
  await user.click(screen.getByRole("button", { name: "Scan Location" }));
  await user.click(screen.getByRole("button", { name: "Decode" }));
  await screen.findByText("Location detected");
  await user.click(screen.getByRole("button", { name: "Confirm Location" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Retry same assignment" }),
    ).toBeEnabled(),
  );
  expect(
    screen.getByRole("button", { name: "Rescan location" }),
  ).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Retry same assignment" }),
  );
  await screen.findByText("Packages assigned");
  expect(mocks.write.mock.calls[1]?.[0]).toEqual(
    mocks.write.mock.calls[0]?.[0],
  );
});

it("preserves edited fullness when aliases resolve out of order in the live workflow", async () => {
  let finishFirst: (value: unknown) => void = () => {};
  mocks.query.mockImplementation((_ref: unknown, args: { code: string }) =>
    args.code === "A"
      ? new Promise((resolve) => {
          finishFirst = resolve;
        })
      : Promise.resolve({
          ok: true,
          value: {
            ok: true,
            unit: {
              id: "same-unit",
              code: "P-1",
              productName: "Widgets",
              version: 1,
              fillPercent: 25,
            },
          },
        }),
  );
  const user = userEvent.setup();
  render(<PackageScanningScreen />);
  await user.click(screen.getByRole("button", { name: "Decode" }));
  expect(screen.getByText("Checking…")).toBeInTheDocument();
  await user.type(
    screen.getByLabelText("Manual / handheld code verification"),
    "ALIAS",
  );
  await user.click(screen.getByRole("button", { name: "Check code" }));
  await screen.findByText("Widgets");
  const input = screen.getByLabelText("Exception %");
  await user.clear(input);
  await user.type(input, "75");
  await act(async () =>
    finishFirst({
      ok: true,
      value: {
        ok: true,
        unit: {
          id: "same-unit",
          code: "P-1",
          productName: "Widgets",
          version: 1,
          fillPercent: 25,
        },
      },
    }),
  );
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByLabelText("Exception %")).toHaveValue(75);
  await user.click(screen.getByRole("button", { name: "Half (50%)" }));
  await user.click(
    screen.getByRole("button", {
      name: "Apply common fullness to all packages",
    }),
  );
  expect(screen.getByText("50% full")).toBeInTheDocument();
});

it("ignores camera callbacks captured before a mode change", async () => {
  const user = userEvent.setup();
  render(<PackageScanningScreen />);
  const oldCallback = mocks.cameraCode;
  await user.click(screen.getByRole("button", { name: "Decode" }));
  await screen.findByText("Widgets");
  await user.click(screen.getByRole("button", { name: "Scan Location" }));
  const before = mocks.query.mock.calls.length;
  await act(async () => oldCallback("LATE-PACKAGE"));
  expect(mocks.query).toHaveBeenCalledTimes(before);
  expect(screen.queryByText("Location detected")).not.toBeInTheDocument();
});

it("explains why invalid scans block location and recovers after removal", async () => {
  mocks.query.mockResolvedValueOnce({
    ok: true,
    value: { ok: false, error: { code: "NOT_FOUND" } },
  });
  const user = userEvent.setup();
  render(<PackageScanningScreen />);
  await user.type(
    screen.getByLabelText("Manual / handheld code verification"),
    "8859748903645",
  );
  await user.click(screen.getByRole("button", { name: "Check code" }));
  await screen.findByText(/Code not found in this warehouse/);
  expect(screen.getByRole("button", { name: "Scan Location" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Scan Location" }),
  ).toHaveAccessibleDescription(
    "Remove the unrecognized or unavailable packages above to continue.",
  );
  await user.click(screen.getByRole("button", { name: "Decode" }));
  await screen.findByText("Widgets");
  expect(screen.getByRole("button", { name: "Scan Location" })).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Remove 8859748903645" }),
  );
  expect(screen.getByRole("button", { name: "Scan Location" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Scan Location" }));
  expect(screen.getByText("LOCATION")).toBeInTheDocument();
});
