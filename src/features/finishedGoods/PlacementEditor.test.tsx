import { messagesFor } from "@/i18n/messages";
import type * as ClerkModule from "@clerk/nextjs";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { getFunctionName } from "convex/server";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import type { Candidate, PalletDetail } from "@/lib/convex/finishedGoodsApi";
import type { writeSuccess } from "@tests/fixtures/finished-goods-ui";

const mocks = vi.hoisted(() => ({
  canManage: true,
  authLoaded: true,
  actorId: "user-a",
  push: vi.fn(),
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
  useQuery: () => undefined,
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
  finishedGoodPlacement,
  reservedPalletDetail,
  writeSuccess as success,
} from "@tests/fixtures/finished-goods-ui";
import { PlacementEditor } from "./PlacementEditor";

const callsFor = (name: string) =>
  mocks.write.mock.calls.filter(([method]) => method.endsWith(`:${name}`));

// A stored pallet with a valid source so the moving reservation path is active.
const storedDetail: PalletDetail = {
  ...reservedPalletDetail,
  pallet: { ...reservedPalletDetail.pallet, status: "STORED" },
  placement: { ...finishedGoodPlacement, status: "STORED" },
};
// Shift the destination so the editor is not "unchanged" from the source.
const movedCandidate: Candidate = { ...finishedGoodDestination, xMm: 500 };

function renderEditor(onReserved: () => void) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={messagesFor("en")}
      timeZone="Asia/Bangkok"
    >
      <PlacementEditor
        warehouseId="warehouse-a"
        detail={storedDetail}
        candidate={movedCandidate}
        destinations={[movedCandidate]}
        moving
        onReserved={onReserved}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mocks.canManage = true;
  mocks.authLoaded = true;
  mocks.actorId = "user-a";
  mocks.write.mockResolvedValue(success("move-a"));
});

it("reserves a move and navigates on a current success", async () => {
  const onReserved = vi.fn();
  renderEditor(onReserved);
  fireEvent.click(
    screen.getByRole("button", { name: "Reserve this position" }),
  );
  await waitFor(() => expect(callsFor("reserveMove")).toHaveLength(1));
  await waitFor(() =>
    expect(mocks.push).toHaveBeenCalledWith(
      "/finished-goods/pallets/pallet-a/move",
    ),
  );
  expect(onReserved).toHaveBeenCalledTimes(1);
});

it("ignores a move reservation that resolves after unmount", async () => {
  let resolveReserve: () => void = () => {};
  mocks.write.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveReserve = () => resolve(success("move-a"));
      }),
  );
  const onReserved = vi.fn();
  const view = renderEditor(onReserved);
  fireEvent.click(
    screen.getByRole("button", { name: "Reserve this position" }),
  );
  await waitFor(() => expect(callsFor("reserveMove")).toHaveLength(1));
  // The pending request id is persisted before the await; capture that state.
  const persisted = localStorage.length;
  view.unmount();
  resolveReserve();
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  // A reservation that settles after unmount must not navigate, must not call
  // the completion callback, and must not clear the persisted request id.
  expect(mocks.push).not.toHaveBeenCalled();
  expect(onReserved).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(persisted);
});
