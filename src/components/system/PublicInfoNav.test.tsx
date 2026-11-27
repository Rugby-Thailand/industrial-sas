import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import PublicInfoLayout from "@/app/[locale]/(public)/layout";
import About from "@/app/[locale]/(public)/about/page";
import Privacy from "@/app/[locale]/(public)/privacy/page";
import Terms from "@/app/[locale]/(public)/terms/page";
import SignInScreen from "@/app/[locale]/(auth)/sign-in/SignInScreen";

const navigation = vi.hoisted(() => ({
  locale: "th",
  query: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => navigation.query }));
vi.mock("next-intl", () => ({ useLocale: () => navigation.locale }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  setRequestLocale: () => {},
}));
vi.mock("@/components/ui/PageHeader", () => ({ PageHeader: () => null }));
vi.mock("@/components/system/SetupChecklist", () => ({
  SetupChecklist: () => null,
}));
vi.mock("@clerk/nextjs", () => ({
  SignIn: ({ forceRedirectUrl }: { forceRedirectUrl?: string }) => (
    <div data-redirect={forceRedirectUrl} />
  ),
}));

afterEach(() => vi.unstubAllEnvs());

function request(locale: string, returnTo?: string | string[]) {
  return {
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve(returnTo === undefined ? {} : { returnTo }),
  };
}

function internalLinks(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLAnchorElement>('a[href^="/"]'),
  );
}

it.each([
  ["th", "/th/hr/leave?view=requests&team=A%2BB#pending", true],
  ["en", "/en/master-data/storage-layouts/a?floor=2#plan", false],
] as const)(
  "keeps the %s task through public articles and both About sign-in links",
  async (locale, returnTo, configured) => {
    vi.stubEnv(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      `pk_test_${btoa("clerk.example.com$")}`,
    );
    vi.stubEnv("CLERK_SECRET_KEY", configured ? "sk_test_configured" : "");
    const view = render(await SignInScreen(request(locale, returnTo)));
    const signInLinks = internalLinks(view.container);
    expect(signInLinks.map((link) => link.pathname)).toEqual(
      configured
        ? ["/about", "/privacy", "/terms"]
        : ["/about", "/about", "/privacy", "/terms"],
    );
    navigation.locale = locale;
    let next: string = returnTo;
    for (const link of signInLinks) {
      expect(new URL(link.href).searchParams.getAll("returnTo")).toEqual([
        returnTo,
      ]);
    }
    for (const Page of [About, Terms, Privacy, About]) {
      navigation.query = new URLSearchParams({
        returnTo: next,
        unrelated: "discard",
      });
      view.rerender(
        <PublicInfoLayout>{await Page(request(locale))}</PublicInfoLayout>,
      );
      const links = internalLinks(view.container);
      for (const link of links) {
        expect([...new URL(link.href).searchParams]).toEqual([
          ["returnTo", returnTo],
        ]);
      }
      const signInLinks = links.filter((link) => link.pathname === "/sign-in");
      expect(signInLinks).toHaveLength(Page === About ? 2 : 1);
      next = new URL(signInLinks[0]!.href).searchParams.get("returnTo")!;
    }
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_configured");
    view.rerender(await SignInScreen(request(locale, next)));
    expect(view.container.querySelector("[data-redirect]")).toHaveAttribute(
      "data-redirect",
      returnTo,
    );
  },
);

it.each([
  undefined,
  "https://outside.example",
  "//outside.example",
  "/en/hr/leave",
  "/th/hr/../sign-in",
  ["/th/hr/leave", "/th/hr/today"],
])(
  "uses clean public and sign-in URLs for absent or invalid intent %j",
  async (returnTo) => {
    navigation.locale = "th";
    navigation.query = new URLSearchParams({ unrelated: "discard" });
    for (const value of [returnTo].flat()) {
      if (value !== undefined) navigation.query.append("returnTo", value);
    }
    for (const Page of [About, Terms, Privacy]) {
      const view = render(
        <PublicInfoLayout>{await Page(request("th"))}</PublicInfoLayout>,
      );
      const links = internalLinks(view.container);
      expect(links.length).toBeGreaterThan(3);
      expect(
        links.every((link) => link.search === "" && link.hash === ""),
      ).toBe(true);
      view.unmount();
    }
  },
);
