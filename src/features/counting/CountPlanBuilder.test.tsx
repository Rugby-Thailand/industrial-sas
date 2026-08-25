import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const convex = vi.hoisted(() => ({
  useConvexAuth: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => convex);

import { renderWithIntl, testEnvironment } from "@tests/fixtures/intl-render";
import { chooseOption } from "@tests/fixtures/select-control";

import { encodeBucketKey } from "../../../convex/model/inventory/stockIdentity";

import {
  createCountPlanRef,
  releaseCountPlanRef,
} from "@/lib/convex/countingApi";

import { CountPlanBuilder } from "./CountPlanBuilder";

const bucket = encodeBucketKey({
  orgId: "org_1",
  warehouseId: "warehouse_1",
  itemId: "item_1",
  location: { kind: "PHYSICAL", locationId: "loc_a1" },
  stockStatus: "AVAILABLE",
});
if (!bucket.ok) throw new Error("test bucket must encode");
const bucketKey = bucket.value;

const workspaceOutcome = {
  ok: true,
  requestId: "req_workspace",
  value: {
    organization: { id: "org_1", name: "Test Org" },
    warehouses: [{ id: "warehouse_1", code: "WH1", name: "Main" }],
    navigationPermissions: [],
    complete: true,
  },
};

const balancesOutcome = {
  ok: true,
  requestId: "req_balances",
  value: {
    ok: true,
    items: [
      {
        bucketKey,
        stockStatus: "AVAILABLE",
        uom: "EA",
        minorUnits: 500,
      },
    ],
  },
};

const createMutation = vi.fn();
const releaseMutation = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  convex.useConvexAuth.mockReturnValue({
    isAuthenticated: true,
    isLoading: false,
  });
  convex.useQuery.mockImplementation((_ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    return typeof args === "object" && args !== null && "warehouseId" in args
      ? balancesOutcome
      : workspaceOutcome;
  });
  convex.useMutation.mockImplementation((ref: unknown) => {
    if (ref === createCountPlanRef) return createMutation;
    if (ref === releaseCountPlanRef) return releaseMutation;
    throw new Error("unexpected mutation reference");
  });
  createMutation.mockResolvedValue({
    ok: true,
    requestId: "req_write",
    value: { written: true, documentId: "plan_123", replayed: false },
  });
  releaseMutation.mockResolvedValue({
    ok: true,
    requestId: "req_release",
    value: { written: true, documentId: "plan_123", replayed: false },
  });
});

const renderBuilder = (locale: "en" | "th" = "en") =>
  renderWithIntl(<CountPlanBuilder />, {
    locale,
    environment: testEnvironment,
  });

const createPlan = () => {
  chooseOption(
    "Physical stock bucket",
    "item: item_1 · location: loc_a1 · 500 EA",
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Plan number" }), {
    target: { value: "COUNT-9" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create plan" }));
};

describe("risk settings disclosure", () => {
  it("starts collapsed, at defaults, and opens on demand", () => {
    renderBuilder();

    const disclosure = screen.getByRole("button", { name: /Risk settings/ });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");

    expect(disclosure).toHaveTextContent("Defaults");
    expect(
      screen.queryByRole("textbox", { name: "High-risk quantity threshold" }),
    ).not.toBeInTheDocument();

    fireEvent.click(disclosure);

    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("textbox", { name: "High-risk quantity threshold" }),
    ).toHaveValue("1000");
    expect(
      screen.getByRole("textbox", { name: "High-risk value threshold" }),
    ).toHaveValue("100000");
    expect(screen.getByRole("textbox", { name: "Item class" })).toHaveValue(
      "C",
    );
    expect(
      screen.getByRole("textbox", { name: "Value per base minor unit" }),
    ).toHaveValue("0");
  });

  it("submits the default thresholds without ever being opened", async () => {
    renderBuilder();

    createPlan();

    await waitFor(() => expect(createMutation).toHaveBeenCalledOnce());
    expect(createMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        planNumber: "COUNT-9",
        scope: "CYCLE",
        visibility: "BLIND",
        movementPolicy: "MOVEMENT_AWARE",
        quantityThresholdBaseMinorUnits: 1000,
        valueThresholdMinorUnits: 100000,
        targets: [{ bucketKey, itemClass: "C", unitValueMinorUnits: 0 }],
      }),
    );
  });

  it("opens and blocks submission when an advanced value is cleared", () => {
    renderBuilder();

    const disclosure = screen.getByRole("button", { name: /Risk settings/ });
    fireEvent.click(disclosure);
    fireEvent.change(
      screen.getByRole("textbox", { name: "High-risk quantity threshold" }),
      { target: { value: "" } },
    );
    createPlan();

    expect(createMutation).not.toHaveBeenCalled();
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Complete every required field.")).toBeVisible();
  });

  it("opens the risk group when the server refuses its values", async () => {
    createMutation.mockResolvedValueOnce({
      ok: true,
      requestId: "req_write",
      value: {
        written: false,
        error: { code: "THRESHOLD_INVALID", field: "threshold" },
      },
    });
    renderBuilder();

    createPlan();

    await screen.findByTestId("write-REFUSED");
    expect(
      screen.getByRole("button", { name: /Risk settings/ }),
    ).toHaveAttribute("aria-expanded", "true");
    const threshold = screen.getByRole("textbox", {
      name: "High-risk quantity threshold",
    });
    expect(threshold).toHaveAttribute("aria-invalid", "true");
    expect(threshold).toHaveFocus();
  });
});

describe("policy controls", () => {
  it("offers each policy as labelled pressed buttons, never enum strings", () => {
    renderBuilder();

    expect(screen.getByRole("button", { name: /^Cycle/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^Blind/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /^Movement-aware/ }),
    ).toHaveAttribute("aria-pressed", "true");

    expect(screen.queryByText("MOVEMENT_AWARE")).not.toBeInTheDocument();
    expect(screen.queryByText("BLIND")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Visible/ }));

    expect(screen.getByRole("button", { name: /^Visible/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^Blind/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("after a successful create", () => {
  it("offers release as the one next step and never an editable plan ID", async () => {
    renderBuilder();

    createPlan();

    const created = await screen.findByTestId("count-plan-created");
    expect(created).toHaveTextContent("Plan COUNT-9 created");

    expect(screen.queryByDisplayValue("plan_123")).not.toBeInTheDocument();
    expect(screen.queryByText("plan_123")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Release tasks" }));

    await waitFor(() => expect(releaseMutation).toHaveBeenCalledOnce());
    expect(releaseMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        warehouseId: "warehouse_1",
        countPlanId: "plan_123",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Release tasks" }),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("frozen-plan retries", () => {
  it("reuses the request fingerprint after an ambiguous failure", async () => {
    createMutation
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce({
        ok: true,
        requestId: "req_retry",
        value: { written: true, documentId: "plan_456", replayed: true },
      });
    renderBuilder();

    fireEvent.click(screen.getByRole("button", { name: "Frozen" }));
    createPlan();
    await screen.findByTestId("write-FAILED");
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    await waitFor(() => expect(createMutation).toHaveBeenCalledTimes(2));
    const first = createMutation.mock.calls[0]?.[0] as Record<string, unknown>;
    const retry = createMutation.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(retry["requestId"]).toBe(first["requestId"]);
    expect(retry["freezeExpiresAt"]).toBe(first["freezeExpiresAt"]);
  });
});

describe("accessibility", () => {
  it.each(["en", "th"] as const)(
    "has no detectable violations in %s",
    async (locale) => {
      const { container } = renderBuilder(locale);
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
