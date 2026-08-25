export interface StockBalanceFact {
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly baseUom: string;
  readonly stockStatus: string;
  readonly baseMinorUnits: number;
  readonly lotId?: string;
  readonly lotCode?: string;
  readonly expirationDate?: string;
}

export interface ReservationFact {
  readonly itemId: string;
  readonly baseUom: string;
  readonly baseMinorUnits: number;
  readonly consumedBaseMinorUnits: number;
  readonly releasedBaseMinorUnits: number;
}

export interface StockSkuSummary {
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly baseUom: string;
  readonly availableBaseMinorUnits: number;
  readonly committedBaseMinorUnits: number;
  readonly atpBaseMinorUnits: number;
  readonly qcHoldBaseMinorUnits: number;
  readonly rejectedBaseMinorUnits: number;
  readonly otherBaseMinorUnits: number;
}

export function summarizeStockBySku(
  balances: readonly StockBalanceFact[],
  reservations: readonly ReservationFact[],
): readonly StockSkuSummary[] {
  const rows = new Map<string, StockSkuSummary>();
  for (const balance of balances) {
    const current = rows.get(balance.itemId) ?? {
      itemId: balance.itemId,
      sku: balance.sku,
      itemName: balance.itemName,
      baseUom: balance.baseUom,
      availableBaseMinorUnits: 0,
      committedBaseMinorUnits: 0,
      atpBaseMinorUnits: 0,
      qcHoldBaseMinorUnits: 0,
      rejectedBaseMinorUnits: 0,
      otherBaseMinorUnits: 0,
    };
    const quantity = balance.baseMinorUnits;
    const next = {
      ...current,
      ...(balance.stockStatus === "AVAILABLE"
        ? {
            availableBaseMinorUnits: current.availableBaseMinorUnits + quantity,
          }
        : balance.stockStatus === "QC_HOLD"
          ? { qcHoldBaseMinorUnits: current.qcHoldBaseMinorUnits + quantity }
          : balance.stockStatus === "REJECTED"
            ? {
                rejectedBaseMinorUnits:
                  current.rejectedBaseMinorUnits + quantity,
              }
            : { otherBaseMinorUnits: current.otherBaseMinorUnits + quantity }),
    };
    rows.set(balance.itemId, next);
  }
  for (const reservation of reservations) {
    const current = rows.get(reservation.itemId);
    if (current === undefined || current.baseUom !== reservation.baseUom)
      continue;
    const open = Math.max(
      0,
      reservation.baseMinorUnits -
        reservation.consumedBaseMinorUnits -
        reservation.releasedBaseMinorUnits,
    );
    rows.set(reservation.itemId, {
      ...current,
      committedBaseMinorUnits: current.committedBaseMinorUnits + open,
    });
  }
  return [...rows.values()]
    .map((row) => ({
      ...row,
      atpBaseMinorUnits: Math.max(
        0,
        row.availableBaseMinorUnits - row.committedBaseMinorUnits,
      ),
    }))
    .sort((left, right) => left.sku.localeCompare(right.sku));
}

export interface StockLotSummary {
  readonly itemId: string;
  readonly sku: string;
  readonly lotId: string;
  readonly lotCode: string;
  readonly expirationDate?: string;
  readonly baseUom: string;
  readonly availableBaseMinorUnits: number;
  readonly restrictedBaseMinorUnits: number;
}

export function summarizeStockByLot(
  balances: readonly StockBalanceFact[],
): readonly StockLotSummary[] {
  const rows = new Map<string, StockLotSummary>();
  for (const balance of balances) {
    if (balance.lotId === undefined || balance.lotCode === undefined) continue;
    const current = rows.get(balance.lotId) ?? {
      itemId: balance.itemId,
      sku: balance.sku,
      lotId: balance.lotId,
      lotCode: balance.lotCode,
      ...(balance.expirationDate === undefined
        ? {}
        : { expirationDate: balance.expirationDate }),
      baseUom: balance.baseUom,
      availableBaseMinorUnits: 0,
      restrictedBaseMinorUnits: 0,
    };
    rows.set(balance.lotId, {
      ...current,
      ...(balance.stockStatus === "AVAILABLE"
        ? {
            availableBaseMinorUnits:
              current.availableBaseMinorUnits + balance.baseMinorUnits,
          }
        : {
            restrictedBaseMinorUnits:
              current.restrictedBaseMinorUnits + balance.baseMinorUnits,
          }),
    });
  }
  return [...rows.values()].sort(
    (left, right) =>
      (left.expirationDate ?? "9999-12-31").localeCompare(
        right.expirationDate ?? "9999-12-31",
      ) || left.lotCode.localeCompare(right.lotCode),
  );
}

export type OperationalExceptionSeverity =
  "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface OperationalException {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly severity: OperationalExceptionSeverity;
  readonly titleCode: string;
  readonly detail: string;
  readonly occurredAt: number;
  readonly ownerUserId?: string;
}

const SEVERITY_RANK: Readonly<Record<OperationalExceptionSeverity, number>> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export function prioritizeOperationalExceptions(
  rows: readonly OperationalException[],
): readonly OperationalException[] {
  return [...rows].sort(
    (left, right) =>
      SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
      left.occurredAt - right.occurredAt ||
      left.sourceId.localeCompare(right.sourceId),
  );
}
