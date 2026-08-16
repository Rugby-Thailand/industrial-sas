"use client";

/**
 * The option lists the inbound write forms choose from.
 *
 * Every one answers the same question in the same shape: *what may this operator
 * pick right now?* — a receiving dock, an open order, an order's open lines, a
 * task's ranked bins. Each is a component with a render prop rather than a hook,
 * and that is forced rather than stylistic: `useQuery` throws without a
 * `ConvexProvider`, there is no provider when no deployment is configured, and a
 * hook cannot decline to run. So the gate is resolved first and the branch that
 * queries is a separate component — the same split `MasterDataPanel` and
 * `EntityWriteForm` already use.
 *
 * The three endings are `OptionGate`'s, and the distinction that matters is
 * `READY` with zero options versus `BLOCKED`. "This warehouse has no dock
 * configured" is a master-data job for a supervisor; "you have not chosen a
 * warehouse" is one click. A form that showed an empty select for both would
 * send an operator to the wrong place.
 */
import { useQuery } from "convex/react";
import type { ReactNode } from "react";

import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { QueryGate } from "@/components/system/QueryGate";
import { DEFAULT_LEDGER_PAGE_SIZE } from "@/lib/convex/ledgerApi";
import {
  getReceiptRef,
  listInspectionsRef,
  listPurchaseOrderLinesRef,
  listPurchaseOrdersRef,
  listReceiptLinesRef,
  recommendPutawayLocationsRef,
  type InspectionRow,
  type PurchaseOrderLineRow,
  type PurchaseOrderRow,
  type RankedLocation,
  type ReceiptLineRow,
  type ReceiptRow,
} from "@/lib/convex/inboundApi";
import {
  listReceivingLocationsRef,
  type LocationRow,
} from "@/lib/convex/masterDataApi";
import { resolveLedgerGate } from "@/lib/convex/ledgerState";
import {
  previewInspectionsFor,
  previewOrderLinesFor,
  previewPurchaseOrdersFor,
  previewReceiptById,
  previewReceiptsFor,
  previewReceiptLinesFor,
  previewRecommendation,
} from "@/lib/preview/inboundPreview";
import { previewLocationsFor } from "@/lib/preview/masterDataPreview";

import { OptionGate, type OptionSet } from "./OptionPicker";

/** What every option source hands its caller. */
export interface OptionSourceProps<Value> {
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly emptyTestId: string;
  readonly children: (values: readonly Value[]) => ReactNode;
}

const ready = <Value,>(values: readonly Value[]): OptionSet<Value> => ({
  kind: "READY",
  values,
});

/**
 * The gate every inbound picker shares.
 *
 * Warehouse-scoped, because every inbound read is: a delivery arrives at a site,
 * and a picker that answered before a site was chosen would be answering about
 * nowhere.
 */
function useInboundGate() {
  const environment = useAppEnvironment();
  const warehouseId = useWorkspace().selectedWarehouseId;
  return {
    gate: resolveLedgerGate(environment, warehouseId, "WAREHOUSE"),
    preview: environment.previewMode,
  };
}

/** Render the gate's own status, or hand the caller a resolved warehouse. */
function GateOr({
  render,
}: {
  readonly render: (warehouseId: string, preview: boolean) => ReactNode;
}): ReactNode {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId, preview) => render(warehouseId, preview)}
    </QueryGate>
  );
}

/* -------------------------------------------------------------------------- */
/* Receiving locations                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The docks and staging lanes a receipt line may be posted to.
 *
 * The type rule lives on the server (`RECEIVING_LOCATION_TYPES`) and is not
 * restated on this side: a client-side filter would be a second copy of a domain
 * rule, and the copy is the one that drifts. The preview branch filters the
 * fixture because the fixture *is* the data there.
 *
 * The answer is complete: the server reads through an index whose prefix
 * includes the location type, so rack volume cannot hide a dock.
 */
