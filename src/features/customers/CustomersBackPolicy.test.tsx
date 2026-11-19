import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { getTestMutation } from "@tests/fixtures/convex-mutation";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { trackAppHistory } from "@/lib/browser/appHistory";

const router = vi.hoisted(() => ({ back: vi.fn(), replace: vi.fn() }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: vi.fn(),
  getTranslations: async () => () => "Customers",
}));
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: getTestMutation,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => <a {...props} />,
  useRouter: () => router,
}));
// The route header must be available even while the list is loading.
vi.mock("@/features/customers/CustomerScreens", () => ({
  CustomerCatalogue: () => <p role="status">Loading customers</p>,
}));
import CustomersPage from "@/app/[locale]/(desktop)/master-data/customers/page";

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/master-data/customers?q=kept#list",
  );
});
it("the actual customer list route is a direct-entry hub while customers load", async () => {
  renderWithIntl(
    await CustomersPage({ params: Promise.resolve({ locale: "en" }) }),
    { locale: "en", workspace: false },
  );
  expect(
    screen.getByRole("heading", { name: "Customers", level: 1 }),
  ).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Loading customers");
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  expect(router.replace).not.toHaveBeenCalled();
});
it("the actual customer list header restores its real caller locale query and hash", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/th/finished-goods?search=stock#origin",
  );
  const stop = trackAppHistory();
  try {
    window.history.pushState({}, "", "/en/master-data/customers?q=kept#list");
    router.back.mockImplementation(() => window.history.back());
    renderWithIntl(
      await CustomersPage({ params: Promise.resolve({ locale: "en" }) }),
      { locale: "en", workspace: false },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    });
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/th/finished-goods?search=stock#origin"),
    );
    expect(router.replace).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});
