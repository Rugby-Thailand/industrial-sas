"use client";

/**
 * The master-data an inbound form has to choose from.
 *
 * Suppliers, items, reason codes, label templates. Each is the same shape as the
 * inbound option sources — gate first, then a component that queries — for the
 * same reason: `useQuery` throws without a `ConvexProvider`, and there is no
 * provider when no deployment is configured.
 *
 * ### Why these exist at all
 *
 * A form field named `supplierId` that takes typed text is a form that asks an
 * operator for a Convex document ID. Nobody has one. They would either paste it
 * from a URL or guess, and the server would answer `REFERENCE_NOT_FOUND` — a
 * refusal about a field they had no way to fill correctly. Every such field on
 * an inbound screen now selects from the tenant's own catalogue, displaying the
 * code a person recognises and sending the identifier the mutation needs.
 *
 * Deactivated rows are never offered. A withdrawn supplier or a retired template
 * is not a choice, and offering one produces a refusal the operator cannot act
 * on.
 */
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
  type SupplierRow,
} from "@/lib/convex/masterDataApi";
import {
  PREVIEW_LABEL_TEMPLATES,
  PREVIEW_SUPPLIERS,
  previewItems,
  previewReasonCodes,
} from "@/lib/preview/masterDataPreview";

import { OptionGate, type OptionSet } from "./OptionPicker";

/** What every catalogue source hands its caller. */
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

/**
 * The gate a catalogue read shares.
 *
 * Organization-scoped, unlike the inbound reads: a supplier, an item, a reason
 * code, and a template belong to the tenant rather than to a site, so these
 * pickers must not wait for a warehouse selection. Asking somebody to choose a
 * site before they can name a supplier would be a fiction.
 *
 * Exported for `ScanToItem`, which is the same kind of read behind the same
 * gate but lives in its own module so that the screens which only need a picker
 * do not reach the receiving catalogue through it.
 */
export function CatalogueGate({
  render,
}: {
  readonly render: (preview: boolean) => ReactNode;
}): ReactNode {
  return <QueryGate scope="ORG">{(_, preview) => render(preview)}</QueryGate>;
}

/** Turn a query answer into an option set, with `LOADING` kept distinct. */
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

/* -------------------------------------------------------------------------- */
/* Suppliers                                                                   */
/* -------------------------------------------------------------------------- */

export function ActiveSuppliers(props: CatalogueSourceProps<SupplierRow>) {
  return (
    <CatalogueGate
      render={(preview) =>
        preview ? (
          <OptionGate
            {...props}
            options={ready(
              PREVIEW_SUPPLIERS.filter((row) => row.status === "ACTIVE"),
            )}
          >
            {props.children}
          </OptionGate>
        ) : (
          <ServerSuppliers {...props} />
        )
      }
    />
  );
}

function ServerSuppliers({
  children,
  ...rest
}: CatalogueSourceProps<SupplierRow>) {
  // `status` is an argument the server serves from a status-first index, not a
  // filter applied afterwards, so a tenant with many retired suppliers still
  // sees the active ones.
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

/* -------------------------------------------------------------------------- */
/* Items                                                                       */
/* -------------------------------------------------------------------------- */

export function ActiveItems(props: CatalogueSourceProps<ItemRow>) {
  return (
    <CatalogueGate
      render={(preview) =>
        preview ? (
          <OptionGate
            {...props}
            options={ready(
              previewItems().filter((row) => row.status === "ACTIVE"),
            )}
          >
            {props.children}
          </OptionGate>
        ) : (
          <ServerItems {...props} />
        )
      }
    />
  );
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

/* -------------------------------------------------------------------------- */
/* Reason codes                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The reason codes of one scope.
 *
 * `scope` narrows the read through `by_orgId_scope_code`, which matters: a code
 * minted for scrap must not be offered as the justification for a short close,
 * and the scope is the closed set that makes that checkable rather than a naming
 * convention.
 *
 * The status filter is applied to the returned page rather than by the index —
 * `reasonCodes` has no status-first index — which is sound here because the read
 * is already narrowed to one scope, and a tenant with more than a page of reason
 * codes in a single scope has a data-entry problem rather than a paging one.
 */
export function ActiveReasonCodes({
  scope,
  ...props
}: CatalogueSourceProps<ReasonCodeRow> & { readonly scope: string }) {
  return (
    <CatalogueGate
      render={(preview) =>
        preview ? (
          <OptionGate
            {...props}
            options={ready(
              previewReasonCodes().filter(
                (row) => row.status === "ACTIVE" && row.scope === scope,
              ),
            )}
          >
            {props.children}
          </OptionGate>
        ) : (
          <ServerReasonCodes {...props} scope={scope} />
        )
      }
    />
  );
}

function ServerReasonCodes({
  scope,
  children,
  ...rest
}: CatalogueSourceProps<ReasonCodeRow> & { readonly scope: string }) {
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

/* -------------------------------------------------------------------------- */
/* Label templates                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The template versions a label may be generated from.
 *
 * `ACTIVE` only: a draft has not been through the second person publishing
 * requires (`INV-0006-05`), and a retired version is kept so an old label can be
 * traced rather than so new ones can be made from it. The server refuses both —
 * this stops an operator from choosing one in the first place.
 */
export function PublishedLabelTemplates(
  props: CatalogueSourceProps<LabelTemplateRow>,
) {
  return (
    <CatalogueGate
      render={(preview) =>
        preview ? (
          <OptionGate
            {...props}
            options={ready(
              PREVIEW_LABEL_TEMPLATES.filter((row) => row.status === "ACTIVE"),
            )}
          >
            {props.children}
          </OptionGate>
        ) : (
          <ServerTemplates {...props} />
        )
      }
    />
  );
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
