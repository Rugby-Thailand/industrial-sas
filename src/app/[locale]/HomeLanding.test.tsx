import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { clerkIdentityConfigured, readAppAccess } from "@/lib/auth/appAccess";
import { RETURN_PATH_HEADER } from "@/lib/auth/returnPath";
import { OrganizationRequired } from "@/components/auth/OrganizationRequired";
import LocaleRootPage from "./page";
import DesktopLayout from "./(desktop)/layout";
import SignInScreen from "./(auth)/sign-in/SignInScreen";

const request = vi.hoisted(() => ({ returnTo: "" }));
vi.mock("next/headers", () => ({
  headers: () => new Headers({ [RETURN_PATH_HEADER]: request.returnTo }),
}));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/auth/appAccess", () => ({
  readAppAccess: vi.fn(),
  clerkIdentityConfigured: vi.fn(),
}));
vi.mock("@/components/system/PublicInfoNav", () => ({
  PublicInfoNav: () => null,
}));
vi.mock("@/i18n/navigation", () => ({ Link: "a" }));
vi.mock("@/components/shell/DesktopShell", () => ({
  DesktopShell: () => null,
}));
vi.mock("@/components/providers/WorkspaceAccessBoundary", () => ({
  WorkspaceAccessBoundary: () => null,
}));
vi.mock("@/components/ui/PageHeader", () => ({ PageHeader: () => null }));
vi.mock("@/components/ui/Notice", () => ({ Notice: () => null }));
vi.mock("@clerk/nextjs", () => ({
  SignIn: ({
    forceRedirectUrl,
    fallbackRedirectUrl,
  }: {
    forceRedirectUrl?: string;
    fallbackRedirectUrl: string;
  }) => <a href={forceRedirectUrl ?? fallbackRedirectUrl}>Continue</a>,
  OrganizationList: ({
    afterSelectOrganizationUrl,
  }: {
    afterSelectOrganizationUrl: string;
  }) => <a href={afterSelectOrganizationUrl}>Select organization</a>,
}));

it.each([
  [undefined, "/en/dashboard"],
  ["https://example.org/elsewhere", "/en/dashboard"],
  ["/en/hr/leave?entry=a%20b#mine", "/en/hr/leave?entry=a%20b#mine"],
])("configures the sign-in destination for %s", async (returnTo, expected) => {
  vi.mocked(clerkIdentityConfigured).mockReturnValue(true);
  render(
    await SignInScreen({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve(returnTo === undefined ? {} : { returnTo }),
    }),
  );
  expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute(
    "href",
    expected,
  );
});
it.each(["th", "en"])(
  "lands a signed-in member on Home in %s",
  async (locale) => {
    vi.mocked(readAppAccess).mockResolvedValue("APP");
    await expect(
      LocaleRootPage({ params: Promise.resolve({ locale }) }),
    ).rejects.toMatchObject({
      digest: expect.stringContaining(`;/${locale}/dashboard;`),
    });
  },
);
it("preserves the exact private destination while the member selects an organization", async () => {
  vi.mocked(readAppAccess).mockResolvedValue("ORGANIZATION_REQUIRED");
  const params = Promise.resolve({ locale: "en" });
  await expect(LocaleRootPage({ params })).rejects.toMatchObject({
    digest: expect.stringContaining(";/en/dashboard;"),
  });
  request.returnTo = "/en/hr/requests?view=open&q=a%20b";
  const result = await DesktopLayout({ params, children: null });
  expect(result.type).toBe(OrganizationRequired);
  render(await OrganizationRequired(result.props));
  expect(screen.getByRole("link")).toHaveAttribute("href", request.returnTo);
});
it("sends a signed-out app launch back to the same localized Home after sign-in", async () => {
  vi.mocked(readAppAccess).mockResolvedValue("SIGN_IN");
  request.returnTo = "/th/dashboard?from=icon";
  const params = Promise.resolve({ locale: "th" });
  await expect(DesktopLayout({ params, children: null })).rejects.toMatchObject(
    {
      digest: expect.stringContaining(
        `;/th/sign-in?returnTo=${encodeURIComponent(request.returnTo)};`,
      ),
    },
  );
});
