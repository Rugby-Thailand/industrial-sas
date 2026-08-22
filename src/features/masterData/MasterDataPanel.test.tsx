import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  configuredEnvironment,
  testEnvironment,
  renderWithIntl,
  unconfiguredEnvironment,
} from "../../../tests/fixtures/intl-render";

import { SuppliersPanel } from "./EntityPanels";
import { PREVIEW_SUPPLIERS } from "@tests/fixtures/data/masterData";

const convex = vi.hoisted(() => ({
  useConvexAuth: vi.fn(),
  useMutation: vi.fn(() => async () => undefined),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => convex);

/**
 * The pager `MasterDataPanel` renders, in the language an operator reads it in.
 *
 * The ledger side of this is covered by `BalancesPanel.test.tsx`; this is the
 * master-data side, and it exists because the two panels reach the same five
 * strings through separate `useTranslations` calls. A namespace that is wrong in
 * only one of them renders `Pagination.nextPage` onto a warehouse screen — and
 * `clientMessages.test.ts`, which reads the source graph rather than the output,
 * would still pass, because the manifest would simply follow the mistake.
 *
 * Suppliers is the subject because the list is organization-scoped, so the pager
 * renders without a warehouse having to be chosen first.
 */
const renderPanel = (environment: Parameters<typeof renderWithIntl>[1]) =>
  renderWithIntl(<SuppliersPanel />, { ...environment, workspace: false });

afterEach(() => {
  window.localStorage.clear();
});

beforeEach(() => {
  vi.clearAllMocks();
  convex.useConvexAuth.mockReturnValue({
    isAuthenticated: true,
    isLoading: false,
  });
  convex.useQuery.mockReturnValue({
    ok: true,
    requestId: "test_request",
    value: {
      ok: true,
      items: PREVIEW_SUPPLIERS,
      nextCursor: null,
      complete: true,
    },
  });
});

describe("MasterDataPanel paging chrome", () => {
  it("names the pager and its controls in Thai", () => {
    renderPanel({ environment: testEnvironment });

    // By accessible name, because that is the thing a key path would break: a
    // missing message renders as `Pagination.previousPage`, which still matches
    // a text query for the surrounding markup but never matches this.
    expect(
      screen.getByRole("navigation", { name: "การแบ่งหน้า" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "หน้าก่อนหน้า" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "หน้าถัดไป" }),
    ).toBeInTheDocument();
  });

  it("says the rows are complete when a page is the whole list", () => {
    // The preview supplier list is shorter than a page, so the panel reports the
    // end of the data rather than a page number. Both branches read from the
    // same namespace; this is the one an operator sees on most master data.
    renderPanel({ environment: testEnvironment });

    expect(screen.getByText("แสดงครบทุกรายการแล้ว")).toBeInTheDocument();
  });

  it("renders no pager at all before the read is possible", () => {
    // The gate runs first, so an unconfigured deployment shows the reason and
    // nothing else — including none of the chrome above.
    renderPanel({ environment: unconfiguredEnvironment });

    expect(screen.getByTestId("panel-BACKEND_MISSING")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("does not query tenant data before Convex authenticates", () => {
    convex.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    convex.useQuery.mockImplementation(() => {
      throw new Error("anonymous query");
    });
    renderPanel({ environment: configuredEnvironment });

    expect(screen.getByTestId("panel-SIGN_IN_REQUIRED")).toBeInTheDocument();
    expect(convex.useQuery).not.toHaveBeenCalled();
  });
});
