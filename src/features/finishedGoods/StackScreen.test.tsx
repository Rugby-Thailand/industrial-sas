import { axe } from "jest-axe";
import type * as ClerkModule from "@clerk/nextjs";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { getFunctionName } from "convex/server";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import type { fgRefs } from "@/lib/convex/finishedGoodsApi";
import type { RefValue } from "@/lib/convex/clientRef";
import type { writeSuccess } from "@tests/fixtures/finished-goods-ui";
import { openSelect } from "@tests/fixtures/select-control";

const mocks = vi.hoisted(() => ({
  canManage: true,
  authLoaded: true,
  actorId: "user-a",
  push: vi.fn(),
  query: vi.fn<(name: string) => unknown>(),
  write:
    vi.fn<
      (name: string, args: unknown) => Promise<ReturnType<typeof writeSuccess>>
    >(),
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
  useMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.write(getFunctionName(ref), args),
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

import {
  finishedGoodsWorkspace,
  finishedGoodDestination,
  measuredPalletDetail,
  querySuccess,
  writeSuccess as success,
} from "@tests/fixtures/finished-goods-ui";
import { StackScreen } from "./StackScreen";
let data: NonNullable<RefValue<typeof fgRefs.stackOptions>>;
function mount() {
  return render(
    <NextIntlClientProvider locale="en" messages={{}}>
      <StackScreen palletId="lower" />
    </NextIntlClientProvider>,
  );
}
function chooseUpperPallet(label = "2. Upper pallet") {
  const option = within(openSelect(label)).getByRole("option", {
    name: /^P-002/,
  });
  fireEvent.keyDown(option, { key: "Enter" });
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.canManage = true;
  const lower = {
    ...measuredPalletDetail.pallet,
    _id: "lower",
    code: "P-001",
    status: "STORED" as const,
    weightKg: 100,
    stackable: true,
    maxStackLevels: 2,
  };
  const upper = {
    ...measuredPalletDetail.pallet,
    _id: "upper",
    code: "P-002",
    weightKg: 150,
  };
  data = {
    lower,
    lowerSettingsLocked: false,
    upperSettingsLocked: false,
    pallets: [upper],
    children: [],
    error: null,
    candidate: {
      ...finishedGoodDestination,
      supportPalletId: "lower",
      zMm: 1400,
      support: {
        ...finishedGoodDestination.support,
        zMm: 1400,
        heightMm: 1600,
      },
    },
  };
  mocks.query.mockImplementation(() => querySuccess(data));
  mocks.write.mockResolvedValue(success("placement-stack"));
});
it("keeps reservation disabled until an upper pallet is chosen", () => {
  data = { ...data, candidate: null };
  mount();
  expect(
    screen.getByRole("button", { name: "Reserve stack and verify" }),
  ).toBeDisabled();
  expect(
    screen.getByText("Choose an upper pallet to preview its exact position."),
  ).toBeVisible();
});
it("reserves using explicit supporting pallet identity and server-derived preview coordinates", async () => {
  mount();
  chooseUpperPallet();
  fireEvent.click(
    screen.getByRole("button", { name: "Reserve stack and verify" }),
  );
  await waitFor(() =>
    expect(mocks.write).toHaveBeenCalledWith(
      "finishedGoods/workflow:reserve",
      expect.objectContaining({ palletId: "upper", supportPalletId: "lower" }),
    ),
  );
  expect(mocks.push).toHaveBeenCalledWith("/finished-goods/pallets/upper");
});
it("uses the existing move workflow for a stored upper pallet", async () => {
  data = {
    ...data,
    pallets: data.pallets.map((p) => ({
      ...p,
      status: "STORED",
      placementId: "old-position",
    })),
  };
  mount();
  chooseUpperPallet();
  fireEvent.click(
    screen.getByRole("button", { name: "Reserve stack and prepare move" }),
  );
  await waitFor(() =>
    expect(mocks.write).toHaveBeenCalledWith(
      "finishedGoods/workflow:reserveMove",
      expect.objectContaining({
        palletId: "upper",
        supportPalletId: "lower",
        expectedSourcePlacementId: "old-position",
      }),
    ),
  );
  expect(mocks.push).toHaveBeenCalledWith("/finished-goods/pallets/upper/move");
});
it("shows level-limit failures and prevents confirmation", () => {
  data = { ...data, error: "STACK_LEVELS_EXCEEDED" };
  mount();
  chooseUpperPallet();
  expect(
    screen.getByText(
      "This would exceed the configured number of stack levels.",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Reserve stack and verify" }),
  ).toBeDisabled();
});
it("shows a useful empty state", () => {
  data = { ...data, pallets: [], candidate: null };
  mount();
  expect(
    screen.getByText(
      "No measured pallets are available. Create and measure a pallet first.",
    ),
  ).toBeVisible();
});
it("viewers cannot save limits or reserve a stack", () => {
  mocks.canManage = false;
  mount();
  chooseUpperPallet();
  expect(
    screen.queryByRole("button", { name: "Save stacking limits" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Reserve stack and verify" }),
  ).toBeDisabled();
});
it("shows recoverable mutation failures", async () => {
  mocks.write.mockRejectedValue(new Error("STACK_SUPPORT_MOVING"));
  mount();
  chooseUpperPallet();
  fireEvent.click(
    screen.getByRole("button", { name: "Reserve stack and verify" }),
  );
  expect(
    await screen.findByText(
      "The supporting pallet has an active move. Finish or cancel that move first.",
    ),
  ).toBeVisible();
  expect(mocks.push).not.toHaveBeenCalled();
});
it("requires saving edited limits before reserving", () => {
  mount();
  chooseUpperPallet();
  fireEvent.change(
    screen.getAllByRole("spinbutton", {
      name: "Maximum levels, including this pallet",
    })[0]!,
    { target: { value: "3" } },
  );
  expect(
    screen.getByRole("button", { name: "Reserve stack and verify" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("combobox", { name: "2. Upper pallet" }),
  ).toBeDisabled();
  expect(
    screen.getByText("Save the edited stacking limits before reserving."),
  ).toBeVisible();
});

it.each(["en", "th"])(
  "keeps stacking controls accessible in %s",
  async (locale) => {
    const { container } = render(
      <NextIntlClientProvider locale={locale} messages={{}}>
        <StackScreen palletId="lower" />
      </NextIntlClientProvider>,
    );
    chooseUpperPallet(locale === "th" ? "2. พาเลทด้านบน" : "2. Upper pallet");
    expect(await axe(container)).toHaveNoViolations();
  },
);

it("saves only stacking limits without weight/load configuration", async () => {
  mount();
  expect(screen.queryByLabelText(/weight|load/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save stacking limits" }));
  await waitFor(() =>
    expect(mocks.write).toHaveBeenCalledWith(
      "finishedGoods/workflow:saveStackingLimits",
      expect.objectContaining({ stackable: true, maxStackLevels: 2 }),
    ),
  );
  const args = mocks.write.mock.calls[0]![1] as Record<string, unknown>;
  expect(args).not.toHaveProperty("weightKg");
  expect(args).not.toHaveProperty("maxAboveLoadKg");
});
