/**
 * Kiro audit probes — HR self-service copy and feedback.
 * Each test asserts the EXPECTED behaviour; a failure on current source is the
 * evidence. Convex is replaced by a map of query results keyed by function
 * name, following src/features/hr/ShortcutCustomizeScreen.test.tsx.
 *
 * Run: pnpm exec vitest run --config docs/reviews/system-audit-2026-10-14/kiro/vitest.config.mts hr
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  save: vi.fn(),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) =>
      args === "skip" ? undefined : state.queries.get(name(reference)),
    useMutation: () => state.save,
  };
});
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: ["hr.self.access"],
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    today: "2026-10-14",
    identityKey: "org-a:user-a",
    sites: [],
  }),
  useHrCan: () => true,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));

import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { hrRefs } from "@/lib/convex/hrApi";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { HrShortcutCustomizeScreen } from "@/features/hr/ShortcutCustomizeScreen";
import { HrShortcuts } from "@/features/hr/HrShortcuts";
import { HrProfileScreen } from "@/features/hr/ProfileScreen";

const KEYS = [
  "hr.today",
  "hr.time",
  "hr.requests",
  "hr.holidays",
  "hr.profile",
];
const defaults = () => KEYS.map((key) => ({ key, visible: true }));
const preferences = () => ({
  ok: true,
  requestId: "preferences-query",
  value: { ok: true, shortcuts: defaults(), version: 0 },
});

beforeEach(() => {
  state.queries.clear();
  state.save.mockReset();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/en/hr/customize");
  state.queries.set(getFunctionName(hrRefs.shortcutPreferences), preferences());
});

describe("HR shortcut preferences", () => {
  it("K-HR-01 a stale-version refusal does not also show the generic 'Try again / correct your entry' refusal", async () => {
    state.save.mockResolvedValueOnce({
      ok: true,
      value: { written: false, error: { code: "PREFERENCES_STALE" } },
    });
    renderWithIntl(
      <DraftGuardProvider>
        <main tabIndex={-1}>
          <HrShortcutCustomizeScreen />
        </main>
      </DraftGuardProvider>,
      { locale: "en", preserveProviders: true },
    );
    const list = screen.getByRole("list", { name: "Shortcut order" });
    fireEvent.click(
      within(list).getByRole("checkbox", { name: "Show Profile" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const refused = await screen.findByTestId("hr-write-refused");
    const notices = screen
      .getAllByRole("alert")
      .concat(
        screen.queryAllByText("Your shortcuts changed in another session."),
      )
      .map((node) => JSON.stringify(node.textContent));
    console.info("K-HR-01 visible refusal copy:", [...new Set(notices)]);
    // Expected: a stale write explains the real cause (another session) in
    // one place; it must not tell the user to retry/correct the same draft.
    expect(refused).not.toHaveTextContent("Try again");
    expect(refused).not.toHaveTextContent("correct it and try again");
  });

  it("K-HR-02 the Today page's own shortcut list does not link back to Today", () => {
    window.history.replaceState({}, "", "/en/hr/today");
    renderWithIntl(<HrShortcuts />, { locale: "en" });
    const section = screen.getByRole("region", { name: "Shortcuts" });
    const selfLinks = within(section)
      .queryAllByRole("link")
      .filter((link) => link.getAttribute("href") === "/hr/today")
      .map((link) => JSON.stringify(link.textContent));
    console.info("K-HR-02 links to /hr/today inside Today:", selfLinks);
    expect(selfLinks).toHaveLength(0);
  });
});

describe("HR profile", () => {
  it("K-HR-03 the profile card states the employee code and site once", () => {
    state.queries.set(getFunctionName(hrRefs.profile), {
      ok: true,
      requestId: "profile-query",
      value: {
        linked: true,
        timezone: "Asia/Bangkok",
        employed: true,
        employee: {
          id: "e1",
          code: "EMP-001",
          displayName: "Somchai Jaidee",
          status: "ACTIVE",
          site: { id: "w1", code: "HQ", name: "Head office" },
          employmentStartDate: "2026-01-05",
        },
      },
    });
    renderWithIntl(<HrProfileScreen />, { locale: "en" });
    const card = document.querySelector<HTMLElement>(
      "[aria-labelledby='hr-profile-heading']",
    )!;
    const codes = within(card).queryAllByText(/EMP-001/);
    const sites = within(card).queryAllByText(/Head office/);
    console.info(
      "K-HR-03 code nodes:",
      codes.map((n) => `${n.tagName}:${JSON.stringify(n.textContent)}`),
      "site nodes:",
      sites.map((n) => `${n.tagName}:${JSON.stringify(n.textContent)}`),
    );
    expect(codes).toHaveLength(1);
    expect(sites).toHaveLength(1);
  });
});
