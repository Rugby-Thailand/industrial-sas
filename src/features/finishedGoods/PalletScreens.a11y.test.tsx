import type * as ClerkModule from "@clerk/nextjs";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import { screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ComponentProps, ReactNode } from "react";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { PalletDetail } from "@/lib/convex/finishedGoodsApi";

const mocks = vi.hoisted(() => ({ query: vi.fn<(name: string) => unknown>() }));
vi.mock("@clerk/nextjs", async (importOriginal) => {
  const actual = await importOriginal<typeof ClerkModule>();
  return { ...actual, useAuth: () => ({ isLoaded: true, userId: "user-a" }) };
});
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspaceModule>();
  return { ...actual, useWorkspace: () => finishedGoodsWorkspace };
});
vi.mock("convex/react", () => ({
  useMutation: () => async () => writeSuccess("pallet-a"),
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    mocks.query(getFunctionName(ref)),
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (warehouseId: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));

import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  finishedGoodsWorkspace,
  finishedGoodDestination,
  measuredPalletDetail,
  querySuccess,
  reservedPalletDetail,
  writeSuccess,
} from "@tests/fixtures/finished-goods-ui";
import { PalletScreen } from "./PalletScreens";

let detail: PalletDetail;
beforeEach(() => {
  localStorage.clear();
  detail = measuredPalletDetail;
  mocks.query
    .mockReset()
    .mockImplementation((name) =>
      name.endsWith(":getPallet")
        ? querySuccess(detail)
        : querySuccess({ candidates: [finishedGoodDestination], reasons: [] }),
    );
});

it.each(["en", "th"] as const)(
  "keeps the %s measurement form and scene accessible",
  async (locale) => {
    const { container } = renderWithIntl(
      <PalletScreen palletId="pallet-a" view="measure" />,
      { locale, workspace: false },
    );
    expect(await axe(container)).toHaveNoViolations();
  },
);

it("keeps exact placement adjustment and inline reservation accessible", async () => {
  const { container } = renderWithIntl(
    <PalletScreen palletId="pallet-a" view="storage" />,
    { locale: "en", workspace: false },
  );
  expect(await axe(container)).toHaveNoViolations();
  expect(
    screen.getByRole("button", { name: "Reserve this position" }),
  ).toBeEnabled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps manual verification and physical confirmation clearly named", async () => {
  detail = reservedPalletDetail;
  renderWithIntl(<PalletScreen palletId="pallet-a" />, {
    locale: "en",
    workspace: false,
  });
  expect(
    await axe(
      screen.getByRole("region", { name: "Verify destination and placement" }),
    ),
  ).toHaveNoViolations();
});
