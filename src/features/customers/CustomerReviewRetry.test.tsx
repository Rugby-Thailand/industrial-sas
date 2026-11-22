import {
  getTestMutation,
  registerTestMutation,
} from "@tests/fixtures/convex-mutation";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";

const mocks = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  warehouses: [{ id: "wh-1" }, { id: "wh-2" }],
  auth: { userId: "user-a", orgId: "org-a" as string | null },
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useMutation: getTestMutation,
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip" ? undefined : mocks.queries.get(getFunctionName(ref)),
}));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  useWorkspace: () => ({
    readiness: { kind: "READY_TO_QUERY" },
    authenticated: true,
    failed: false,
    permissionsReady: true,
    navigationPermissions: [],
    warehouses: mocks.warehouses,
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: () => null,
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { api } from "../../../convex/_generated/api";
import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { CustomerReviewQueue } from "./CustomerReviewQueue";

const UNRESOLVED = getFunctionName(api.customers.linking.listUnresolvedNames);
const group = {
  normalizedName: "บจก.ไทยรุ่งเรือง",
  displayName: "บจก.ไทยรุ่งเรือง",
  scanCount: 1,
  latestAt: 1_763_380_800_000,
  warehouses: [{ warehouseId: "wh-1", name: "บางพลี" }],
  scans: [
    {
      jobScanId: "scan-1",
      warehouseId: "wh-1",
      warehouseName: "บางพลี",
      factoryOrder: "FO-101",
      capturedName: "บจก.ไทยรุ่งเรือง",
      createdAt: 1_763_380_800_000,
      version: 1,
    },
  ],
  matchKind: "SIMILAR" as const,
  candidates: [
    {
      customerId: "customer-a",
      code: "C-0007",
      name: "บริษัท ไทยรุ่งเรือง จำกัด",
      status: "ACTIVE" as const,
    },
  ],
};
const queue = (groups: readonly object[], canReview = true) => ({
  ok: true,
  value: { canViewWarehouseData: true, canReview, hasMore: false, groups },
});
const RETRY_NOTICE =
  "Couldn't confirm whether this decision was saved. Retry to send the exact same request safely.";

function setup() {
  const resolve = vi.fn<(args: unknown) => Promise<unknown>>();
  registerTestMutation(api.customers.linking.resolveUnresolvedScans, resolve);
  mocks.queries.set(UNRESOLVED, queue([group]));
  const view = renderWithIntl(
    <DraftGuardProvider>
      <CustomerReviewQueue />
    </DraftGuardProvider>,
    { locale: "en", workspace: false, preserveProviders: true },
  );
  const update = (value: unknown) => {
    mocks.queries.set(UNRESOLVED, value);
    view.rerender(
      <DraftGuardProvider>
        <CustomerReviewQueue />
      </DraftGuardProvider>,
    );
  };
  return { resolve, update };
}
async function link() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("review-link-button"));
  });
}

beforeEach(() => {
  mocks.queries.clear();
  mocks.warehouses = [{ id: "wh-1" }, { id: "wh-2" }];
  mocks.auth = { userId: "user-a", orgId: "org-a" };
});
afterEach(cleanup);

describe("review retry ownership", () => {
  it("keeps a lost-response review retry and its exact command after the live queue drops the committed group, then replays it", async () => {
    const { resolve, update } = setup();
    resolve.mockRejectedValueOnce(new Error("Connection lost"));
    await link();
    const first = resolve.mock.calls[0]![0];

    // The write committed: the live query drops the group, emptying the queue.
    update(queue([]));
    expect(screen.queryByText("No names awaiting review")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(RETRY_NOTICE);
    expect(screen.getByTestId("review-link-button")).toHaveTextContent(
      "Retry link",
    );
    // Paging/arguments reloading keeps the unanswered card mounted too.
    update(undefined);
    expect(screen.getByTestId("review-link-button")).toHaveTextContent(
      "Retry link",
    );
    update(queue([]));

    resolve.mockResolvedValueOnce({
      ok: true,
      value: { ok: true, updatedCount: 1, replayed: true },
    });
    await link();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve.mock.calls[1]![0]).toEqual(first);
    expect(screen.queryByTestId("review-group-card")).toBeNull();
    expect(screen.getByText("No names awaiting review")).toBeInTheDocument();
  });

  it("keeps an in-flight review decision mounted when its group disappears and settles it on answer", async () => {
    const { resolve, update } = setup();
    let answer!: (value: unknown) => void;
    resolve.mockReturnValueOnce(new Promise((done) => (answer = done)));
    await link();
    update(queue([]));
    expect(screen.getByTestId("review-link-button")).toHaveTextContent(
      "Linking…",
    );
    await act(async () => {
      answer({
        ok: true,
        value: { ok: true, updatedCount: 1, replayed: false },
      });
    });
    expect(screen.queryByTestId("review-group-card")).toBeNull();
    expect(screen.getByText("No names awaiting review")).toBeInTheDocument();
  });

  it.each([
    [
      "the member switches org",
      () => (mocks.auth = { userId: "user-a", orgId: "org-b" }),
      queue([]),
    ],
    [
      "warehouse access narrows",
      () => (mocks.warehouses = [{ id: "wh-2" }]),
      queue([]),
    ],
    ["review access is revoked", () => undefined, queue([], false)],
  ])(
    "discards a retained review retry when %s",
    async (_label, change, next) => {
      const { resolve, update } = setup();
      resolve.mockRejectedValueOnce(new Error("Connection lost"));
      await link();
      change();
      update(next);
      expect(screen.queryByTestId("review-group-card")).toBeNull();
      expect(screen.queryByText("บจก.ไทยรุ่งเรือง")).toBeNull();
      // Restoring the original member/access never resurrects the attempt.
      mocks.auth = { userId: "user-a", orgId: "org-a" };
      update(queue([]));
      expect(screen.queryByTestId("review-group-card")).toBeNull();
      expect(resolve).toHaveBeenCalledTimes(1);
    },
  );
});
