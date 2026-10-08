import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import type * as environmentModule from "@/lib/environment";
import {
  currentAppEnvironment,
  resolveAppEnvironment,
} from "@/lib/environment";
import SetupPage from "./page";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  setRequestLocale: vi.fn(),
}));
vi.mock("@/lib/environment", async (importOriginal) => ({
  ...(await importOriginal<typeof environmentModule>()),
  currentAppEnvironment: vi.fn(),
}));
vi.mock("@/components/ui/PageHeader", () => ({
  PageHeader: ({ title, summary }: { title: string; summary: string }) => (
    <header>
      <h1>{title}</h1>
      <p>{summary}</p>
    </header>
  ),
}));

beforeEach(() => vi.clearAllMocks());

it.each([
  [true, true, "configuredTitle", "configuredIntro"],
  [false, true, "title", "intro"],
  [true, false, "title", "intro"],
  [false, false, "title", "intro"],
] as const)(
  "reports the setup heading accurately for backend=%s and identity=%s",
  async (backend, identity, title, intro) => {
    const environment = resolveAppEnvironment({
      convexUrl: backend ? "https://example.convex.cloud" : undefined,
      clerkPublishableKey: identity
        ? "pk_test_Zm9vLWJhci0xMy5jbGVyay5hY2NvdW50cy5kZXYk"
        : undefined,
    });
    vi.mocked(currentAppEnvironment).mockReturnValue(environment);
    renderWithIntl(
      await SetupPage({ params: Promise.resolve({ locale: "en" }) }),
      {
        locale: "en",
        environment,
      },
    );
    expect(screen.getByRole("heading", { name: title })).toBeVisible();
    expect(screen.getByText(intro)).toBeVisible();
  },
);
