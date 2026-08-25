"use client";

import { useQuery } from "convex/react";
import type { ReactNode } from "react";

import { QueryGate } from "@/components/system/QueryGate";
import { DEFAULT_LEDGER_PAGE_SIZE } from "@/lib/convex/ledgerApi";
import {
  listItemsRef,
  listLabelTemplatesRef,
  listReasonCodesRef,
  listSuppliersRef,
  type ItemRow,
  type LabelTemplateRow,
  type ReasonCodeRow,
  type ReasonCodeScope,
  type SupplierRow,
} from "@/lib/convex/masterDataApi";
import { OptionGate, type OptionSet } from "./OptionPicker";

export interface CatalogueSourceProps<Value> {
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly emptyTestId: string;
  readonly children: (values: readonly Value[]) => ReactNode;
}

const ready = <Value,>(values: readonly Value[]): OptionSet<Value> => ({
  kind: "READY",
  values,
});

export function CatalogueGate({
  render,
}: {
  readonly render: () => ReactNode;
}): ReactNode {
  return <QueryGate scope="ORG">{() => render()}</QueryGate>;
}

function toOptions<Row>(
  outcome:
    | { readonly ok: true; readonly value: { readonly ok: boolean } }
    | { readonly ok: false }
    | undefined,
  rows: () => readonly Row[],
): OptionSet<Row> {
  if (outcome === undefined) return { kind: "LOADING" };
  if (!outcome.ok || !outcome.value.ok) return ready<Row>([]);
  return ready(rows());
}

export function ActiveSuppliers(props: CatalogueSourceProps<SupplierRow>) {
  return <CatalogueGate render={() => <ServerSuppliers {...props} />} />;
}

function ServerSuppliers({
  children,
  ...rest
}: CatalogueSourceProps<SupplierRow>) {
  const outcome = useQuery(listSuppliersRef, {
    status: "ACTIVE",
    maxPageSize: DEFAULT_LEDGER_PAGE_SIZE,
  });

  return (
    <OptionGate
      {...rest}
      options={toOptions(outcome, () =>
        outcome?.ok && outcome.value.ok ? outcome.value.items : [],
      )}
    >
      {children}
    </OptionGate>
  );
}

export function ActiveItems(props: CatalogueSourceProps<ItemRow>) {
  return <CatalogueGate render={() => <ServerItems {...props} />} />;
}

function ServerItems({ children, ...rest }: CatalogueSourceProps<ItemRow>) {
  const outcome = useQuery(listItemsRef, {
    status: "ACTIVE",
    maxPageSize: DEFAULT_LEDGER_PAGE_SIZE,
  });

  return (
    <OptionGate
      {...rest}
      options={toOptions(outcome, () =>
        outcome?.ok && outcome.value.ok ? outcome.value.items : [],
      )}
    >
      {children}
    </OptionGate>
  );
}

export function ActiveReasonCodes({
  scope,
  ...props
}: CatalogueSourceProps<ReasonCodeRow> & { readonly scope: ReasonCodeScope }) {
  return (
    <CatalogueGate
      render={() => <ServerReasonCodes {...props} scope={scope} />}
    />
  );
}

function ServerReasonCodes({
  scope,
  children,
  ...rest
}: CatalogueSourceProps<ReasonCodeRow> & { readonly scope: ReasonCodeScope }) {
  const outcome = useQuery(listReasonCodesRef, {
    scope,
    maxPageSize: DEFAULT_LEDGER_PAGE_SIZE,
  });

  return (
    <OptionGate
      {...rest}
      options={toOptions(outcome, () =>
        outcome?.ok && outcome.value.ok
          ? outcome.value.items.filter((row) => row.status === "ACTIVE")
          : [],
      )}
    >
      {children}
    </OptionGate>
  );
}

export function PublishedLabelTemplates(
  props: CatalogueSourceProps<LabelTemplateRow>,
) {
  return <CatalogueGate render={() => <ServerTemplates {...props} />} />;
}

function ServerTemplates({
  children,
  ...rest
}: CatalogueSourceProps<LabelTemplateRow>) {
  const outcome = useQuery(listLabelTemplatesRef, {
    status: "ACTIVE",
    maxPageSize: DEFAULT_LEDGER_PAGE_SIZE,
  });

  return (
    <OptionGate
      {...rest}
      options={toOptions(outcome, () =>
        outcome?.ok && outcome.value.ok ? outcome.value.items : [],
      )}
    >
      {children}
    </OptionGate>
  );
}
