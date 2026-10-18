import { fireEvent, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  finishedGoodsWorkspace,
  measuredPalletDetail,
  querySuccess,
  writeSuccess,
} from "@tests/fixtures/finished-goods-ui";

const state = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  mutate: vi.fn(),
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, userId: "audit-stacker" }),
}));
vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => finishedGoodsWorkspace,
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    state.queries.get(getFunctionName(ref)),
  useMutation: () => state.mutate,
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (id: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => <a {...props} />,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { StackScreen } from "@/features/finishedGoods/StackScreen";

function options(levels: number) {
  return {
    lower: {
      ...measuredPalletDetail.pallet,
      _id: "lower",
      status: "STORED",
      stackable: true,
      maxStackLevels: levels,
    },
    lowerSettingsLocked: false,
    upperSettingsLocked: false,
    children: [],
    pallets: [],
    candidate: null,
    error: null,
  };
}
beforeEach(() => {
  state.queries.clear();
  state.mutate.mockReset();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

it("SOL-03 reproduces a clean stacking editor overwriting a newer live limit", async () => {
  state.queries.set(
    getFunctionName(fgRefs.getPallet),
    querySuccess(measuredPalletDetail),
  );
  state.queries.set(
    getFunctionName(fgRefs.stackOptions),
    querySuccess(options(2)),
  );
  state.mutate.mockResolvedValue(writeSuccess("lower"));
  const view = renderWithIntl(<StackScreen palletId="lower" />, {
    locale: "en",
    preserveProviders: true,
  });
  const field = screen.getByRole("spinbutton", {
    name: "Maximum levels, including this pallet",
  });
  expect(field).toHaveValue(2);
  // A different operator saves 5. The real query now has 5, but this clean local form stays at 2.
  state.queries.set(
    getFunctionName(fgRefs.stackOptions),
    querySuccess(options(5)),
  );
  view.rerender(<StackScreen palletId="lower" />);
  expect(
    screen.getByRole("spinbutton", {
      name: "Maximum levels, including this pallet",
    }),
  ).toHaveValue(2);
  fireEvent.click(screen.getByRole("button", { name: "Save stacking limits" }));
  await vi.waitFor(() =>
    expect(state.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ palletId: "lower", maxStackLevels: 2 }),
    ),
  );
});
