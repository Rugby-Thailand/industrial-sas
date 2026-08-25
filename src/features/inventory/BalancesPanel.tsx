"use client";

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
