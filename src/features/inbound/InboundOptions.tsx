"use client";

import { useQuery } from "convex/react";
import type { ReactNode } from "react";

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
import { OptionGate, type OptionSet } from "./OptionPicker";

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

function GateOr({
  render,
}: {
  readonly render: (warehouseId: string) => ReactNode;
}): ReactNode {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => render(warehouseId)}
    </QueryGate>
  );
}

export function ReceivingLocations(props: OptionSourceProps<LocationRow>) {
  return (
    <GateOr
      render={(warehouseId) => (
        <ServerReceivingLocations {...props} warehouseId={warehouseId} />
      )}
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

export function OpenPurchaseOrders(props: OptionSourceProps<PurchaseOrderRow>) {
  return (
    <GateOr
      render={(warehouseId) => (
        <ServerOpenOrders {...props} warehouseId={warehouseId} />
      )}
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

export function OpenOrderLines({
  purchaseOrderId,
  ...props
}: OptionSourceProps<PurchaseOrderLineRow> & {
  readonly purchaseOrderId: string | undefined;
}) {
  return (
    <GateOr
      render={(warehouseId) =>
        purchaseOrderId === undefined ? (
          <OptionGate {...props} options={ready<PurchaseOrderLineRow>([])}>
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

export function Receipt({
  receiptId,
  ...props
}: OptionSourceProps<ReceiptRow> & { readonly receiptId: string }) {
  return (
    <GateOr
      render={(warehouseId) => (
        <ServerReceipt
          {...props}
          warehouseId={warehouseId}
          receiptId={receiptId}
        />
      )}
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

export function PostedReceiptLines({
  receiptId,
  ...props
}: OptionSourceProps<ReceiptLineRow> & { readonly receiptId: string }) {
  return (
    <GateOr
      render={(warehouseId) => (
        <ServerReceiptLines
          {...props}
          warehouseId={warehouseId}
          receiptId={receiptId}
        />
      )}
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

export function PendingInspections(props: OptionSourceProps<InspectionRow>) {
  return (
    <GateOr
      render={(warehouseId) => (
        <ServerPendingInspections {...props} warehouseId={warehouseId} />
      )}
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

// Validate against the stored recommendation the operator actually saw.
export function RankedPutawayLocations({
  putawayTaskId,
  ...props
}: OptionSourceProps<RankedLocation> & {
  readonly putawayTaskId: string;
}) {
  return (
    <GateOr
      render={(warehouseId) => (
        <ServerRankedLocations
          {...props}
          warehouseId={warehouseId}
          putawayTaskId={putawayTaskId}
        />
      )}
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
