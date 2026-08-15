/**
 * Which message namespaces each part of the tree ships to the browser.
 *
 * `NextIntlClientProvider` serializes whatever `messages` it is given into the
 * RSC payload of every route below it. Given no `messages` prop it inherits the
 * *whole* request configuration, which is how this application came to send all
 * 46 namespaces — 63 kB of Thai, 31 kB of English — to a sign-in screen that
 * reads four of them. Measured before this file existed: the catalogue was 82.8%
 * of the bytes in every prerendered `.rsc`.
 *
 * So the provider is split in two, and both halves name what they carry:
 *
 * - `SHELL_NAMESPACES` is the chrome that is on screen no matter where an
 *   operator is — navigation, the workspace bar, the connection indicator. It
 *   sits in the root locale layout.
 * - `ROUTE_NAMESPACES` is one entry per route subtree, mounted by a
 *   `layout.tsx` in that subtree via `RouteMessages`.
 *
 * ### Why the two halves must each be self-contained
 *
 * A nested `IntlProvider` **replaces** `messages`; it does not merge with the
 * provider above it (`use-intl`'s `IntlProvider`: `messages === undefined ?
 * prevContext?.messages : messages`). Everything else — locale, time zone,
 * formats — is inherited, which is why the route providers pass only messages.
 *
 * The practical consequence: a route entry may not lean on `SHELL_NAMESPACES`.
 * The dashboard renders `DashboardScope` and `SetupChecklist` *inside* the page,
 * so `Workspace` and `Setup` appear in its entry even though the shell above
 * also carries `Workspace`. The duplication is a few hundred bytes and it is
 * what makes each entry independently checkable.
 *
 * ### Keeping this file true
 *
 * Every entry here is derived from the client-component import graph and
 * asserted against it by `clientMessages.test.ts` — exactly, in both directions,
 * so a namespace that is added, removed, or newly reached by a `use client`
 * module fails `pnpm test` rather than rendering `Receiving.title` to a
 * warehouse. Nothing here should be edited by hand without running that test;
 * it prints the correct set when it fails.
 */
import type { MessageCatalogue } from "./messages";

/** A top-level key of the catalogue — i.e. a `useTranslations` namespace. */
export type MessageNamespace = keyof MessageCatalogue;

/**
 * The chrome that renders above every route, from the root locale layout.
 *
 * `App` is the product name in the sidebar header, `Locale` the language
 * switcher, `Navigation` both shells' link labels, `Workspace` the warehouse
 * bar, `Connection` the backend indicator, `Preview` the preview-data banner.
 * Nothing domain-specific belongs here: a namespace added to this list is paid
 * for by every page in the application.
 */
export const SHELL_NAMESPACES = [
  "App",
  "Connection",
  "Error",
  "Locale",
  "Navigation",
  "Preview",
  "Workspace",
] as const satisfies readonly MessageNamespace[];

/**
 * The client namespaces of each route subtree, keyed by its directory under
 * `src/app/[locale]`.
 *
 * The key is the directory rather than the public URL because that is what the
 * test can walk and what a `layout.tsx` can name unambiguously — route groups
 * and dynamic segments included.
 *
 * The purchasing and receiving entries are the large ones, and honestly so: a
 * receipt is posted against an order, so both screens need both vocabularies,
 * and the tables, panels, and forms for the pair live together because they are
 * used together.
 *
 * Quality and putaway used to look the same, for a reason that had nothing to do
 * with what they render: they reached the ordering and receiving catalogues
 * through shared modules — `InboundTables`, `InboundPanels`, `InboundForms`, and
 * the scan box in `CatalogueOptions` — and a module is the unit this manifest's
 * walk, and the bundler, both resolve. Those four seams are now split, so a
 * quality screen lists the eight namespaces a quality screen reads.
 *
 * `Pagination` is the same story told about a namespace rather than a module.
 * The five strings a pager renders — "Previous page", "Page {page}" — lived in
 * `Inventory` because the ledger screens were the first thing that paged. Both
 * `LedgerPanel` and `MasterDataPanel` read them, so every screen with a paged
 * list carried the whole inventory vocabulary: column headings, captions, the
 * read-only notice. Eight scopes paid 1.5 kB of Thai each for five strings.
 * Naming the chrome separately is what lets a putaway queue page without
 * learning the word for "stock bucket".
 *
 * `Table` is the same argument, one string long: `TableScroller` tells a narrow
 * screen that its columns continue past the right edge, and it wraps every
 * collection in the application — the master-data tables through `EntityTable`,
 * and the two inventory tables directly, which is why the inventory scopes carry
 * it too. Borrowing a domain namespace for that sentence would put the whole
 * vocabulary back on all of them.
 *
 * `LabelPrintReason` and `LabelPrintStatus` are one namespace per closed set,
 * exactly like `PurchaseOrderStatus` next to `Purchasing`. The label-evidence
 * table used to print `INITIAL` and `GENERATED` into a Thai screen; the labels
 * live beside the rest of the closed sets rather than inside `LabelEvidence` so
 * that `codeLabel` can ask "does this catalogue know this code" of one namespace
 * whose every key is a code.
 */
