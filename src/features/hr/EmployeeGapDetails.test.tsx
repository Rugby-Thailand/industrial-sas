import { screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
const state = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  mutate: vi.fn(),
}));
vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (ref: Parameters<typeof name>[0], args: unknown) =>
      args === "skip" ? undefined : state.queries.get(name(ref)),
    useMutation: () => state.mutate,
  };
});
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: ["hr.self.access", "hr.team.review"],
    timezoneSupported: true,
    timezone: "Asia/Bangkok",
    today: "2026-10-20",
    identityKey: "gap-test:fixture",
    sites: [],
  }),
  useHrCan: () => true,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => <a {...props} />,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { hrRefs } from "@/lib/convex/hrApi";
import { HrDayScreen } from "./DayScreen";
import { ReviewDetail } from "./ReviewDetail";
beforeEach(() => {
  state.queries.clear();
  state.mutate.mockReset();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/en/hr/time/2026-10-05");
});
// Registered response shape is asserted in employee-hardening-review.test.ts.
const outside = {
  ok: true,
  value: { ok: false, code: "HR_OUTSIDE_EMPLOYMENT" },
};
it("self day outside employment explains the gap without correction controls", () => {
  state.queries.set(getFunctionName(hrRefs.selfDayDetail), outside);
  renderWithIntl(
    <DraftGuardProvider>
      <main>
        <HrDayScreen businessDate="2026-10-05" />
      </main>
    </DraftGuardProvider>,
    { locale: "en" },
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "This date is outside your employment",
  );
  expect(screen.queryByText("No attendance")).toBeNull();
  expect(screen.queryByTestId("hr-correction-submit")).toBeNull();
  expect(state.mutate).not.toHaveBeenCalled();
});
it("review day outside employment explains the gap without disposition controls", () => {
  state.queries.set(getFunctionName(hrRefs.reviewDayDetail), outside);
  renderWithIntl(
    <DraftGuardProvider>
      <main>
        <ReviewDetail employeeId="e2" businessDate="2026-10-05" />
      </main>
    </DraftGuardProvider>,
    { locale: "en" },
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "This date is outside your employment",
  );
  expect(screen.queryByText("No attendance")).toBeNull();
  expect(screen.queryByTestId("hr-dispose-submit")).toBeNull();
  expect(state.mutate).not.toHaveBeenCalled();
});
