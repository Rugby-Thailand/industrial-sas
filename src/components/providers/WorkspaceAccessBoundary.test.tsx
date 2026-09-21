import type { ComponentProps } from "react";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  renderWithIntl,
  testEnvironment,
} from "../../../tests/fixtures/intl-render";

import { WorkspaceAccessBoundary } from "./WorkspaceAccessBoundary";

const boundaryMocks = vi.hoisted(() => ({
  pathname: "/en/storage-layouts",
  record: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => boundaryMocks.pathname,
}));
vi.mock("./ObservabilityProvider", () => ({
  useObservability: () => ({ record: boundaryMocks.record }),
}));
vi.mock("./WorkspaceProvider", () => ({
  useWorkspace: () => ({ selectedWarehouseId: "warehouse-a", failed: false }),
}));

function DeniedWorkspace(): never {
  throw new Error("USER_UNKNOWN");
}

beforeEach(() => {
  boundaryMocks.pathname = "/en/storage-layouts";
  boundaryMocks.record.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("WorkspaceAccessBoundary", () => {
  it("shows a retryable backend state when a query throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderWithIntl(
      <WorkspaceAccessBoundary>
        <DeniedWorkspace />
      </WorkspaceAccessBoundary>,
      { environment: testEnvironment, workspace: false },
    );

    expect(screen.getByTestId("workspace-query-error")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "เกิดข้อผิดพลาด" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "ลองใหม่" })).toBeVisible();
  });

  it("reports failures and resets when the warehouse route changes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;
    function Screen() {
      if (shouldThrow) throw new Error("query failed");
      return <span>recovered</span>;
    }

    const view = renderWithIntl(
      <WorkspaceAccessBoundary>
        <Screen />
      </WorkspaceAccessBoundary>,
      { environment: testEnvironment, workspace: false },
    );

    expect(boundaryMocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "workspace.query.failed",
        severity: "error",
        dimensions: expect.objectContaining({
          route: "en.storage-layouts",
          warehouse: "warehouse-a",
        }),
      }),
    );

    shouldThrow = false;
    boundaryMocks.pathname = "/en/finished-goods";
    view.rerender(
      <WorkspaceAccessBoundary>
        <Screen />
      </WorkspaceAccessBoundary>,
    );
    expect(screen.getByText("recovered")).toBeVisible();
  });
});

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props} />
  ),
}));
