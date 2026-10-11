import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const writes = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => ({
    ok: true,
    requestId: "query",
    value: getFunctionName(ref).endsWith(":accessMembers")
      ? { ok: true, provisioned: true, items: [] }
      : { ok: true, items: [], complete: true },
  }),
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref).endsWith(":saveHoliday") ? writes.save : vi.fn(),
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: ["hr.admin.manage"],
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    identityKey: "organization-qa|actor-qa",
    sites: [{ id: "site-qa", code: "QA", name: "QA Site" }],
  }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { guardedNavigate } from "@/lib/navigationGuard";
import { HrSettingsScreen } from "./SettingsScreen";

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/en/hr/settings");
});

it("protects a second holiday draft after the previous holiday saved successfully", async () => {
  writes.save.mockResolvedValue({
    ok: true,
    value: { written: true, documentId: "holiday-qa", replayed: false },
  });
  renderWithIntl(
    <DraftGuardProvider>
      <HrSettingsScreen />
    </DraftGuardProvider>,
    { locale: "en" },
  );
  const date = screen.getByLabelText(/^Date/);
  const name = screen.getByLabelText(/Name or reason/);
  fireEvent.change(date, { target: { value: "2026-02-03" } });
  fireEvent.change(name, { target: { value: "First QA holiday" } });
  fireEvent.click(screen.getByTestId("hr-holiday-add"));
  await waitFor(() => expect(writes.save).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(name).toHaveValue(""));
  // Settle the same-document guard buffer from the first saved command.
  act(() => {
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  });

  fireEvent.change(date, { target: { value: "2026-02-04" } });
  fireEvent.change(name, { target: { value: "Second unsent QA holiday" } });
  const leave = vi.fn();
  act(() => guardedNavigate(leave));
  expect(leave).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
  expect(name).toHaveValue("Second unsent QA holiday");
  expect(date).toHaveValue("2026-02-04");
  expect(writes.save).toHaveBeenCalledTimes(1);
});
