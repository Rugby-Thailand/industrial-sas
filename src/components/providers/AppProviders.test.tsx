import { render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import type * as WorkspaceModule from "./WorkspaceProvider";
import type { ReactNode } from "react";

import { useAiUsageAccess } from "./AiUsageAccessProvider";
import { useHrAccess } from "./HrAccessProvider";
import { EnvironmentProvider } from "./EnvironmentProvider";
import { EnvironmentAwareWorkspaceProvider } from "./AppProviders";

vi.mock("./WorkspaceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  WorkspaceProvider: ({ children }: { readonly children: ReactNode }) => (
    <div data-testid="workspace-provider">{children}</div>
  ),
}));

const transport = vi.hoisted(() => ({
  pathname: "/en/master-data/storage-layouts",
  failed: false,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => transport.pathname,
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
  useQuery_experimental: ({
    query,
  }: {
    query: Parameters<typeof getFunctionName>[0];
  }) =>
    transport.failed
      ? { status: "error", error: new Error(getFunctionName(query)) }
      : { status: "pending" },
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
  it.each(["en", "th"])(
    "keeps %s Home available when HR and AI access reads fail",
    (locale) => {
      function AccessStatus() {
        const hr = useHrAccess();
        const aiUsage = useAiUsageAccess();
        return (
          <span>
            {hr.status} {aiUsage.status}
          </span>
        );
      }

      transport.pathname = `/${locale}/dashboard`;
      transport.failed = true;
      try {
        render(
          <EnvironmentProvider environment={configured}>
            <EnvironmentAwareWorkspaceProvider>
              <AccessStatus />
            </EnvironmentAwareWorkspaceProvider>
          </EnvironmentProvider>,
        );
        expect(screen.getByText("UNAVAILABLE UNAVAILABLE")).toBeVisible();
      } finally {
        transport.pathname = "/en/master-data/storage-layouts";
        transport.failed = false;
      }
    },
  );
});
