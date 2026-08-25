"use client";

import type { ReactNode } from "react";

import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { DEFAULT_LEDGER_PAGE_SIZE } from "@/lib/convex/ledgerApi";

export function InboundSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="mb-8 flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      {children}
    </section>
  );
}

function useWarehouseId(): string | undefined {
  return useWorkspace().selectedWarehouseId;
}

export function WithWarehouse({
  render,
}: {
  readonly render: (warehouseId: string) => ReactNode;
}) {
  const warehouseId = useWarehouseId();
  if (warehouseId === undefined) {
    return <LedgerPanelStatus state={{ kind: "WAREHOUSE_MISSING" }} />;
  }
  return <>{render(warehouseId)}</>;
}

export const pageArgs = (warehouseId: string, cursor: string | undefined) => ({
  warehouseId,
  maxPageSize: DEFAULT_LEDGER_PAGE_SIZE,
  ...(cursor === undefined ? {} : { cursor }),
});
