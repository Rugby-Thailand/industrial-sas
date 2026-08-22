import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  configuredEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";

const convex = vi.hoisted(() => ({
  useConvexAuth: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => convex);

import { ActiveReasonCodes } from "./CatalogueOptions";

describe("catalogue authentication gate", () => {
  beforeEach(() => {
    convex.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    convex.useQuery.mockImplementation(() => {
      throw Object.assign(new Error("anonymous query"), {
        data: { code: "ANONYMOUS" },
      });
    });
  });

  it("does not issue a tenant query before Convex authenticates", () => {
    renderWithIntl(
      <ActiveReasonCodes
        scope="ADJUSTMENT"
        emptyTitle="ไม่มีรหัสเหตุผล"
        emptyBody="ต้องตั้งค่ารหัสเหตุผลก่อน"
        emptyTestId="reason-codes-empty"
      >
        {() => <span>reason codes ready</span>}
      </ActiveReasonCodes>,
      { environment: configuredEnvironment, workspace: false },
    );

    expect(screen.getByTestId("panel-SIGN_IN_REQUIRED")).toBeInTheDocument();
    expect(convex.useQuery).not.toHaveBeenCalled();
  });
});
