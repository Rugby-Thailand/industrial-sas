"use client";

/**
 * The balances screen's data panel.
 *
 * Thin by design: `LedgerPanel` owns the gate, the paging, and the state
 * mapping; this file only says *which* query and *which* table. Adding a third
 * ledger read later should be this file again, not a fourth copy of the state
 * machine.
 */
import { BalancesTable } from "@/components/inventory/BalancesTable";
import { listBalancesRef, type BalanceRow } from "@/lib/convex/ledgerApi";

import { LedgerPanel } from "./LedgerPanel";

export function BalancesPanel() {
  return (
    <LedgerPanel<BalanceRow>
      queryRef={listBalancesRef}
      surface="balances"
      renderRows={(rows) => <BalancesTable rows={rows} />}
    />
  );
}