export function ReceivingLocations(props: OptionSourceProps<LocationRow>) {
  return (
    <GateOr
      render={(warehouseId, preview) =>
        preview ? (
          <OptionGate
            {...props}
            options={ready(
              previewLocationsFor(warehouseId).filter((location) =>
                ["DOCK", "STAGING"].includes(location.locationType),
              ),
            )}
          >
            {props.children}
          </OptionGate>
        ) : (
          <ServerReceivingLocations {...props} warehouseId={warehouseId} />
        )
      }
    />
  );
}

function ServerReceivingLocations({
  warehouseId,
  children,
  ...rest
}: OptionSourceProps<LocationRow> & { readonly warehouseId: string }) {
  const outcome = useQuery(listReceivingLocationsRef, { warehouseId });

  const options: OptionSet<LocationRow> =
    outcome === undefined
      ? { kind: "LOADING" }
      : !outcome.ok || !outcome.value.ok
        ? ready([])
        : ready(outcome.value.items);

  return (
    <OptionGate {...rest} options={options}>
      {children}
    </OptionGate>
  );
}

/* -------------------------------------------------------------------------- */
/* Purchase orders and their open lines                                        */
/* -------------------------------------------------------------------------- */

/** The orders at this site that may still be received against. */
export function OpenPurchaseOrders(props: OptionSourceProps<PurchaseOrderRow>) {
  return (
    <GateOr
      render={(warehouseId, preview) =>
        preview ? (
          <OptionGate
            {...props}
            options={ready(
              previewPurchaseOrdersFor(warehouseId).filter(
                (order) => order.status === "OPEN",
              ),
            )}
          >
            {props.children}
          </OptionGate>
        ) : (
          <ServerOpenOrders {...props} warehouseId={warehouseId} />
        )
      }
    />
  );
}

function ServerOpenOrders({
  warehouseId,
  children,
  ...rest
}: OptionSourceProps<PurchaseOrderRow> & { readonly warehouseId: string }) {
  const outcome = useQuery(listPurchaseOrdersRef, {
    warehouseId,
    status: "OPEN",
    maxPageSize: DEFAULT_LEDGER_PAGE_SIZE,
  });

  const options: OptionSet<PurchaseOrderRow> =
    outcome === undefined
      ? { kind: "LOADING" }
      : !outcome.ok || !outcome.value.ok
        ? ready([])
        : ready(outcome.value.items);

  return (
    <OptionGate {...rest} options={options}>
      {children}
    </OptionGate>
  );
}

/**
 * The lines of one order that are still open.
 *
 * Narrowed by the server through `by_orgId_purchaseOrderId_status`, not filtered
 * here: a complete, cancelled, or short-closed line cannot be received against,
 * and offering one would be offering a choice the server refuses.
 */
export function OpenOrderLines({
  purchaseOrderId,
  ...props
}: OptionSourceProps<PurchaseOrderLineRow> & {
  readonly purchaseOrderId: string | undefined;
}) {
  return (
    <GateOr
      render={(warehouseId, preview) =>
        purchaseOrderId === undefined ? (
          <OptionGate {...props} options={ready<PurchaseOrderLineRow>([])}>
            {props.children}
          </OptionGate>
        ) : preview ? (
          <OptionGate
            {...props}
            options={ready(
              previewOrderLinesFor(purchaseOrderId).filter(
                (line) => line.status === "OPEN",
              ),
            )}
          >
            {props.children}
          </OptionGate>
        ) : (
          <ServerOpenLines
            {...props}
            warehouseId={warehouseId}
            purchaseOrderId={purchaseOrderId}
          />
        )
      }
    />
  );
}

function ServerOpenLines({
  warehouseId,
  purchaseOrderId,
  children,
  ...rest
}: OptionSourceProps<PurchaseOrderLineRow> & {
  readonly warehouseId: string;
  readonly purchaseOrderId: string;
}) {
  const outcome = useQuery(listPurchaseOrderLinesRef, {
    warehouseId,
    purchaseOrderId,
    status: "OPEN",
    maxPageSize: DEFAULT_LEDGER_PAGE_SIZE,
  });

  const options: OptionSet<PurchaseOrderLineRow> =
    outcome === undefined
      ? { kind: "LOADING" }
      : !outcome.ok || !outcome.value.ok
        ? ready([])
        : ready(outcome.value.items);

  return (
    <OptionGate {...rest} options={options}>
      {children}
    </OptionGate>
  );
}

