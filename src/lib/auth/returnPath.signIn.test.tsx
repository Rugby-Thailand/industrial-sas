import { isValidElement, type ComponentProps } from "react";
import { getURLFromRedirectError } from "next/dist/client/components/redirect";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { SignIn } from "@clerk/nextjs";
import { expect, it, vi } from "vitest";
import { RETURN_PATH_HEADER } from "./returnPath";

const state = vi.hoisted(() => ({ path: "" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ ["x-planner-return-path"]: state.path }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/auth/appAccess", () => ({
  readAppAccess: async () => "SIGN_IN",
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
vi.mock("@clerk/nextjs", () => ({ SignIn: () => null }));
vi.mock("@/i18n/navigation", () => ({ Link: () => null }));
vi.mock("@/components/ui/PageHeader", () => ({ PageHeader: () => null }));

import DesktopLayout from "@/app/[locale]/(desktop)/layout";
import SignInScreen from "@/app/[locale]/(auth)/sign-in/SignInScreen";

it.each([
  "/th/master-data/storage-layouts?floor=2",
  "/th/hr/leave",
  "/th/ai-usage?period=today&feature=search",
])(
  "retains the requested protected destination through sign-in: %s",
  async (path) => {
    expect(RETURN_PATH_HEADER).toBe("x-planner-return-path");
    state.path = path;
    let redirect = "";
    try {
      await DesktopLayout({
        children: null,
        params: Promise.resolve({ locale: "th" }),
      });
      throw new Error("The unauthenticated request did not redirect");
    } catch (error) {
      if (!isRedirectError(error)) throw error;
      redirect = getURLFromRedirectError(error) ?? "";
    }
    expect(redirect).toContain("/th/sign-in");
    const destination = new URL(redirect, "https://app.example");
    const returnTo = destination.searchParams.get("returnTo");
    vi.stubEnv(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "pk_test_Zm9vLWJhci0xMy5jbGVyay5hY2NvdW50cy5kZXYk",
    );
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_return_path");
    try {
      const tree = await SignInScreen({
        params: Promise.resolve({ locale: "th" }),
        searchParams: Promise.resolve(returnTo === null ? {} : { returnTo }),
      });
      const clerk = tree.props.children.find(
        (child: unknown) => isValidElement(child) && child.type === SignIn,
      );
      expect(isValidElement(clerk)).toBe(true);
      const props = clerk.props as ComponentProps<typeof SignIn>;
      const finalDestination =
        props.forceRedirectUrl ?? props.fallbackRedirectUrl;
      expect(
        Number(finalDestination === path),
        `requested ${path}, returned ${finalDestination}`,
      ).toBe(1);
    } finally {
      vi.unstubAllEnvs();
    }
  },
);
