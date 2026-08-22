import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import { BalancesTable } from "./BalancesTable";
import { TransactionsTable } from "./TransactionsTable";

import {
  PREVIEW_BALANCES,
  PREVIEW_TRANSACTIONS,
} from "@tests/fixtures/data/ledger";

/**
 * The tables are checked against the preview fixture rather than a two-row
 * stub: it carries every stock status, a reversal, a zero balance, and real
 * encoded bucket keys, so the axe pass covers the cells that actually differ.
 */
describe("inventory table accessibility", () => {
  it("BalancesTable has no detectable axe violations in Thai", async () => {
    const { container } = renderWithIntl(
      <BalancesTable rows={PREVIEW_BALANCES} />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  it("BalancesTable has no detectable axe violations in English", async () => {
    const { container } = renderWithIntl(
      <BalancesTable rows={PREVIEW_BALANCES} />,
      { locale: "en" },
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  it("TransactionsTable has no detectable axe violations in Thai", async () => {
    const { container } = renderWithIntl(
      <TransactionsTable rows={PREVIEW_TRANSACTIONS} />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
