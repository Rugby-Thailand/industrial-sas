import type { ComponentProps } from "react";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  renderWithIntl,
  testEnvironment,
} from "../../../tests/fixtures/intl-render";

import { WorkspaceAccessBoundary } from "./WorkspaceAccessBoundary";

function DeniedWorkspace(): never {
  throw new Error("USER_UNKNOWN");
}

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
});

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props} />
  ),
}));
