"use client";

/**
 * The three pieces every inbound screen needs, and nothing else.
 *
 * They live here rather than in `InboundPanels` or `InboundForms` because of what
 * importing one of those files costs. A module is the unit the bundler and the
 * message manifest both reason about: a putaway screen that imported
 * `InboundSection` from `InboundPanels` reached, through that one import, every
 * inbound table and therefore every inbound namespace — the receiving catalogue
 * alone is 10.5 kB of Thai that a putaway operator never reads.
 *
 * So the shared pieces are extracted to a module that names no namespace at all.
 * Nothing here may grow a `useTranslations` call: it is imported by every inbound
 * screen, so a namespace added here is paid for by all of them.
 */
import type { ReactNode } from "react";

import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { DEFAULT_LEDGER_PAGE_SIZE } from "@/lib/convex/ledgerApi";

/** A titled block. `PageHeader` owns the single `<h1>`; sections start at `<h2>`. */
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

/** Every inbound write needs the site it happens at. */
function useWarehouseId(): string | undefined {
  return useWorkspace().selectedWarehouseId;
}

/**
 * Wrap a form that cannot be rendered without a warehouse.
 *
 * The gate is a *precondition*, not an error: a supervisor who has not chosen a
 * site has not done anything wrong. Rendering the form and letting the server
 * refuse would waste a round trip and produce a message about a missing argument
 * rather than about a missing choice.
 */
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

/** The paging arguments every warehouse-scoped inbound list takes. */
export const pageArgs = (warehouseId: string, cursor: string | undefined) => ({
  warehouseId,
  maxPageSize: DEFAULT_LEDGER_PAGE_SIZE,
  ...(cursor === undefined ? {} : { cursor }),
});
