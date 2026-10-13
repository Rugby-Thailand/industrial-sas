import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { appHistoryIndex, trackAppHistory } from "@/lib/browser/appHistory";
import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("convex/react", () => ({
  useQuery: () => ({
    ok: true,
    value: {
      ok: true,
      version: 0,
      shortcuts: [
        "hr.today",
        "hr.time",
        "hr.requests",
        "hr.holidays",
        "hr.profile",
      ].map((key) => ({ key, visible: true })),
    },
  }),
  useMutation: () => state.save,
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: ["hr.self.access"],
    timezoneSupported: true,
    timezone: "Asia/Bangkok",
    identityKey: "navigation:user",
    sites: [],
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => <a {...props} />,
  useRouter: () => ({
    back: () => window.history.back(),
    replace: (href: string) =>
      window.history.replaceState({}, "", `/th${href}`),
  }),
}));

import { HrShortcutCustomizeScreen } from "./ShortcutCustomizeScreen";
let stop: () => void;
const source = "/th/hr/today?shift=night#hr-customize-shortcuts";
function start() {
  return renderWithIntl(
    <DraftGuardProvider>
      <main>
        <HrShortcutCustomizeScreen />
      </main>
    </DraftGuardProvider>,
    { locale: "en", workspace: false, preserveProviders: true },
  );
}
beforeEach(() => {
  sessionStorage.clear();
  state.save.mockReset();
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/th/hr/time?month=2026-10#history",
  );
  stop = trackAppHistory();
});
afterEach(() => stop());

it.each([false, true])(
  "Back to Today consumes customization and next native Back restores the earlier workflow (dirty=%s)",
  async (dirty) => {
    window.history.pushState({}, "", source);
    window.history.pushState({}, "", "/th/hr/customize");
    start();
    if (dirty)
      fireEvent.click(screen.getByRole("checkbox", { name: "Show Profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to Today" }));
    if (dirty) {
      fireEvent.click(
        await screen.findByRole("button", { name: "Keep editing" }),
      );
      expect(
        screen.getByRole("checkbox", { name: "Show Profile" }),
      ).not.toBeChecked();
      fireEvent.click(screen.getByRole("button", { name: "Back to Today" }));
      fireEvent.click(
        await screen.findByRole("button", { name: "Discard changes" }),
      );
    }
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe(source),
    );
    expect(appHistoryIndex()).toBe(1);
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe("/th/hr/time"));
    expect(window.location.search + window.location.hash).toBe(
      "?month=2026-10#history",
    );
  },
);

it("Back to Today replaces a direct customization entry with its safe parent", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/th/hr/customize",
  );
  start();
  fireEvent.click(screen.getByRole("button", { name: "Back to Today" }));
  await waitFor(() =>
    expect(window.location.pathname + window.location.hash).toBe(
      "/th/hr/today#hr-customize-shortcuts",
    ),
  );
  expect(appHistoryIndex()).toBe(0);
});

it("Back to Today cannot discard a pending shortcut write", async () => {
  let finish!: (value: unknown) => void;
  state.save.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  window.history.pushState({}, "", source);
  window.history.pushState({}, "", "/th/hr/customize");
  start();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show Profile" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(screen.getByRole("button", { name: "Back to Today" }));
  expect(await screen.findByTestId("navigation-guard-pending")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Discard changes" }),
  ).toBeDisabled();
  expect(window.location.pathname).toBe("/th/hr/customize");
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await act(async () =>
    finish({
      ok: true,
      value: { written: false, error: { code: "PREFERENCES_STALE" } },
    }),
  );
});

it("customization remount retains owned Back to Today history and Forward restores only the explicit task", async () => {
  window.history.pushState({}, "", source);
  window.history.pushState({}, "", "/th/hr/customize");
  const view = start();
  view.unmount();
  start();
  fireEvent.click(screen.getByRole("button", { name: "Back to Today" }));
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe(source),
  );
  act(() => window.history.forward());
  await waitFor(() =>
    expect(window.location.pathname).toBe("/th/hr/customize"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe(source),
  );
});
