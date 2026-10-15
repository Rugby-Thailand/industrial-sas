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
  failed: false,
  record: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => boundaryMocks.pathname,
}));
vi.mock("./ObservabilityProvider", () => ({
  useObservability: () => ({ record: boundaryMocks.record }),
}));
vi.mock("./WorkspaceProvider", () => ({
  useWorkspace: () => ({
    selectedWarehouseId: "warehouse-a",
    failed: boundaryMocks.failed,
  }),
}));

function DeniedWorkspace(): never {
  throw new Error("USER_UNKNOWN");
}

beforeEach(() => {
  boundaryMocks.pathname = "/en/storage-layouts";
  boundaryMocks.failed = false;
  boundaryMocks.record.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("WorkspaceAccessBoundary", () => {
  it.each([
    [
      "en",
      false,
      "Something went wrong",
      "The read did not complete.",
      "Try again",
    ],
    [
      "en",
      true,
      "Something went wrong",
      "The read did not complete.",
      "Try again",
    ],
    ["th", false, "เกิดข้อผิดพลาด", "อ่านข้อมูลไม่สำเร็จ", "ลองใหม่"],
    ["th", true, "เกิดข้อผิดพลาด", "อ่านข้อมูลไม่สำเร็จ", "ลองใหม่"],
  ] as const)(
    "shows one %s heading and a retryable explanation (workspace failed=%s)",
    (locale, failed, title, hint, retry) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      boundaryMocks.failed = failed;

      renderWithIntl(
        <WorkspaceAccessBoundary>
          <DeniedWorkspace />
        </WorkspaceAccessBoundary>,
        { locale, environment: testEnvironment, workspace: false },
      );

      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole("heading", { level: 1, name: title }),
      ).toBeVisible();
      expect(screen.getAllByText(title, { exact: true })).toHaveLength(1);
      const notice = screen.getByTestId("workspace-query-error");
      expect(screen.getByRole("alert")).toBe(notice);
      expect(notice).toHaveTextContent(hint);
      expect(screen.getByRole("button", { name: retry })).toBeVisible();
    },
  );

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
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));
