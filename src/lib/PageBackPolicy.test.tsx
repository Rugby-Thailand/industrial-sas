import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { HrProfileScreen } from "@/features/hr/ProfileScreen";
import { HrTodayScreen } from "@/features/hr/TodayScreen";
import { HrHistoryScreen } from "@/features/hr/HistoryScreen";
import { HrHolidaysScreen } from "@/features/hr/HolidaysScreen";
import { HrSettingsScreen } from "@/features/hr/SettingsScreen";
import { HrShortcutCustomizeScreen } from "@/features/hr/ShortcutCustomizeScreen";
import { PageHeader } from "@/components/ui/PageHeader";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { useWorkflowStep } from "@/hooks/useWorkflowStep";
import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { useDraftGuard } from "@/components/providers/draftGuard";
import { moduleBackFallback } from "@/lib/pageBackFallback";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { messagesFor } from "@/i18n/messages";

const router = vi.hoisted(() => ({ back: vi.fn(), replace: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => <a {...props} />,
  useRouter: () => router,
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({ status: "LOADING" }),
  useHrCan: () => false,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  router.back.mockReset();
  router.replace.mockReset();
  window.history.replaceState({ appNavigationIndex: 0 }, "", "/en/hr/profile");
});
describe("module Back policy at actual callers", () => {
  it.each([
    ["Profile", HrProfileScreen, "/en/hr/profile"],
    ["Today", HrTodayScreen, "/en/hr/today"],
    ["History", HrHistoryScreen, "/en/hr/time"],
    ["Holidays", HrHolidaysScreen, "/en/hr/holidays"],
    ["Settings", HrSettingsScreen, "/en/hr/settings?section=policy"],
  ] as const)(
    "direct %s hub avoids a synthetic self or cross-module Back",
    (_name, Caller, path) => {
      window.history.replaceState({ appNavigationIndex: 0 }, "", path);
      renderWithIntl(<Caller />, { locale: "en", workspace: false });
      const back = screen.getByRole("button", { name: "Back" });
      expect(back).toBeDisabled();
      fireEvent.click(back);
      expect(router.replace).not.toHaveBeenCalled();
      expect(router.back).not.toHaveBeenCalled();
    },
  );
  it("a module hub retains Back to its real prior app page", () => {
    window.history.replaceState(
      { appNavigationIndex: 1 },
      "",
      "/th/hr/profile?section=contact#details",
    );
    renderWithIntl(<HrProfileScreen />, { locale: "en", workspace: false });
    const back = screen.getByRole("button", { name: "Back" });
    expect(back).toBeEnabled();
    fireEvent.click(back);
    expect(router.back).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();
  });
  it.each([
    "https://example.com/hr/today",
    "//example.com/hr/today",
    "/finished-goods",
    "/en/hr/profile",
    "/hr/profile#other",
    "/hr/../finished-goods",
    "/hr/\\finished-goods",
    "/hr/today\n",
  ])("rejects unsafe or self-loop header fallback %s", (fallback) => {
    renderWithIntl(<PageHeader title="Profile" backFallbackHref={fallback} />, {
      locale: "en",
      workspace: false,
    });
    const back = screen.getByRole("button", { name: "Back" });
    expect(back).toBeDisabled();
    fireEvent.click(back);
    expect(router.replace).not.toHaveBeenCalled();
  });
  it("uses a valid in-module breadcrumb parent for directly opened detail", () => {
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/th/hr/periods/period-a?focus=exceptions#rows",
    );
    renderWithIntl(
      <PageHeader
        title="Payroll period"
        breadcrumbs={[{ label: "Periods", href: "/hr/periods" }]}
      />,
      { locale: "th", workspace: false },
    );
    fireEvent.click(screen.getByRole("button", { name: "ย้อนกลับ" }));
    expect(router.replace).toHaveBeenCalledWith("/hr/periods");
    expect(router.back).not.toHaveBeenCalled();
  });
  it("treats explicit null as an audited hub even when breadcrumbs are present", () => {
    renderWithIntl(
      <PageHeader
        title="Profile"
        backFallbackHref={null}
        breadcrumbs={[{ label: "Today", href: "/hr/today" }]}
      />,
      { locale: "en", workspace: false },
    );
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
  it("returns direct shortcut customization to its explicit Today parent", () => {
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/en/hr/customize",
    );
    renderWithIntl(<HrShortcutCustomizeScreen />, {
      locale: "en",
      workspace: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(router.replace).toHaveBeenCalledWith("/hr/today");
  });
  it("keeps actual native origin locale, query and hash when returning from a hub", async () => {
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/th/finished-goods?search=stock#row-a",
    );
    const stop = trackAppHistory();
    try {
      window.history.pushState(
        {},
        "",
        "/th/hr/profile?section=contact#details",
      );
      router.back.mockImplementation(() => window.history.back());
      renderWithIntl(<HrProfileScreen />, { locale: "th", workspace: false });
      fireEvent.click(screen.getByRole("button", { name: "ย้อนกลับ" }));
      await waitFor(() =>
        expect(
          window.location.pathname +
            window.location.search +
            window.location.hash,
        ).toBe("/th/finished-goods?search=stock#row-a"),
      );
      expect(router.replace).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
  it("updates hub availability on same-URL history writes and native traversal", async () => {
    const stop = trackAppHistory();
    try {
      router.back.mockImplementation(() => window.history.back());
      renderWithIntl(<HrProfileScreen />, { locale: "en", workspace: false });
      const back = screen.getByRole("button", { name: "Back" });
      expect(back).toBeDisabled();
      act(() => window.history.pushState({}, "", window.location.href));
      await waitFor(() => expect(back).toBeEnabled());
      fireEvent.click(back);
      await waitFor(() => expect(back).toBeDisabled());
      expect(router.back).toHaveBeenCalledOnce();
      expect(router.replace).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
  it("honors an actual local predecessor on a direct hub without synthetic parent or app origin", async () => {
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/en/hr/profile?details=1&kept=yes#contact",
    );
    function Caller() {
      useWorkflowStep("details", "profile-details", true);
      return <PageHeader title="Profile details" backFallbackHref={null} />;
    }
    renderWithIntl(<Caller />, { locale: "en", workspace: false });
    const back = screen.getByRole("button", { name: "Back" });
    expect(back).toBeEnabled();
    fireEvent.click(back);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Back" })).toBeNull(),
    );
    expect(window.location.search + window.location.hash).toBe(
      "?kept=yes#contact",
    );
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
  it("applies conditional direct-editor parent without dropping list filters or fragment", () => {
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/th/hr/employees?status=active&employee=employee-a&mode=edit&focus=schedule#staff",
    );
    renderWithIntl(
      <PageHeader
        title="Employee"
        backFallbackHref={moduleBackFallback(
          window.location.pathname +
            window.location.search +
            window.location.hash,
        )}
      />,
      { locale: "th", workspace: false },
    );
    fireEvent.click(screen.getByRole("button", { name: "ย้อนกลับ" }));
    expect(router.replace).toHaveBeenCalledWith(
      "/hr/employees?status=active#staff",
    );
  });
  it("asks the real draft guard before taking a direct-link parent fallback", async () => {
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/en/hr/periods/period-a",
    );
    function Draft() {
      const [text, setText] = useState("unsent");
      useDraftGuard(text !== "", () => setText(""));
      return (
        <label>
          Draft
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
      );
    }
    renderWithIntl(
      <DraftGuardProvider>
        <PageHeader title="Period" backFallbackHref="/hr/periods" />
        <Draft />
      </DraftGuardProvider>,
      { locale: "en", workspace: false },
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("dialog", { name: "Save changes before leaving?" }),
    ).toBeVisible();
    expect(router.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue(
      "unsent",
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/hr/periods"),
    );
  });
  it("hydrates the same disabled state before enabling a valid child parent", async () => {
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/en/hr/periods/period-a",
    );
    const app = (
      <NextIntlClientProvider
        locale="en"
        messages={messagesFor("en")}
        timeZone="Asia/Bangkok"
      >
        <PageHeader title="Period" backFallbackHref="/hr/periods" />
      </NextIntlClientProvider>
    );
    const markup = renderToString(app);
    expect(markup).toContain("disabled");
    const container = document.createElement("div");
    container.innerHTML = markup;
    document.body.appendChild(container);
    const recoverable = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, app, { onRecoverableError: recoverable });
      });
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Back" })).toBeEnabled(),
      );
      expect(recoverable).not.toHaveBeenCalled();
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });
});
