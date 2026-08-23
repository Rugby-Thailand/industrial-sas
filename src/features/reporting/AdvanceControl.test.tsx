import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

const advance = vi.fn();
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: () => advance,
  useQuery: () => undefined,
}));

import {
  configuredEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";
import { PREVIEW_REPORT_JOBS } from "@tests/fixtures/data/reporting";

import { ServerAdvance } from "./ExportWorkbench";

/**
 * What the advance control does with an answer it does not like.
 *
 * The defect this covers: the control fired the mutation and ignored the result.
 * A refused chunk then looked exactly like a successful one — the row count
 * simply did not move — so an operator pressed it again, and again, on an export
 * that had already stopped. Nothing on screen and nothing announced.
 *
 * Every ending is asserted, and each is announced through `role="alert"`,
 * because the answer arrives after the press: a screen-reader user has already
 * moved on and has to be *told* rather than shown.
 */
const RUNNING_JOB = PREVIEW_REPORT_JOBS.find((job) => job.status === "RUNNING");

/*
 * Rendered directly rather than through `JobList`. Outside preview the workspace
 * resolves no warehouse until an identity provider exists, so the parent cannot
 * currently select this branch — testing through it would assert the Clerk gate
 * instead of this component's behaviour.
 */
const render = () => {
  writeStoredWarehouse("prv_wh_bangpoo");
  if (RUNNING_JOB === undefined) throw new Error("fixture has no running job");
  renderWithIntl(<ServerAdvance job={RUNNING_JOB} warehouseId="wh_1" />, {
    environment: configuredEnvironment,
  });
};

const press = () =>
  fireEvent.click(
    screen.getByTestId(`report-advance-${RUNNING_JOB?.reportJobId}`),
  );

describe("advancing an export in real mode", () => {
  it("says nothing when the chunk ran", async () => {
    advance.mockResolvedValueOnce({
      ok: true,
      requestId: "req_1",
      value: { written: true, status: "RUNNING", complete: false },
    });
    render();
    press();

    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });

  it("shows a refusal with the server's own code", async () => {
    /*
     * `ARTIFACT_LIMIT_REACHED` means pressing again cannot help. The code stays
     * English because it is the only string that ties this screen to a log line.
     */
    advance.mockResolvedValueOnce({
      ok: true,
      requestId: "req_2",
      value: { written: false, error: { code: "ARTIFACT_LIMIT_REACHED" } },
    });
    render();
    press();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ARTIFACT_LIMIT_REACHED");
    expect(alert).toHaveTextContent("ไม่มีข้อมูลถูกเพิ่ม");
  });

  it("shows a denial with the request ID a supervisor can quote", async () => {
    advance.mockResolvedValueOnce({ ok: false, requestId: "req_denied_3" });
    render();
    press();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("req_denied_3");
  });

  it("distinguishes a transport failure, where pressing again is right", async () => {
    advance.mockRejectedValueOnce(new Error("offline"));
    render();
    press();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("กดอีกครั้งเพื่อลองใหม่");
  });

  it("re-enables the control after a failure, so the retry is possible", async () => {
    advance.mockRejectedValueOnce(new Error("offline"));
    render();
    press();

    await screen.findByRole("alert");
    expect(
      screen.getByTestId(`report-advance-${RUNNING_JOB?.reportJobId}`),
    ).not.toBeDisabled();
  });
});
