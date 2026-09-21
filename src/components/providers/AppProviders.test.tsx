import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type * as WorkspaceModule from "./WorkspaceProvider";
import type { ReactNode } from "react";

import { EnvironmentProvider } from "./EnvironmentProvider";
import { EnvironmentAwareWorkspaceProvider } from "./AppProviders";

vi.mock("./WorkspaceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  WorkspaceProvider: ({ children }: { readonly children: ReactNode }) => (
    <div data-testid="workspace-provider">{children}</div>
  ),
}));

const missingBackend = {
  backendConfigured: false,
  identityConfigured: true,
};
const missingIdentity = {
  backendConfigured: true,
  identityConfigured: false,
};
const configured = {
  backendConfigured: true,
  identityConfigured: true,
};

describe("EnvironmentAwareWorkspaceProvider", () => {
  it.each([
    ["without a backend", missingBackend],
    ["without identity", missingIdentity],
  ])("skips workspace queries %s", (_label, environment) => {
    render(
      <EnvironmentProvider environment={environment}>
        <EnvironmentAwareWorkspaceProvider>
          <span>content</span>
        </EnvironmentAwareWorkspaceProvider>
      </EnvironmentProvider>,
    );

    expect(screen.getByText("content")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-provider")).not.toBeInTheDocument();
  });

  it("mounts workspace queries when both dependencies are configured", () => {
    render(
      <EnvironmentProvider environment={configured}>
        <EnvironmentAwareWorkspaceProvider>
          <span>content</span>
        </EnvironmentAwareWorkspaceProvider>
      </EnvironmentProvider>,
    );

    expect(screen.getByTestId("workspace-provider")).toBeInTheDocument();
  });
});
