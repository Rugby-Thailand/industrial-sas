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
  it("shows an access state when workspace provisioning is missing", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderWithIntl(
      <WorkspaceAccessBoundary>
        <DeniedWorkspace />
      </WorkspaceAccessBoundary>,
      { environment: testEnvironment, workspace: false },
    );

    expect(screen.getByTestId("organization-required")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "ต้องมีสิทธิ์องค์กร" }),
    ).toBeVisible();
  });
});