/* -------------------------------------------------------------------------- */
/* One receipt, and the lines posted against it                                */
/* -------------------------------------------------------------------------- */

/**
 * The receipt a *demonstrated* open-receipt stands in for.
 *
 * Preview writes nothing, so no receipt ID comes back from opening one — and a
 * flow that stopped there would leave the whole capture step, which is the part
 * an operator spends their shift in, unreachable and untested on the shell it
 * was designed for.
 *
 * So the demonstration continues against a fixture receipt that already exists
 * in the preview data. This is not a fake write: nothing was created, the
 * outcome still reads DEMONSTRATED, and the screen says which receipt the rest
 * of the walkthrough is about. Real mode gets `undefined` and never takes this
 * path, because `onDemonstrated` only fires in preview.
 */
export function useDemonstrationReceiptId(): string | undefined {
  const { gate, preview } = useInboundGate();
  if (!preview || gate.kind !== "READY_TO_QUERY") return undefined;
  return previewReceiptsFor(gate.warehouseId)[0]?.receiptId;
}

/**
 * The receipt a screen is working on.
 *
 * Empty when the identifier names nothing this tenant owns — the same answer a
 * nonexistent receipt produces, because the server cannot distinguish them
 * either (`INV-0002-03`).
 */
export function Receipt({
  receiptId,
  ...props
}: OptionSourceProps<ReceiptRow> & { readonly receiptId: string }) {
  return (
    <GateOr
      render={(warehouseId, preview) =>
        preview ? (
          <OptionGate
            {...props}
            options={ready(
              [previewReceiptById(receiptId)].filter(
                (row): row is ReceiptRow => row !== undefined,
              ),
            )}
          >
            {props.children}
          </OptionGate>
        ) : (
          <ServerReceipt
            {...props}
            warehouseId={warehouseId}
            receiptId={receiptId}
          />
        )
      }
    />
  );
}

function ServerReceipt({
  warehouseId,
  receiptId,
  children,
  ...rest
}: OptionSourceProps<ReceiptRow> & {
  readonly warehouseId: string;
  readonly receiptId: string;
}) {
  const outcome = useQuery(getReceiptRef, { warehouseId, receiptId });

  const options: OptionSet<ReceiptRow> =
    outcome === undefined
      ? { kind: "LOADING" }
      : !outcome.ok || !outcome.value.found
        ? ready([])
        : ready([outcome.value.receipt]);

  return (
    <OptionGate {...rest} options={options}>
      {children}
    </OptionGate>
  );
}

/**
 * The lines already posted against a receipt.
 *
 * The pallet build and the label both need them: a pallet is built *from*
 * received lines, and the label is generated for the pallet those lines were put
 * on. Reading them here keeps both steps honest when the receipt is empty — the
 * sections say so instead of offering a control that would refuse.
 */
export function PostedReceiptLines({
  receiptId,
  ...props
}: OptionSourceProps<ReceiptLineRow> & { readonly receiptId: string }) {
  return (
    <GateOr
      render={(warehouseId, preview) =>
        preview ? (
          <OptionGate
            {...props}
            options={ready(previewReceiptLinesFor(receiptId))}
          >
            {props.children}
          </OptionGate>
        ) : (
          <ServerReceiptLines
            {...props}
            warehouseId={warehouseId}
            receiptId={receiptId}
          />
        )
      }
    />
  );
}

function ServerReceiptLines({
  warehouseId,
  receiptId,
  children,
  ...rest
}: OptionSourceProps<ReceiptLineRow> & {
  readonly warehouseId: string;
  readonly receiptId: string;
}) {
  const outcome = useQuery(listReceiptLinesRef, {
    warehouseId,
    receiptId,
    maxPageSize: DEFAULT_LEDGER_PAGE_SIZE,
  });

  const options: OptionSet<ReceiptLineRow> =
    outcome === undefined
      ? { kind: "LOADING" }
      : !outcome.ok || !outcome.value.ok
        ? ready([])
        : ready(outcome.value.items);

  return (
    <OptionGate {...rest} options={options}>
      {children}
    </OptionGate>
  );
}

