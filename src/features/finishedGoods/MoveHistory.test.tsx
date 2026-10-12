import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCursorPositions } from "@/hooks/useCursorPagination";
import type { PalletDetail } from "@/lib/convex/finishedGoodsApi";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  finishedGoodPallet,
  finishedGoodProduct,
  querySuccess,
} from "@tests/fixtures/finished-goods-ui";
import { MoveHistory } from "./MoveHistory";

const mocks = vi.hoisted(() => ({
  calls: [] as Record<string, unknown>[],
  respond: (_args: Record<string, unknown>): unknown => undefined,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));
vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: Record<string, unknown>) => {
    mocks.calls.push(args);
    return mocks.respond(args);
  },
}));

const detail = {
  pallet: finishedGoodPallet,
  product: finishedGoodProduct,
} as unknown as PalletDetail;
const move = (n: number) => ({
  _id: `move-${n}`,
  status: "COMPLETED" as const,
  createdAt: Date.UTC(2026, 9, 1, n),
  reason: `Reason ${n}`,
  sourcePlacement: { mode: "LOCATION_ONLY" as const, positionCode: "A" },
  sourceDestination: { buildingCode: "B1", floorNumber: 1, locationName: "Z1" },
  targetPlacement: {
    mode: "GEOMETRIC" as const,
    positionCode: "B",
    xMm: 100,
    yMm: 200,
    zMm: 0,
    rotation: 0,
  },
  targetDestination: null,
});
const page = (items: ReturnType<typeof move>[], isDone: boolean) =>
  querySuccess({
    status: "ready",
    items,
    isDone,
    continueCursor: isDone ? "" : "next-page",
    scanned: items.length,
  });

beforeEach(() => {
  clearCursorPositions();
  mocks.calls = [];
});

describe("paged movement history", () => {
  it("renders nothing for a unit that never moved", () => {
    mocks.respond = () => page([], true);
    const { container } = renderWithIntl(<MoveHistory detail={detail} />, {
      locale: "en",
      workspace: false,
    });
    expect(container).toBeEmptyDOMElement();
    expect(mocks.calls[0]).toMatchObject({
      warehouseId: finishedGoodPallet.warehouseId,
      palletId: finishedGoodPallet._id,
      cursor: null,
      pageSize: 20,
    });
  });

  it("pages older moves with the shared pager instead of hiding them", async () => {
    const user = userEvent.setup();
    mocks.respond = (args) =>
      args["cursor"] === "next-page"
        ? page([move(1)], true)
        : page([move(3), move(2)], false);
    renderWithIntl(<MoveHistory detail={detail} />, {
      locale: "en",
      workspace: false,
    });
    expect(screen.getByText("Reason 3")).toBeInTheDocument();
    expect(screen.getAllByText("B1 · Floor 1 · Z1 → —")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Reason 1")).toBeInTheDocument();
    expect(screen.queryByText("Reason 3")).toBeNull();
    expect(
      screen.getByRole("navigation", { name: "Movement history pages" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(screen.getByText("Reason 3")).toBeInTheDocument();
  });

  it("explains a failed history read in Thai", () => {
    mocks.respond = () => querySuccess(null);
    renderWithIntl(<MoveHistory detail={detail} />, {
      locale: "th",
      workspace: false,
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "โหลดประวัติการย้ายไม่สำเร็จ",
    );
  });

  it("retries a failed first page with a new subscription identity", async () => {
    const user = userEvent.setup();
    // Depends on arguments only, like a Convex subscription.
    mocks.respond = (args) =>
      args["attempt"] === 1
        ? page([move(4)], true)
        : querySuccess({
            status: "reset",
            items: [],
            isDone: true,
            continueCursor: "",
            scanned: 0,
          });
    renderWithIntl(<MoveHistory detail={detail} />, {
      locale: "en",
      workspace: false,
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Movement history could not be loaded.",
    );
    const distinct = () =>
      new Set(mocks.calls.map((args) => JSON.stringify(args)));
    expect(distinct().size).toBe(1);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(distinct().size).toBe(2);
    expect(mocks.calls.at(-1)).toMatchObject({ cursor: null, attempt: 1 });
    expect(await screen.findByText("Reason 4")).toBeInTheDocument();
  });

  it("offers retry instead of spinning when a split scan makes no progress", async () => {
    const user = userEvent.setup();
    mocks.respond = (args) =>
      args["attempt"] === 1
        ? page([move(5)], true)
        : querySuccess({
            status: "scanning",
            items: [],
            isDone: false,
            continueCursor: "",
            scanCursor: "same",
            scanned: 0,
          });
    renderWithIntl(<MoveHistory detail={detail} />, {
      locale: "en",
      workspace: false,
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      new Set(mocks.calls.map((args) => args["scanCursor"])).size,
    ).toBeLessThanOrEqual(2);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Reason 5")).toBeInTheDocument();
  });
});
