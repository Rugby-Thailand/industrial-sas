import { fireEvent, screen, cleanup } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { hrRefs } from "@/lib/convex/hrApi";

const state = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) =>
    state.query(getFunctionName(reference), args),
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({ identityKey: "org:reviewer:not-linked" }),
}));

import { HrPagedState, HrPager, useHrPagedQuery } from "./HrPagedList";

function Registry() {
  const { view, paging } = useHrPagedQuery(
    hrRefs.employeesPage,
    {},
    "repeated-reset-audit",
  );
  return (
    <>
      <output data-testid="logical-page">{paging.page}</output>
      <HrPagedState view={view} refused={() => null}>
        {() => <p>Employee records ready</p>}
      </HrPagedState>
      <HrPager paging={paging} label="Employee pages" />
    </>
  );
}

afterEach(() => {
  cleanup();
  state.query.mockReset();
});

it("recovers the same invalid cursor again after an intervening ready page", () => {
  window.history.replaceState(null, "", "/en/hr/employees");
  state.query.mockImplementation(
    (_name: string, args: { cursor?: string }) => ({
      ok: true,
      requestId: "repeated-reset",
      value: args.cursor
        ? {
            ok: true,
            status: "reset",
            page: [],
            isDone: false,
            continueCursor: "",
            scanned: 0,
          }
        : {
            ok: true,
            status: "ready",
            page: [],
            isDone: false,
            continueCursor: "same-cursor",
            scanned: 0,
          },
    }),
  );
  renderWithIntl(<Registry />, { locale: "en" });

  for (let cycle = 0; cycle < 2; cycle += 1) {
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByTestId("logical-page")).toHaveTextContent("1");
    expect(screen.queryByTestId("hr-paged-updating")).toBeNull();
    expect(screen.queryByTestId("hr-paged-interrupted")).toBeNull();
    expect(state.query.mock.calls.at(-1)?.[1]).toEqual({ pageSize: 20 });
  }
  expect(
    state.query.mock.calls.filter(([, args]) => args.cursor === "same-cursor")
      .length,
  ).toBeGreaterThanOrEqual(2);
});
