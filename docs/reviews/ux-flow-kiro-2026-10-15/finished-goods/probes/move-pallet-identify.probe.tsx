import { messagesFor } from "@/i18n/messages";
import type * as ClerkModule from "@clerk/nextjs";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { getFunctionName } from "convex/server";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import type { PalletDetail } from "@/lib/convex/finishedGoodsApi";
import type { writeSuccess } from "@tests/fixtures/finished-goods-ui";

// FG-UX-04: during "Start move", manual pallet identification on the client is
// an exact, case-sensitive comparison, while startMove accepts a MANUAL code
// case-insensitively (convex/finishedGoods/workflow.ts startMove).
// Harness copied from src/features/finishedGoods/MoveScreen.test.tsx.

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  query: vi.fn<(name: string) => unknown>(),
  write:
    vi.fn<
      (name: string, args: unknown) => Promise<ReturnType<typeof writeSuccess>>
    >(),
}));
vi.mock("@clerk/nextjs", async (importOriginal) => {
  const actual = await importOriginal<typeof ClerkModule>();
  return { ...actual, useAuth: () => ({ isLoaded: true, userId: "user-a" }) };
});
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspaceModule>();
  return { ...actual, useWorkspace: () => finishedGoodsWorkspace };
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
  useRouter: () => ({
    push: mocks.push,
    back: () => window.history.back(),
    replace: mocks.replace,
  }),
}));

import {
  finishedGoodsWorkspace,
  finishedGoodDestination,
  finishedGoodPlacement,
  querySuccess,
  reservedPalletDetail,
  writeSuccess as success,
} from "@tests/fixtures/finished-goods-ui";
import { MoveScreen } from "@/features/finishedGoods/MoveScreen";

const stored: PalletDetail = {
  ...reservedPalletDetail,
  pallet: { ...reservedPalletDetail.pallet, status: "STORED" },
  placement: { ...finishedGoodPlacement, status: "STORED" },
};
const reservedMove: PalletDetail = {
  ...stored,
  activeMove: {
    _id: "move-a",
    _creationTime: 1000,
    orgId: "org-a",
    warehouseId: "warehouse-a",
    palletId: "pallet-a",
    sourcePlacementId: "placement-a",
    targetPlacementId: "placement-b",
    sourceUpdatedAt: 1000,
    targetUpdatedAt: 1000,
    palletUpdatedAt: 1000,
    ownerUserId: "user-a",
    status: "RESERVED",
    createdAt: 1000,
    updatedAt: 1000,
    createdByUserId: "user-a",
    updatedByUserId: "user-a",
    sourcePlacement: stored.placement,
    targetPlacement: { ...finishedGoodPlacement, _id: "placement-b", xMm: 500 },
    sourceDestination: finishedGoodDestination,
    targetDestination: { ...finishedGoodDestination, xMm: 500 },
    isOwner: true,
    canManageMove: true,
    destinationVerifiedForCurrentUser: false,
  },
} as PalletDetail;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mocks.push.mockReset();
  mocks.replace.mockReset();
  mocks.write.mockReset().mockResolvedValue(success("move-a"));
  mocks.query
    .mockReset()
    .mockImplementation((name) =>
      name.endsWith(":getPallet")
        ? querySuccess(reservedMove)
        : querySuccess({ candidates: [], reasons: [] }),
    );
  render(
    <NextIntlClientProvider
      locale="en"
      messages={messagesFor("en")}
      timeZone="Asia/Bangkok"
    >
      <MoveScreen palletId="pallet-a" />
    </NextIntlClientProvider>,
  );
});
function enterPalletCode(value: string) {
  fireEvent.click(screen.getByRole("button", { name: "Scan QR (optional)" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Pallet code" }), {
    target: { value },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify entered code" }));
}

it("CONTROL: the exact printed code identifies the pallet", async () => {
  expect(reservedMove.pallet.code).toBe("P-001");
  enterPalletCode("P-001");
  expect(await screen.findByText("Pallet identified")).toBeVisible();
});

it("DESIRED: a manually typed code identifies the pallet the same way startMove does (case-insensitive)", async () => {
  enterPalletCode("p-001");
  await waitFor(() =>
    expect(
      screen.queryByText("Pallet identified") ??
        screen.queryByText(/This code does not identify/),
    ).not.toBeNull(),
  );
  expect(screen.queryByText(/This code does not identify/)).toBeNull();
  expect(screen.getByText("Pallet identified")).toBeVisible();
});
