import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import {
  renderWithIntl,
  unconfiguredEnvironment,
} from "../../../tests/fixtures/intl-render";

import { LedgerPanelStatus } from "./LedgerPanelStatus";
import { SetupChecklist } from "./SetupChecklist";

import type { LedgerPanelState } from "@/lib/convex/ledgerState";

const FAILURE_STATES: readonly Exclude<
  LedgerPanelState<unknown>,
  { kind: "READY" }
>[] = [
  { kind: "BACKEND_MISSING" },
  { kind: "SIGN_IN_REQUIRED" },
  { kind: "WAREHOUSE_MISSING" },
  { kind: "LOADING" },
  { kind: "DENIED", requestId: "req_1" },
  { kind: "LEDGER_ERROR", code: "CURSOR_INVALID", requestId: "req_2" },
  { kind: "ERROR", code: "INTERNAL_ERROR" },
];

describe("system panel accessibility", () => {
  it.each(FAILURE_STATES.map((state) => [state.kind, state] as const))(
    "%s renders with no detectable axe violations",
    async (_kind, state) => {
      const { container } = renderWithIntl(
        <LedgerPanelStatus state={state} />,
        { environment: unconfiguredEnvironment },
      );

      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it("SetupChecklist has no detectable axe violations", async () => {
    const { container } = renderWithIntl(<SetupChecklist />, {
      environment: unconfiguredEnvironment,
    });

    expect(await axe(container)).toHaveNoViolations();
  });
});
