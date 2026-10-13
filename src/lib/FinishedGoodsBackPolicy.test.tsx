import { fireEvent, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { finishedGoodsWorkspace } from "@tests/fixtures/finished-goods-ui";
import { FinishedGoodsCatalogue } from "@/features/finishedGoods/FinishedGoodsCatalogue";

const router = vi.hoisted(() => ({ back: vi.fn(), replace: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, userId: "user-test" }),
}));
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  useWorkspace: () => finishedGoodsWorkspace,
}));
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (warehouseId: string) => ReactNode }) =>
    children("warehouse-test"),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => <a {...props} />,
  useRouter: () => router,
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods",
  );
});
it("actual finished-goods catalogue is a direct-entry hub while its projections load", () => {
  renderWithIntl(<FinishedGoodsCatalogue />, {
    locale: "en",
    workspace: false,
  });
  expect(
    screen.getByRole("heading", { name: "Finished goods", level: 1 }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Back" }),
  ).not.toBeInTheDocument();
  expect(router.replace).not.toHaveBeenCalled();
  expect(router.back).not.toHaveBeenCalled();
});
it("actual finished-goods catalogue can return to its real earlier app page", () => {
  window.history.replaceState(
    { appNavigationIndex: 1 },
    "",
    "/th/finished-goods?search=stock#results",
  );
  renderWithIntl(<FinishedGoodsCatalogue />, {
    locale: "en",
    workspace: false,
  });
  const back = screen.getByRole("button", { name: "Back" });
  expect(back).toBeEnabled();
  fireEvent.click(back);
  expect(router.back).toHaveBeenCalledOnce();
  expect(router.replace).not.toHaveBeenCalled();
});
