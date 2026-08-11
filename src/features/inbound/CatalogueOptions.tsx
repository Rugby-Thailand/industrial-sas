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
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { Notice } from "@/components/ui/Notice";
import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { DEFAULT_LEDGER_PAGE_SIZE } from "@/lib/convex/ledgerApi";
import {
  listItemsRef,
  listLabelTemplatesRef,
  listReasonCodesRef,
  listSuppliersRef,
  resolveScanToItemRef,
  type ItemRow,
  type LabelTemplateRow,
  type ReasonCodeRow,
  type SupplierRow,
} from "@/lib/convex/masterDataApi";
import { resolveLedgerGate } from "@/lib/convex/ledgerState";
import {
  PREVIEW_LABEL_TEMPLATES,
  PREVIEW_SUPPLIERS,
  previewItems,
  previewReasonCodes,
  previewResolveScan,
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
 */
function CatalogueGate({
  render,
}: {
  readonly render: (preview: boolean) => ReactNode;
}): ReactNode {
  const environment = useAppEnvironment();
  const warehouseId = useWorkspace().selectedWarehouseId;
  const gate = resolveLedgerGate(environment, warehouseId, "ORG");

  if (gate.kind !== "READY_TO_QUERY") {
    return (
      <OptionGate
        options={{ kind: "BLOCKED", gate }}
        emptyTitle=""
        emptyBody=""
        emptyTestId=""
      >
        {() => null}
      </OptionGate>
    );
  }
  return <>{render(environment.previewMode)}</>;
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
/* Scan resolution                                                             */
/* -------------------------------------------------------------------------- */

/** What a scan box has last decided. `undefined` means nothing scanned yet. */
export interface ScannedItem {
  readonly itemId: string;
  readonly sku: string;
}

/**
 * A scan box that turns what came off the carton into an item.
 *
 * The counterpart to the pickers above, for the moment when the operator is not
 * choosing from a list at all: they are holding a box, and the wedge scanner has
 * just typed a barcode into whatever had focus. Resolution is a server read
 * (`resolveScanToItem`) over the tenant's own barcodes and SKUs, because the
 * catalogue is the only thing that can say what a string refers to.
 *
 * A render prop rather than a callback, like every other source in this file:
 * the caller renders *with* the scanned item, so there is no effect firing into
 * somebody else's state and no moment where the form and the scan disagree.
 *
 * It is a separate control rather than a field inside the capture form for a
 * plain reason: a scanner ends its input with Enter, and a field that submitted
 * the whole receipt line on Enter would post half-filled lines all shift.
 */
export function ScanToItem({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint: string;
  readonly children: (scanned: ScannedItem | undefined) => ReactNode;
}) {
  return (
    <CatalogueGate
      render={(preview) =>
        preview ? (
          <PreviewScanToItem label={label} hint={hint}>
            {children}
          </PreviewScanToItem>
        ) : (
          <ServerScanToItem label={label} hint={hint}>
            {children}
          </ServerScanToItem>
        )
      }
    />
  );
}

interface ScanBranchProps {
  readonly label: string;
  readonly hint: string;
  readonly children: (scanned: ScannedItem | undefined) => ReactNode;
}

function PreviewScanToItem({ label, hint, children }: ScanBranchProps) {
  const [scan, setScan] = useState("");
  const resolved = scan === "" ? undefined : previewResolveScan(scan);

  return (
    <ScanShell
      label={label}
      hint={hint}
      onScan={setScan}
      // Preview resolves from the fixture the moment the scan is entered, so
      // there is no in-flight state to report.
      miss={scan !== "" && resolved === undefined}
    >
      {children(resolved)}
    </ScanShell>
  );
}

function ServerScanToItem({ label, hint, children }: ScanBranchProps) {
  const [scan, setScan] = useState("");
  const outcome = useQuery(
    resolveScanToItemRef,
    scan === "" ? "skip" : { scan },
  );

  const resolved =
    outcome !== undefined && outcome.ok && outcome.value.found
      ? { itemId: outcome.value.itemId, sku: outcome.value.sku }
      : undefined;

  return (
    <ScanShell
      label={label}
      hint={hint}
      onScan={setScan}
      /*
       * A miss only once the read has answered. Showing "unknown barcode" while
       * the query is still in flight would teach operators to rescan a label
       * that was about to resolve.
       */
      miss={scan !== "" && outcome !== undefined && resolved === undefined}
    >
      {children(resolved)}
    </ScanShell>
  );
}

/** The input, its explanation, its miss, and whatever the scan unlocked. */
function ScanShell({
  label,
  hint,
  onScan,
  miss,
  children,
}: {
  readonly label: string;
  readonly hint: string;
  readonly onScan: (scan: string) => void;
  readonly miss: boolean;
  readonly children: ReactNode;
}) {
  const t = useTranslations("Receiving");
  const [text, setText] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2" data-testid="scan-to-item">
        <label
          htmlFor="scan-to-item-input"
          className="text-sm font-medium text-text"
        >
          {label}
        </label>
        <p className="text-sm text-muted" id="scan-to-item-hint">
          {hint}
        </p>
        <div className="flex gap-2">
          <input
            id="scan-to-item-input"
            aria-describedby="scan-to-item-hint"
            value={text}
            onChange={(event) => setText(event.target.value)}
            /*
             * Enter resolves rather than submits. This control sits outside the
             * capture form precisely so a wedge's terminator cannot post a line.
             */
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onScan(text.trim());
              }
            }}
            className="min-h-touch w-full rounded-md border border-border-strong bg-surface px-3 py-2 font-mono text-sm"
          />
          <button
            type="button"
            data-testid="scan-to-item-resolve"
            onClick={() => onScan(text.trim())}
            className="min-h-touch rounded-md border border-border-strong bg-surface px-4 font-semibold"
          >
            {t("scanResolve")}
          </button>
        </div>
        {miss ? (
          <Notice
            tone="warning"
            title={t("scanUnknown")}
            body={t("scanUnknownHint")}
            testId="scan-to-item-unknown"
          />
        ) : null}
      </div>
      {children}
    </div>
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
