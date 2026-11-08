import { isValidElement, type ReactElement, type ReactNode } from "react";
import { getURLFromRedirectError } from "next/dist/client/components/redirect";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() =>
  vi.fn(async () => ({ userId: "user_1", orgId: "org_1" })),
);
vi.mock("@clerk/nextjs/server", () => ({ auth }));
vi.mock("@clerk/nextjs", () => ({ SignIn: () => null }));
vi.mock("@/i18n/navigation", () => ({ Link: () => null }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => undefined,
  getTranslations: async () => (key: string) => key,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-planner-return-path": "/th/setup" }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/components/auth/OrganizationRequired", () => ({
  OrganizationRequired: () => null,
}));
vi.mock("@/components/providers/WorkspaceAccessBoundary", () => ({
  WorkspaceAccessBoundary: () => null,
}));
vi.mock("@/components/shell/DesktopShell", () => ({
  DesktopShell: () => null,
}));

import { SignIn } from "@clerk/nextjs";
import { SetupChecklist } from "@/components/system/SetupChecklist";
import { readAppAccess } from "@/lib/auth/appAccess";
import DesktopLayout from "../../(desktop)/layout";
import SignInScreen from "./SignInScreen";

function containsType(node: ReactNode, type: unknown): boolean {
  if (Array.isArray(node))
    return node.some((child) => containsType(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return false;
  return node.type === type || containsType(node.props.children, type);
}

function findSignIn(
  node: ReactNode,
): ReactElement<{ forceRedirectUrl?: string }> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findSignIn(child);
      if (found) return found;
    }
    return undefined;
  }
  if (
    !isValidElement<{ children?: ReactNode; forceRedirectUrl?: string }>(node)
  )
    return undefined;
  return node.type === SignIn ? node : findSignIn(node.props.children);
}

beforeEach(() => {
  auth.mockClear();
  vi.stubEnv(
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    `pk_test_${btoa("clerk.example.com$")}`,
  );
});
afterEach(() => vi.unstubAllEnvs());

describe("Clerk configuration at the desktop gate and sign-in", () => {
  it.each([undefined, "", "   "])(
    "does not offer sign-in into a permanently rejected setup route with secret %j",
    async (secret) => {
      vi.stubEnv("CLERK_SECRET_KEY", secret);
      expect(await readAppAccess()).toBe("SIGN_IN");
      let redirectedTo: string | null = null;
      try {
        await DesktopLayout({
          children: null,
          params: Promise.resolve({ locale: "th" }),
        });
      } catch (error) {
        if (!isRedirectError(error)) throw error;
        redirectedTo = getURLFromRedirectError(error);
      }
      expect(redirectedTo).toBe("/th/sign-in?returnTo=%2Fth%2Fsetup");
      expect(auth).not.toHaveBeenCalled();
      const destination = new URL(redirectedTo!, "https://planner.invalid");
      const tree = await SignInScreen({
        params: Promise.resolve({ locale: "th" }),
        searchParams: Promise.resolve({
          returnTo: destination.searchParams.get("returnTo")!,
        }),
      });
      const form = findSignIn(tree);
      const rendersClerkSignIn = form ? 1 : 0;
      const rendersSetupChecklist = containsType(tree, SetupChecklist) ? 1 : 0;
      expect({ rendersClerkSignIn, rendersSetupChecklist }).toEqual({
        rendersClerkSignIn: 0,
        rendersSetupChecklist: 1,
      });
      // This is the same protected destination that just redirected back here.
      if (form) expect(form.props.forceRedirectUrl).toBe("/th/setup");
      expect(
        form,
        "a successful Clerk sign-in cannot satisfy the server's missing-key guard",
      ).toBeUndefined();
    },
  );

  it("allows a signed-in organization member when the server key is present", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_configured");
    expect(await readAppAccess()).toBe("APP");
    await expect(
      DesktopLayout({
        children: null,
        params: Promise.resolve({ locale: "th" }),
      }),
    ).resolves.toBeDefined();
    expect(auth).toHaveBeenCalledTimes(2);
    const tree = await SignInScreen({
      params: Promise.resolve({ locale: "th" }),
      searchParams: Promise.resolve({ returnTo: "/th/setup" }),
    });
    expect(findSignIn(tree)?.props.forceRedirectUrl).toBe("/th/setup");
  });
});