export const ROUTE_NAMESPACES = {
  "(auth)/sign-in": ["Setup"],

  "(desktop)/dashboard": [
    "Dashboard",
    "Metric",
    "Occupancy",
    "OccupancyBand",
    "Panel",
    "Setup",
    "Workspace",
  ],
  "(desktop)/inventory": [
    "Inventory",
    "Pagination",
    "Panel",
    "StockStatus",
    "Table",
    "TransactionType",
  ],
  "(desktop)/inbound": [
    "InboundBoard",
    "InspectionStatus",
    "Pagination",
    "Panel",
    "PurchaseOrderStatus",
    "PutawayTaskStatus",
  ],
  "(desktop)/master-data": [
    "BarcodeKind",
    "LabelTemplateStatus",
    "LocationType",
    "MasterData",
    "MasterDataStatus",
    "Pagination",
    "Panel",
    "Table",
    "TrackingMode",
    "Write",
    "WriteError",
  ],
  "(desktop)/purchasing": [
    "ImportProblem",
    "LabelEvidence",
    "LabelPrintReason",
    "LabelPrintStatus",
    "Pagination",
    "Panel",
    "PurchaseOrderLineStatus",
    "PurchaseOrderStatus",
    "Purchasing",
    "ReceiptClassification",
    "ReceiptLineKind",
    "Receiving",
    "StockStatus",
    "Table",
    "Write",
    "WriteError",
  ],
  "(desktop)/putaway": [
    "Pagination",
    "Panel",
    "Putaway",
    "PutawayFilterReason",
    "PutawayScoreComponent",
    "PutawayTaskStatus",
    "Table",
    "Write",
    "WriteError",
  ],
  "(desktop)/quality": [
    "InspectionStatus",
    "Pagination",
    "Panel",
    "QcDisposition",
    "Quality",
    "SamplingStrategy",
    "Table",
    "Write",
    "WriteError",
  ],
  "(desktop)/receiving": [
    "ImportProblem",
    "LabelEvidence",
    "LabelPrintReason",
    "LabelPrintStatus",
    "Pagination",
    "Panel",
    "PurchaseOrderLineStatus",
    "PurchaseOrderStatus",
    "Purchasing",
    "ReceiptClassification",
    "ReceiptLineKind",
    "Receiving",
    "StockStatus",
    "Table",
    "Write",
    "WriteError",
  ],
  "(desktop)/reports": [
    "Panel",
    "ReportJobStatus",
    "ReportKind",
    "Reports",
    "Write",
    "WriteError",
  ],
  "(desktop)/sales": [
    "OrderToShip",
    "Pagination",
    "Panel",
    "Write",
    "WriteError",
  ],
  "(desktop)/engineering": [
    "OrderToShip",
    "Pagination",
    "Panel",
    "Write",
    "WriteError",
  ],
  "(desktop)/production": [
    "OrderToShip",
    "Pagination",
    "Panel",
    "Write",
    "WriteError",
  ],
  "(desktop)/setup": ["Setup"],

  "(handheld)/handheld/inventory": [
    "Inventory",
    "Pagination",
    "Panel",
    "StockStatus",
    "Table",
  ],
  "(handheld)/handheld/putaway": [
    "Pagination",
    "Panel",
    "Putaway",
    "PutawayFilterReason",
    "PutawayScoreComponent",
    "PutawayTaskStatus",
    "Table",
    "Write",
    "WriteError",
  ],
  "(handheld)/handheld/quality": [
    "InspectionStatus",
    "Pagination",
    "Panel",
    "QcDisposition",
    "Quality",
    "SamplingStrategy",
    "Table",
    "Write",
    "WriteError",
  ],
  "(handheld)/handheld/receive": [
    "ImportProblem",
    "LabelEvidence",
    "LabelPrintReason",
    "LabelPrintStatus",
    "Pagination",
    "Panel",
    "PurchaseOrderLineStatus",
    "PurchaseOrderStatus",
    "Purchasing",
    "ReceiptClassification",
    "ReceiptLineKind",
    "Receiving",
    "StockStatus",
    "Table",
    "Write",
    "WriteError",
  ],
} as const satisfies Record<string, readonly MessageNamespace[]>;

/** A key of `ROUTE_NAMESPACES`; the prop a route's `layout.tsx` passes. */
export type RouteMessageScope = keyof typeof ROUTE_NAMESPACES;

/**
 * The named namespaces of a catalogue, and nothing else.
 *
 * `messages` is typed loosely because that is what `getMessages()` returns
 * without the global `AppConfig` augmentation — which this repository
 * deliberately does not install, since it would make every dynamic
 * `t(labelKey)` in the navigation data a type error. The *namespaces* argument
 * carries the type safety instead: it is `keyof MessageCatalogue`, so a renamed
 * namespace is caught by `pnpm typecheck` at every declaration site.
 *
 * A namespace that is missing at run time throws rather than being skipped.
 * Every caller runs during static generation, so a stale entry here fails
 * `next build` instead of rendering `Receiving.title` on a receiving screen.
 */
export function pickMessages<K extends MessageNamespace>(
  messages: Readonly<Record<string, unknown>>,
  namespaces: readonly K[],
): Pick<MessageCatalogue, K> {
  const picked: Record<string, unknown> = {};
  for (const namespace of namespaces) {
    const value = messages[namespace];
    if (value === undefined) {
      throw new Error(
        `Message namespace "${namespace}" is not in the catalogue. ` +
          "Update src/i18n/clientMessages.ts or messages/*.json.",
      );
    }
    picked[namespace] = value;
  }
  return picked as Pick<MessageCatalogue, K>;
}
