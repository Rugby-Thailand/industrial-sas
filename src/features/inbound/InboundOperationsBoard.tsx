"use client";

/**
 * The inbound control board: four bounded, warehouse-scoped work queues in the
 * order stock moves through them.
 *
 * This is intentionally a system-driven Kanban. A PO does not become received
 * because somebody dragged a card; receipt posting creates ledger entries, QC
 * disposition can require another person, and putaway is a balanced movement.
 * Cards therefore link to the workflow that owns the transition. The Kanban
 * primitive supplies the board composition without bypassing those commands.
 */
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import {
  Kanban,
  KanbanBoard,
  KanbanColumn,
  KanbanColumnContent,
} from "@/components/ui/kanban";
import { Link } from "@/i18n/navigation";
import {
  listInspectionsRef,
  listPurchaseOrdersRef,
  listPutawayTasksRef,
  listReceiptsRef,
  type InspectionRow,
  type PurchaseOrderRow,
  type PutawayTaskRow,
  type ReceiptRow,
} from "@/lib/convex/inboundApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";
import { purchaseOrderPath, receiptPath, ROUTES } from "@/lib/navigation";
import {
  previewInspectionsFor,
  previewPurchaseOrdersFor,
  previewPutawayTasksFor,
  previewReceiptsFor,
} from "@/lib/preview/inboundPreview";

import { MasterDataPanel } from "../masterData/MasterDataPanel";

const BOARD_PAGE_SIZE = 12;

const EMPTY_COLUMNS = Object.freeze({
  orders: Object.freeze([]),
  receipts: Object.freeze([]),
  quality: Object.freeze([]),
  putaway: Object.freeze([]),
}) as Readonly<Record<string, readonly never[]>>;

const ORDER_TONES: Readonly<Record<string, BadgeTone>> = {
  DRAFT: "pending",
  OPEN: "success",
  CLOSED: "muted",
  CANCELLED: "danger",
};

const INSPECTION_TONES: Readonly<Record<string, BadgeTone>> = {
  OPEN: "warning",
  PENDING_APPROVAL: "pending",
  DISPOSED: "success",
  CANCELLED: "muted",
};

const PUTAWAY_TONES: Readonly<Record<string, BadgeTone>> = {
  READY: "accent",
  CLAIMED: "pending",
  CONFIRMED: "success",
  CANCELLED: "muted",
};

const args = (warehouseId: string, cursor: string | undefined) => ({
  warehouseId,
  maxPageSize: BOARD_PAGE_SIZE,
  ...(cursor === undefined ? {} : { cursor }),
});

export function InboundOperationsBoard() {
  const t = useTranslations("InboundBoard");

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-md border border-border-strong bg-raised px-4 py-3 text-sm text-text">
        {t("systemDriven")}
      </p>
      <Kanban<never>
        value={EMPTY_COLUMNS as Record<string, never[]>}
        onValueChange={() => undefined}
        getItemValue={() => ""}
      >
        <KanbanBoard
          role="region"
          aria-label={t("label")}
          className="auto-cols-[minmax(16rem,1fr)] grid-flow-col grid-cols-none items-start overflow-x-auto pb-3 sm:grid-cols-none"
        >
          <BoardColumn value="orders" title={t("ordersColumn")}>
            <PurchaseOrderCards />
          </BoardColumn>
          <BoardColumn value="receipts" title={t("receiptsColumn")}>
            <ReceiptCards />
          </BoardColumn>
          <BoardColumn value="quality" title={t("qualityColumn")}>
            <InspectionCards />
          </BoardColumn>
          <BoardColumn value="putaway" title={t("putawayColumn")}>
            <PutawayCards />
          </BoardColumn>
        </KanbanBoard>
      </Kanban>
    </div>
  );
}

