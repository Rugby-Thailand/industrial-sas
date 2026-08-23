import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  configuredEnvironment,
  renderWithIntl,
} from "@tests/fixtures/intl-render";

const convex = vi.hoisted(() => ({
  useMutation: vi.fn(() => async () => undefined),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => convex);
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({
    children,
  }: {
    readonly children: (warehouseId: string, preview: false) => ReactNode;
  }) => children("warehouse-test", false),
}));

import { FulfillmentBoard } from "./fulfillment/FulfillmentBoard";
import { ProductionBoard } from "./production/ProductionBoard";
import { TransferBoard } from "./transfers/TransferBoard";

const successfulPage = (requestId: string) => ({
  ok: true as const,
  requestId,
  value: {
    ok: true as const,
    items: [],
    nextCursor: null,
    complete: true,
  },
});

const denied = (requestId: string) => ({
  ok: false as const,
  requestId,
  denial: {
    kind: "AUTHORIZATION_DENIED" as const,
    code: "AUTHORIZATION_DENIED",
    requestId,
    message: "Request denied",
  },
});

const domainError = (requestId: string) => ({
  ok: true as const,
  requestId,
  value: {
    ok: false as const,
    error: { code: "READ_FAILED" },
  },
});

const renderBoard = (board: ReactNode) =>
  renderWithIntl(<>{board}</>, {
    locale: "en",
    environment: configuredEnvironment,
    workspace: false,
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("multi-query board status attribution", () => {
  it("uses the fulfillment routing query's request reference when it denies", () => {
    convex.useQuery
      .mockReturnValueOnce(successfulPage("fulfillment-orders-ok"))
      .mockReturnValueOnce(denied("fulfillment-routing-denied"));

    renderBoard(<FulfillmentBoard />);

    expect(screen.getByTestId("panel-DENIED")).toHaveTextContent(
      "fulfillment-routing-denied",
    );
    expect(screen.getByTestId("panel-DENIED")).not.toHaveTextContent(
      "fulfillment-orders-ok",
    );
  });

  it("uses the production item query's request reference when it denies", () => {
    convex.useQuery
      .mockReturnValueOnce(successfulPage("production-orders-ok"))
      .mockReturnValueOnce(denied("production-items-denied"))
      .mockReturnValueOnce(successfulPage("production-locations-ok"))
      .mockReturnValueOnce(successfulPage("production-impacts-ok"));

    renderBoard(<ProductionBoard />);

    expect(screen.getByTestId("panel-DENIED")).toHaveTextContent(
      "production-items-denied",
    );
    expect(screen.getByTestId("panel-DENIED")).not.toHaveTextContent(
      "production-orders-ok",
    );
  });

  it("uses the transfer destination query's request reference when it denies", () => {
    convex.useQuery
      .mockReturnValueOnce(successfulPage("transfer-source-ok"))
      .mockReturnValueOnce(denied("transfer-destination-denied"))
      .mockReturnValueOnce(successfulPage("transfer-warehouses-ok"))
      .mockReturnValueOnce(successfulPage("transfer-items-ok"));

    renderBoard(<TransferBoard />);

    expect(screen.getByTestId("panel-DENIED")).toHaveTextContent(
      "transfer-destination-denied",
    );
    expect(screen.getByTestId("panel-DENIED")).not.toHaveTextContent(
      "transfer-source-ok",
    );
  });

  it.each([
    {
      name: "fulfillment",
      board: <FulfillmentBoard />,
      outcomes: [
        successfulPage("fulfillment-orders-ok"),
        domainError("fulfillment-routing-error"),
      ],
      code: "FULFILLMENT_READ",
    },
    {
      name: "production",
      board: <ProductionBoard />,
      outcomes: [
        successfulPage("production-orders-ok"),
        successfulPage("production-items-ok"),
        successfulPage("production-locations-ok"),
        domainError("production-impacts-error"),
      ],
      code: "PRODUCTION_READ",
    },
    {
      name: "transfers",
      board: <TransferBoard />,
      outcomes: [
        successfulPage("transfer-source-ok"),
        successfulPage("transfer-destination-ok"),
        domainError("transfer-warehouses-error"),
        successfulPage("transfer-items-ok"),
      ],
      code: "TRANSFER_READ",
    },
  ])(
    "renders a domain failure as ERROR for $name",
    ({ board, outcomes, code }) => {
      for (const outcome of outcomes) {
        convex.useQuery.mockReturnValueOnce(outcome);
      }

      renderBoard(board);

      expect(screen.getByTestId("panel-ERROR")).toHaveTextContent(code);
      expect(screen.queryByTestId("panel-DENIED")).not.toBeInTheDocument();
    },
  );
});