/* -------------------------------------------------------------------------- */
/* Inspections waiting for a second person                                     */
/* -------------------------------------------------------------------------- */

/**
 * The inspections a *different* actor may approve.
 *
 * Read as a list rather than typed as an ID, and that is what preserves
 * maker-checker in practice: the approver is a second signed-in person who did
 * not submit the disposition, and asking them to obtain the inspection's
 * document ID from the submitter would either not happen or happen by
 * screenshot. They pick it from the queue their own permission can read.
 *
 * The server still decides. `quality.disposition.approve` carries maker-checker,
 * and the submitter selecting their own inspection here is denied
 * (`INV-0006-05`) — the list is a convenience, never the control.
 */
export function PendingInspections(props: OptionSourceProps<InspectionRow>) {
  return (
    <GateOr
      render={(warehouseId, preview) =>
        preview ? (
          <OptionGate
            {...props}
            options={ready(
              previewInspectionsFor(warehouseId).filter(
                (row) => row.status === "PENDING_APPROVAL",
              ),
            )}
          >
            {props.children}
          </OptionGate>
        ) : (
          <ServerPendingInspections {...props} warehouseId={warehouseId} />
        )
      }
    />
  );
}

function ServerPendingInspections({
  warehouseId,
  children,
  ...rest
}: OptionSourceProps<InspectionRow> & { readonly warehouseId: string }) {
  const outcome = useQuery(listInspectionsRef, {
    warehouseId,
    status: "PENDING_APPROVAL",
    maxPageSize: DEFAULT_LEDGER_PAGE_SIZE,
  });

  const options: OptionSet<InspectionRow> =
    outcome === undefined
      ? { kind: "LOADING" }
      : !outcome.ok || !outcome.value.ok
        ? ready([])
        : ready(outcome.value.items);

  return (
    <OptionGate {...rest} options={options}>
      {children}
    </OptionGate>
  );
}

/* -------------------------------------------------------------------------- */
/* Putaway confirmation options                                                */
/* -------------------------------------------------------------------------- */

/**
 * The locations a confirmation may choose from.
 *
 * These come from the **same recommendation the operator was shown** — after a
 * claim, the trace the server stored. That is what makes the picker
 * hard-constraint safe without the client knowing what a hard constraint is: a
 * bin the filters rejected never entered the ranked list, so it can never be
 * offered, and the server validates the choice against the same trace
 * (`INV-0007-08`).
 */
export function RankedPutawayLocations({
  putawayTaskId,
  ...props
}: OptionSourceProps<RankedLocation> & {
  readonly putawayTaskId: string;
}) {
  return (
    <GateOr
      render={(warehouseId, preview) =>
        preview ? (
          <OptionGate
            {...props}
            options={ready(
              (() => {
                const recommendation = previewRecommendation();
                return recommendation.ok ? recommendation.ranked : [];
              })(),
            )}
          >
            {props.children}
          </OptionGate>
        ) : (
          <ServerRankedLocations
            {...props}
            warehouseId={warehouseId}
            putawayTaskId={putawayTaskId}
          />
        )
      }
    />
  );
}

function ServerRankedLocations({
  warehouseId,
  putawayTaskId,
  children,
  ...rest
}: OptionSourceProps<RankedLocation> & {
  readonly warehouseId: string;
  readonly putawayTaskId: string;
}) {
  const outcome = useQuery(recommendPutawayLocationsRef, {
    warehouseId,
    putawayTaskId,
  });

  const options: OptionSet<RankedLocation> =
    outcome === undefined
      ? { kind: "LOADING" }
      : !outcome.ok || !outcome.value.ok
        ? ready([])
        : ready(outcome.value.ranked);

  return (
    <OptionGate {...rest} options={options}>
      {children}
    </OptionGate>
  );
}
