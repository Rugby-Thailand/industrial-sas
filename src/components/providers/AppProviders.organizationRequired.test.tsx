import { render, screen } from "@testing-library/react";
import type { GenericQueryCtx } from "convex/server";
import { getFunctionName } from "convex/server";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import type * as ConvexReact from "convex/react";
import { expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import type { DataModel } from "../../../convex/schema";
import { display } from "../../../convex/hr/access";
import { readCurrent } from "../../../convex/workspace/current";
import { access } from "../../../convex/aiUsage/reports";
import { createConvexTenantWorld } from "../../../tests/fixtures/convex-tenant-world";
import { messagesFor } from "@/i18n/messages";
import { EnvironmentAwareWorkspaceProvider } from "./AppProviders";
import { EnvironmentProvider } from "./EnvironmentProvider";
import { QueryErrorBoundary } from "@/components/system/QueryErrorBoundary";
import { OrganizationRequired } from "@/components/auth/OrganizationRequired";
import { resolveAppAccess } from "@/lib/auth/appAccess";

// Keep Convex's actual useQuery/useQuery_experimental, including error semantics.
// Only authentication and the transport cache are supplied by this test.
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof ConvexReact>()),
  useConvexAuth: () => ({
    isLoading: false,
    isAuthenticated: true,
    isRefreshing: false,
  }),
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "th",
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@clerk/nextjs", () => ({
  OrganizationList: () => <button>Choose organization</button>,
}));
// These sibling exports of AppProviders are outside the provider under test.
vi.mock("./IdentityProvider", () => ({ IdentityProvider: () => null }));
vi.mock("@/components/ui/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

it("keeps the organization chooser visible to an authenticated user with no active organization", async () => {
  const world = await createConvexTenantWorld();
  const session = world.t.withIdentity({ subject: "user_fixture_a" });
  expect(
    resolveAppAccess({
      identityConfigured: true,
      userId: "user_fixture_a",
      orgId: undefined,
    }),
  ).toBe("ORGANIZATION_REQUIRED");

  const errors = new Map<string, Error>();
  for (const [name, query] of [
    ["workspace/current:readCurrent", readCurrent],
    ["hr/access:display", display],
    ["aiUsage/reports:access", access],
  ] as const) {
    const runtime = query as unknown as {
      _handler: (ctx: GenericQueryCtx<DataModel>, args: {}) => Promise<unknown>;
    };
    try {
      await session.run((ctx) => runtime._handler(ctx, {}));
      throw new Error(
        `Expected the actual ${name} handler to deny a missing org claim`,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain("ACTIVE_ORGANIZATION_MISSING");
      errors.set(name, error as Error);
    }
  }

  // Convex's real hooks read these actual handler errors from a transport cache.
  // No network call or mocked hook return/error behavior is involved.
  const client = {
    watchQuery(reference: Parameters<typeof getFunctionName>[0]) {
      const error = errors.get(getFunctionName(reference));
      if (!error)
        throw new Error(`Unexpected query ${getFunctionName(reference)}`);
      return {
        onUpdate: () => () => {},
        localQueryResult: () => {
          throw error;
        },
        journal: () => undefined,
      };
    },
  } as unknown as ConvexReactClient;
  let caught: unknown;
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    render(
      <NextIntlClientProvider
        locale="th"
        messages={messagesFor("th")}
        timeZone="Asia/Bangkok"
      >
        <EnvironmentProvider
          environment={{
            backendConfigured: true,
            identityConfigured: true,
            convexUrl: "https://example.convex.cloud",
          }}
        >
          <ConvexProvider client={client}>
            <QueryErrorBoundary
              resetKey="root-layout"
              onFailure={(error) => {
                caught = error;
              }}
              fallback={() => <div data-testid="root-crash" />}
            >
              <EnvironmentAwareWorkspaceProvider>
                {await OrganizationRequired()}
              </EnvironmentAwareWorkspaceProvider>
            </QueryErrorBoundary>
          </ConvexProvider>
        </EnvironmentProvider>
      </NextIntlClientProvider>,
    );
    expect(caught).toBeUndefined();
    expect(screen.queryAllByTestId("root-crash")).toHaveLength(0);
    expect(
      screen.queryAllByRole("button", { name: "Choose organization" }).length,
      `root crash count: ${screen.queryAllByTestId("root-crash").length}`,
    ).toBe(1);
  } finally {
    consoleError.mockRestore();
  }
});
