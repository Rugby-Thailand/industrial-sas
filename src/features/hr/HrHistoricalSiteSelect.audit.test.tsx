import { getFunctionName } from "convex/server";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { selectOptionLabels } from "@tests/fixtures/select-control";

const state = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) =>
    state.query(getFunctionName(reference), args),
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: ["hr.period.close"],
    identityKey: "org:reviewer:not-linked",
    timezoneSupported: true,
    sitesComplete: true,
    // The access preload is complete for active sites, not closed history.
    sites: [{ id: "active", code: "HQ", name: "Head office" }],
  }),
  useHrCan: () => true,
}));

import { HrSiteSelect } from "./HrSiteSelect";

afterEach(() => {
  cleanup();
  state.query.mockReset();
});

describe("historical site filtering", () => {
  it("offers a closed site even when the active preload is complete", () => {
    window.history.replaceState(null, "", "/en/hr/periods");
    state.query.mockReturnValue({
      ok: true,
      requestId: "historical-sites",
      value: {
        ok: true,
        status: "ready",
        page: [
          { id: "active", code: "HQ", name: "Head office", active: true },
          { id: "closed", code: "OLD", name: "Closed branch", active: false },
        ],
        isDone: true,
        continueCursor: "",
        scanned: 2,
        selected: null,
      },
    });
    renderWithIntl(
      <>
        <label htmlFor="historical-site">Historical site</label>
        <HrSiteSelect
          id="historical-site"
          surface="historical-site-audit"
          value=""
          onChange={() => {}}
          placeholder="All sites"
          emptyLabel="No sites"
          allLabel="All sites"
          includeInactive
        />
      </>,
      { locale: "en" },
    );

    expect(selectOptionLabels("Historical site")).toContain(
      "OLD · Closed branch",
    );
    expect(state.query).toHaveBeenCalledWith("hr/access:sitesPage", {
      includeInactive: true,
      pageSize: 20,
    });
  });
});
