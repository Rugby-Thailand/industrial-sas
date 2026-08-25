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
    renderPanel({ environment: testEnvironment });

    expect(screen.getByText("แสดงครบทุกรายการแล้ว")).toBeInTheDocument();
  });

  it("renders no pager at all before the read is possible", () => {
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
