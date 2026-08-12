import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import { TransactionsTable } from "./TransactionsTable";

import type { TransactionRow } from "@/lib/convex/ledgerApi";

const original: TransactionRow = {
  transactionId: "txn_original_0191f28e",
  type: "RECEIPT",
  operation: "inventory.transaction.post",
  requestId: "req_0191f28e",
  /* 2026-08-10T17:30:00Z is 2026-08-11 00:30 in Bangkok. */
  occurredAt: Date.UTC(2026, 7, 10, 17, 30, 0),
  businessDate: "2026-08-10",
  lineCount: 6,
};

const reversal: TransactionRow = {
  transactionId: "txn_reversal_0191f27c",
  type: "REVERSAL",
  operation: "inventory.transaction.reverse",
  requestId: "req_0191f27c",
  occurredAt: Date.UTC(2026, 7, 10, 18, 0, 0),
  businessDate: "2026-08-10",
  lineCount: 6,
  reversalOfTransactionId: original.transactionId,
};

describe("TransactionsTable", () => {
  it("renders transaction types as words in the active locale", () => {
    renderWithIntl(<TransactionsTable rows={[original]} />);
    expect(screen.getByText("รับสินค้า")).toBeInTheDocument();
  });

  it("marks a reversal and names the transaction it compensates", () => {
    renderWithIntl(<TransactionsTable rows={[reversal, original]} />);

    expect(screen.getByText("รายการกลับรายการ")).toBeInTheDocument();
    expect(
      screen.getByTitle(`กลับรายการของ: ${original.transactionId}`),
    ).toBeInTheDocument();
  });

  it("offers no way to edit or delete a posted transaction", () => {
    // The history is append-only (`INV-0003-08`); a row action here would be the
    // first place that stopped being true.
    renderWithIntl(<TransactionsTable rows={[reversal, original]} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("shows both the instant and the business date, which can disagree", () => {
    /*
     * The instant is 00:30 on 11 August in Bangkok; the business date the
     * warehouse counts it against is the 10th, because the receiving shift
     * started that day (`D-05`). A screen showing only one of them would make
     * that look like a defect.
     */
    renderWithIntl(<TransactionsTable rows={[original]} />);

    expect(screen.getByText("2026-08-10")).toBeInTheDocument();
    expect(screen.getByText(/00:30/)).toBeInTheDocument();
  });

  it("never renders a Buddhist Era year unless a caller asks for one", () => {
    const { container } = renderWithIntl(
      <TransactionsTable rows={[original]} />,
      { locale: "th" },
    );

    expect(container.textContent).not.toContain("2569");
  });

  it("puts the scroller in a named region a keyboard can reach", () => {
    // Five columns, two of them timestamps: this is the history screen's own
    // version of the trailing-content finding, and it had no cue and no tab stop.
    renderWithIntl(<TransactionsTable rows={[original]} />);

    const caption = "รายการเคลื่อนไหว 1 รายการ";
    const region = screen.getByRole("region", { name: caption });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("overflow-x-auto");
    expect(
      within(region).getByRole("table", { name: caption }),
    ).toBeInTheDocument();
  });

  it("tells a narrow screen that the columns continue past the edge", () => {
    renderWithIntl(<TransactionsTable rows={[original]} />);

    const hint = screen.getByText(
      "เลื่อนตารางไปทางซ้าย-ขวาเพื่อดูคอลัมน์ที่เหลือ",
    );
    expect(hint).toHaveClass("@2xl/table:hidden");
  });
});
