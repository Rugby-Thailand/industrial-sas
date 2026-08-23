import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";
import { renderWithIntl } from "../../../tests/fixtures/intl-render";
import {
  readOperationalExceptionsRef,
  readStockMovementsRef,
  readStockReportsRef,
} from "@/lib/convex/reportingApi";

const { useQueryMock } = vi.hoisted(() => ({ useQueryMock: vi.fn() }));
vi.mock("convex/react", () => ({ useQuery: useQueryMock }));
vi.mock("@/i18n/navigation", () => navigationMock);

import { ServerOperationalReports } from "./OperationalReportsWorkbench";

const stock = {
  ok: true as const,
  requestId: "req_stock",
  value: {
    ok: true as const,
    asOf: Date.UTC(2026, 7, 11),
    complete: true,
    balances: [
      {
        bucketKey: "bucket",
        itemId: "item",
        sku: "SKU-01",
        itemName: "Carton",
        locationCode: "A-01",
        stockStatus: "AVAILABLE",
        baseUom: "EA",
        baseMinorUnits: 1_000,
        lastTransactionId: "tx",
        updatedAt: Date.UTC(2026, 7, 11),
      },
    ],
    sku: [],
    lots: [],
  },
};

const movements = {
  ok: true as const,
  requestId: "req_movements",
  value: {
    ok: true as const,
    asOf: Date.UTC(2026, 7, 11),
    complete: true,
    movements: [],
  },
};

const exceptions = {
  ok: true as const,
  requestId: "req_exceptions",
  value: {
    ok: true as const,
    asOf: Date.UTC(2026, 7, 11),
    complete: true,
    exceptions: [],
  },
};

function answers({
  stockAnswer = stock,
  movementAnswer = movements,
  exceptionAnswer = exceptions,
}: {
  readonly stockAnswer?: unknown;
  readonly movementAnswer?: unknown;
  readonly exceptionAnswer?: unknown;
} = {}) {
  useQueryMock.mockImplementation((reference) => {
    if (reference === readStockReportsRef) return stockAnswer;
    if (reference === readStockMovementsRef) return movementAnswer;
    if (reference === readOperationalExceptionsRef) return exceptionAnswer;
    throw new Error("unexpected report query");
  });
}

const render = () =>
  renderWithIntl(<ServerOperationalReports warehouseId="wh_1" />, {
    locale: "en",
  });

describe("operational report independence and tabs", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    answers();
  });

  it("keeps the balance report when the exception source is denied", () => {
    answers({
      exceptionAnswer: { ok: false, requestId: "req_exception_denied" },
    });
    render();

    expect(screen.getByTestId("report-stock-balance")).toHaveTextContent(
      "SKU-01",
    );
    expect(screen.getByText(/req_exception_denied/)).toBeInTheDocument();
  });

  it("attributes a movement denial only after that tab is selected", async () => {
    const user = userEvent.setup();
    answers({
      movementAnswer: { ok: false, requestId: "req_movement_denied" },
    });
    render();

    expect(screen.getByTestId("report-stock-balance")).toBeInTheDocument();
    expect(screen.queryByText(/req_movement_denied/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Stock movement" }));
    expect(screen.getByText(/req_movement_denied/)).toBeInTheDocument();
  });

  it("implements roving focus, arrow keys, Home, End, and panel association", async () => {
    const user = userEvent.setup();
    render();
    const balance = screen.getByRole("tab", { name: "Stock balance" });
    const sku = screen.getByRole("tab", { name: "Stock by SKU" });
    const movement = screen.getByRole("tab", { name: "Stock movement" });

    expect(balance).toHaveAttribute("tabindex", "0");
    expect(sku).toHaveAttribute("tabindex", "-1");
    balance.focus();
    await user.keyboard("{ArrowRight}");
    expect(sku).toHaveFocus();
    expect(sku).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(movement).toHaveFocus();
    await user.keyboard("{Home}");
    expect(balance).toHaveFocus();

    const panel = screen.getByRole("tabpanel");
    expect(balance).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", balance.id);
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render();
    expect(await axe(container)).toHaveNoViolations();
  });
});