function BoardColumn({
  value,
  title,
  children,
}: {
  readonly value: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const headingId = `inbound-board-${value}`;
  return (
    <KanbanColumn
      value={value}
      disabled
      role="region"
      aria-labelledby={headingId}
      className="min-h-80 rounded-lg border border-border-strong bg-surface p-3"
    >
      <div className="mb-3 border-b border-border pb-3">
        <h2 id={headingId} className="text-sm font-bold text-text">
          {title}
        </h2>
      </div>
      <KanbanColumnContent value={value} className="gap-3">
        {children}
      </KanbanColumnContent>
    </KanbanColumn>
  );
}

function PurchaseOrderCards() {
  const t = useTranslations("InboundBoard");
  return (
    <MasterDataPanel<
      PurchaseOrderRow,
      { warehouseId: string; maxPageSize?: number; cursor?: string }
    >
      queryRef={listPurchaseOrdersRef}
      scope="WAREHOUSE"
      paginationLabel={t("ordersPagination")}
      buildArgs={({ warehouseId, cursor }) => args(warehouseId, cursor)}
      previewRowsFor={previewPurchaseOrdersFor}
      renderRows={(rows) => (
        <CardList count={rows.length}>
          {rows.map((row) => (
            <PurchaseOrderCard key={row.purchaseOrderId} row={row} />
          ))}
        </CardList>
      )}
    />
  );
}

function PurchaseOrderCard({ row }: { readonly row: PurchaseOrderRow }) {
  const t = useTranslations("InboundBoard");
  const statusT = useTranslations(
    "PurchaseOrderStatus",
  ) as unknown as CodeTranslator;

  return (
    <BoardCard
      href={purchaseOrderPath(row.purchaseOrderId)}
      title={row.poNumber}
      openLabel={t("openCard", { name: row.poNumber })}
      badge={
        <StatusBadge
          tone={ORDER_TONES[row.status] ?? "neutral"}
          label={codeLabel(statusT, row.status)}
        />
      }
    >
      <CardFact
        label={t("externalReference")}
        value={row.externalRef ?? t("notAvailable")}
      />
    </BoardCard>
  );
}

function ReceiptCards() {
  const t = useTranslations("InboundBoard");
  return (
    <MasterDataPanel<
      ReceiptRow,
      { warehouseId: string; maxPageSize?: number; cursor?: string }
    >
      queryRef={listReceiptsRef}
      scope="WAREHOUSE"
      paginationLabel={t("receiptsPagination")}
      buildArgs={({ warehouseId, cursor }) => args(warehouseId, cursor)}
      previewRowsFor={previewReceiptsFor}
      renderRows={(rows) => (
        <CardList count={rows.length}>
          {rows.map((row) => (
            <ReceiptCard key={row.receiptId} row={row} />
          ))}
        </CardList>
      )}
    />
  );
}

function ReceiptCard({ row }: { readonly row: ReceiptRow }) {
  const t = useTranslations("InboundBoard");
  return (
    <BoardCard
      href={receiptPath(row.receiptId)}
      title={row.receiptNumber}
      openLabel={t("openCard", { name: row.receiptNumber })}
      badge={<StatusBadge tone="accent" label={t("receivingBadge")} />}
    >
      <CardFact
        label={t("purchaseOrder")}
        value={row.poNumber ?? t("noOrder")}
      />
      <CardFact label={t("businessDate")} value={row.businessDate} />
    </BoardCard>
  );
}

function InspectionCards() {
  const t = useTranslations("InboundBoard");
  return (
    <MasterDataPanel<
      InspectionRow,
      {
        warehouseId: string;
        maxPageSize?: number;
        cursor?: string;
      }
    >
      queryRef={listInspectionsRef}
      scope="WAREHOUSE"
      paginationLabel={t("qualityPagination")}
      buildArgs={({ warehouseId, cursor }) => args(warehouseId, cursor)}
      previewRowsFor={previewInspectionsFor}
      renderRows={(rows) => (
        <CardList count={rows.length}>
          {rows.map((row) => (
            <InspectionCard key={row.inspectionId} row={row} />
          ))}
        </CardList>
      )}
    />
  );
}

function InspectionCard({ row }: { readonly row: InspectionRow }) {
  const t = useTranslations("InboundBoard");
  const statusT = useTranslations(
    "InspectionStatus",
  ) as unknown as CodeTranslator;
  const title = t("inspectionTitle", { id: shortId(row.inspectionId) });
  return (
    <BoardCard
      href={ROUTES.quality}
      title={title}
      openLabel={t("openCard", { name: title })}
      badge={
        <StatusBadge
          tone={INSPECTION_TONES[row.status] ?? "neutral"}
          label={codeLabel(statusT, row.status)}
        />
      }
    >
      <CardFact label={t("item")} value={row.itemId} />
      <CardFact
        label={t("sample")}
        value={t("sampleValue", { sample: row.sampleSize, lot: row.lotSize })}
      />
    </BoardCard>
  );
}

function PutawayCards() {
  const t = useTranslations("InboundBoard");
  return (
    <MasterDataPanel<
      PutawayTaskRow,
      {
        warehouseId: string;
        maxPageSize?: number;
        cursor?: string;
      }
    >
      queryRef={listPutawayTasksRef}
      scope="WAREHOUSE"
      paginationLabel={t("putawayPagination")}
      buildArgs={({ warehouseId, cursor }) => args(warehouseId, cursor)}
      previewRowsFor={previewPutawayTasksFor}
      renderRows={(rows) => (
        <CardList count={rows.length}>
          {rows.map((row) => (
            <PutawayCard key={row.putawayTaskId} row={row} />
          ))}
        </CardList>
      )}
    />
  );
}

function PutawayCard({ row }: { readonly row: PutawayTaskRow }) {
  const t = useTranslations("InboundBoard");
  const statusT = useTranslations(
    "PutawayTaskStatus",
  ) as unknown as CodeTranslator;
  const title = t("putawayTitle", { id: shortId(row.putawayTaskId) });
  return (
    <BoardCard
      href={ROUTES.putaway}
      title={title}
      openLabel={t("openCard", { name: title })}
      badge={
        <StatusBadge
          tone={PUTAWAY_TONES[row.status] ?? "neutral"}
          label={codeLabel(statusT, row.status)}
        />
      }
    >
      <CardFact label={t("item")} value={row.itemId} />
      <CardFact label={t("fromLocation")} value={shortId(row.fromLocationId)} />
    </BoardCard>
  );
}

function CardList({
  count,
  children,
}: {
  readonly count: number;
  readonly children: ReactNode;
}) {
  const t = useTranslations("InboundBoard");
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold text-muted">
        {t("cardCount", { count })}
      </p>
      {children}
    </div>
  );
}

function BoardCard({
  href,
  title,
  openLabel,
  badge,
  children,
}: {
  readonly href: string;
  readonly title: string;
  readonly openLabel: string;
  readonly badge: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <article className="rounded-md border border-border bg-canvas p-3 shadow-xs transition-colors focus-within:border-accent focus-within:ring-3 focus-within:ring-ring/50 hover:border-border-strong hover:bg-raised">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="min-w-0 font-mono text-sm font-bold break-words text-text">
          {title}
        </h3>
        {badge}
      </div>
      <dl className="flex flex-col gap-1.5 text-xs">{children}</dl>
      <Link
        href={href}
        aria-label={openLabel}
        className="mt-3 inline-flex min-h-touch w-full items-center justify-between rounded-md border border-border-strong px-3 text-sm font-semibold text-text outline-none hover:bg-surface focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span>{openLabel}</span>
        <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
      </Link>
    </article>
  );
}

function CardFact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-mono break-all text-text">
        {value}
      </dd>
    </div>
  );
}

function shortId(value: string): string {
  const segments = value.split("_");
  return segments.at(-1) ?? value;
}
