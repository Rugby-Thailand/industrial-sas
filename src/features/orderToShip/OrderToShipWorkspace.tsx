"use client";

import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Kanban,
  KanbanBoard,
  KanbanColumn,
  KanbanColumnContent,
} from "@/components/ui/kanban";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { MasterDataPanel } from "@/features/masterData/MasterDataPanel";
import { Link } from "@/i18n/navigation";
import {
  listCustomerOrdersRef,
  listDesignRequestsRef,
  listFactoryPacketsRef,
  type CustomerOrderRow,
  type DesignRequestRow,
  type FactoryPacketRow,
} from "@/lib/convex/orderToShipApi";
import { ROUTES } from "@/lib/navigation";
import type { AppLocale } from "@/i18n/routing";
import { formatCount, formatInstant } from "@/lib/formatters";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { MasterCardCreateSheet } from "./MasterCardCreateSheet";
import { OrderIntakeForm } from "./OrderIntakeForm";
import { EngineeringMasterCardLibrary } from "./EngineeringMasterCardLibrary";
import { FactoryFileButton } from "./FactoryFileButton";
import { SimilarDesignCandidates } from "./SimilarDesignCandidates";
import {
  EngineeringWorkflowActions,
  FactoryWorkflowActions,
  SalesWorkflowActions,
} from "./WorkflowActionForms";

export type OrderToShipView = "sales" | "engineering" | "factory";

const PAGE_SIZE = 12;
const CUSTOMER_ORDER_STATUSES = ["DRAFT", "RELEASED", "CANCELLED"] as const;
const EMPTY_ORDER_COLUMNS = Object.freeze({
  DRAFT: Object.freeze([]),
  RELEASED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
});

const tone = (status: string): BadgeTone => {
  if (["RELEASED", "FULFILLED", "ACKNOWLEDGED"].includes(status))
    return "success";
  if (["URGENT", "OVERDUE"].includes(status)) return "danger";
  if (["IN_REVIEW", "ISSUED"].includes(status)) return "pending";
  if (["IN_PROGRESS", "ASSIGNED"].includes(status)) return "accent";
  return "neutral";
};

export function OrderToShipWorkspace({
  view,
}: {
  readonly view: OrderToShipView;
}) {
  const t = useTranslations("OrderToShip");

  return (
    <div className="space-y-6">
      <nav
        aria-label={t("workflowNavigation")}
        className="flex flex-wrap gap-2"
      >
        {(
          [
            ["sales", ROUTES.customerOrders, t("salesTab")],
            ["engineering", ROUTES.engineeringQueue, t("engineeringTab")],
            ["factory", ROUTES.factoryPackets, t("factoryTab")],
          ] as const
        ).map(([key, href, label]) => (
          <Link
            key={key}
            href={href}
            aria-current={view === key ? "page" : undefined}
            className={`min-h-touch rounded-md border px-4 py-2 text-sm font-semibold ${
              view === key
                ? "border-accent bg-accent text-accent-contrast"
                : "border-border-strong bg-surface text-text hover:bg-raised"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <section
        aria-labelledby="flow-summary-title"
        className="rounded-lg border border-border-strong bg-raised p-4"
      >
        <h2 id="flow-summary-title" className="text-base font-bold text-text">
          {t("flowSummary")}
        </h2>
        <ol className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <FlowStep
            number="1"
            title={t("flowSales")}
            detail={t("flowSalesDetail")}
          />
          <FlowStep
            number="2"
            title={t("flowEngineering")}
            detail={t("flowEngineeringDetail")}
          />
          <FlowStep
            number="3"
            title={t("flowFactory")}
            detail={t("flowFactoryDetail")}
          />
        </ol>
      </section>

      {view === "sales" ? <SalesRegister /> : null}
      {view === "engineering" ? <EngineeringQueue /> : null}
      {view === "factory" ? <FactoryQueue /> : null}
    </div>
  );
}

function FlowStep({
  number,
  title,
  detail,
}: {
  readonly number: string;
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <li className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-center gap-2 font-semibold text-text">
        <span
          aria-hidden="true"
          className="grid size-7 place-items-center rounded-full bg-accent text-accent-contrast"
        >
          {number}
        </span>
        {title}
      </div>
      <p className="mt-2 leading-relaxed text-muted">{detail}</p>
    </li>
  );
}

function SalesRegister() {
  const t = useTranslations("OrderToShip");
  return (
    <QueueSection
      title={t("salesRegister")}
      description={t("salesRegisterDetail")}
      action={<CreateOrderSheet />}
    >
      <Kanban<never>
        value={EMPTY_ORDER_COLUMNS as unknown as Record<string, never[]>}
        onValueChange={() => undefined}
        getItemValue={() => ""}
      >
        <KanbanBoard
          role="region"
          aria-label={t("salesBoard")}
          className="auto-cols-[minmax(18rem,1fr)] grid-flow-col grid-cols-none items-start overflow-x-auto pb-3 sm:grid-cols-none xl:grid-flow-row xl:grid-cols-3"
        >
          {CUSTOMER_ORDER_STATUSES.map((status) => (
            <CustomerOrderColumn key={status} status={status} />
          ))}
        </KanbanBoard>
      </Kanban>
    </QueueSection>
  );
}

function CreateOrderSheet() {
  const t = useTranslations("OrderToShip");
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button">
          <Plus aria-hidden="true" />
          {t("createSalesOrder")}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        closeLabel={t("closeNewOrder")}
        className="overflow-y-auto sm:max-w-xl"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{t("newOrder")}</SheetTitle>
          <SheetDescription>{t("newOrderDetail")}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <OrderIntakeForm onSaved={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CustomerOrderColumn({
  status,
}: {
  readonly status: CustomerOrderRow["status"];
}) {
  const t = useTranslations("OrderToShip");
  const headingId = `customer-orders-${status.toLowerCase()}`;

  return (
    <KanbanColumn
      value={status}
      disabled
      role="region"
      aria-labelledby={headingId}
      className="min-h-80 rounded-lg border border-border-strong bg-surface p-3"
    >
      <div className="mb-3 border-b border-border pb-3">
        <h3 id={headingId} className="text-sm font-bold text-text">
          {t(`status.${status}`)}
        </h3>
      </div>
      <KanbanColumnContent value={status} className="gap-3">
        <MasterDataPanel<
          CustomerOrderRow,
          {
            maxPageSize?: number;
            cursor?: string;
            status?: CustomerOrderRow["status"];
          }
        >
          queryRef={listCustomerOrdersRef}
          scope="ORG"
          buildArgs={({ cursor }) => ({
            maxPageSize: PAGE_SIZE,
            status,
            ...(cursor === undefined ? {} : { cursor }),
          })}
          paginationLabel={`${t(`status.${status}`)} · ${t("salesPagination")}`}
          renderRows={(rows) => (
            <ul className="grid gap-3">
              {rows.map((row) => (
                <li
                  key={row.customerOrderId}
                  className="rounded-lg border border-border-strong bg-surface p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-text">{row.orderNumber}</h3>
                      <p className="mt-1 text-sm text-muted">
                        {t("customerPo")}:{" "}
                        {row.customerReference ?? t("notProvided")}
                      </p>
                    </div>
                    <StatusBadge
                      tone={tone(row.status)}
                      label={t(`status.${row.status}`)}
                    />
                  </div>
                  <p className="mt-3 font-mono text-xs break-all text-muted">
                    {t("customerOrderId")}: {row.customerOrderId}
                  </p>
                  {row.status === "DRAFT" ? (
                    <details className="mt-3">
                      <summary className="min-h-touch cursor-pointer py-2 font-semibold text-text">
                        {t("orderActions")}
                      </summary>
                      <SalesWorkflowActions
                        customerOrderId={row.customerOrderId}
                      />
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        />
      </KanbanColumnContent>
    </KanbanColumn>
  );
}

function EngineeringQueue() {
  const t = useTranslations("OrderToShip");
  return (
    <QueueSection
      title={t("engineeringQueue")}
      description={t("engineeringQueueDetail")}
      action={<MasterCardCreateSheet />}
    >
      <MasterDataPanel<
        DesignRequestRow,
        {
          maxPageSize?: number;
          cursor?: string;
          status?: DesignRequestRow["status"];
        }
      >
        queryRef={listDesignRequestsRef}
        scope="ORG"
        buildArgs={({ cursor }) => ({
          maxPageSize: PAGE_SIZE,
          ...(cursor === undefined ? {} : { cursor }),
        })}
        paginationLabel={t("engineeringPagination")}
        renderRows={(rows) => (
          <ul className="grid gap-3 xl:grid-cols-2">
            {rows.map((row) => (
              <li
                key={row.designRequestId}
                className={`rounded-lg border bg-surface p-4 ${row.overdue ? "border-danger" : "border-border-strong"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-text">{row.requestNumber}</h3>
                    <p className="mt-1 font-mono text-sm text-muted">
                      {row.customerProductCode}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge
                      tone={tone(row.status)}
                      label={t(`status.${row.status}`)}
                    />
                    {row.overdue ? (
                      <StatusBadge tone="danger" label={t("overdue")} />
                    ) : null}
                    <StatusBadge
                      tone={
                        row.requirementReadiness === "READY"
                          ? "success"
                          : "pending"
                      }
                      label={
                        row.requirementReadiness === "READY"
                          ? t("requirementsReady")
                          : t("requirementsIncomplete")
                      }
                    />
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <Fact
                    label={t("priority")}
                    value={t(`priorityValue.${row.priority}`)}
                  />
                  <Fact
                    label={t("flute")}
                    value={row.specification.fluteCode ?? t("notProvided")}
                  />
                  <Fact
                    label={t("routeSteps")}
                    value={String(row.specification.route?.length ?? 0)}
                  />
                  <Fact
                    label={t("qualityChecks")}
                    value={String(
                      row.specification.qualityRequirements?.length ?? 0,
                    )}
                  />
                </dl>
                {row.requirementReadiness === "READY" ? null : (
                  <p className="mt-3 text-sm text-warning">
                    {t("requirementsBlocked")}
                    {row.missingRequirements?.length
                      ? `: ${row.missingRequirements
                          .map((key) => t(`requirement.${key}`))
                          .join(", ")}`
                      : ""}
                  </p>
                )}
                <p className="mt-3 font-mono text-xs break-all text-muted">
                  {t("designRequestId")}: {row.designRequestId}
                </p>
                <details className="mt-3">
                  <summary className="min-h-touch cursor-pointer py-2 font-semibold text-text">
                    {t("designActions")}
                  </summary>
                  <div className="pt-3">
                    <EngineeringWorkflowActions
                      designRequestId={row.designRequestId}
                      {...(row.masterCardRevisionId === undefined
                        ? {}
                        : { masterCardRevisionId: row.masterCardRevisionId })}
                    />
                  </div>
                </details>
                <SimilarDesignCandidates
                  designRequestId={row.designRequestId}
                />
              </li>
            ))}
          </ul>
        )}
      />
      <EngineeringMasterCardLibrary />
    </QueueSection>
  );
}

function FactoryQueue() {
  const t = useTranslations("OrderToShip");
  const locale = useLocale() as AppLocale;
  return (
    <QueueSection
      title={t("factoryQueue")}
      description={t("factoryQueueDetail")}
    >
      <Link
        href={ROUTES.productionOrders}
        className="inline-flex min-h-touch items-center rounded-md border border-accent px-4 py-2 text-sm font-semibold text-accent hover:bg-raised"
      >
        {t("openProductionOrders")}
      </Link>
      <FactoryWorkflowActions issueOnly />
      <MasterDataPanel<
        FactoryPacketRow,
        {
          warehouseId: string;
          maxPageSize?: number;
          cursor?: string;
          status?: FactoryPacketRow["status"];
        }
      >
        queryRef={listFactoryPacketsRef}
        scope="WAREHOUSE"
        buildArgs={({ warehouseId, cursor }) => ({
          warehouseId,
          maxPageSize: PAGE_SIZE,
          ...(cursor === undefined ? {} : { cursor }),
        })}
        paginationLabel={t("factoryPagination")}
        renderRows={(rows) => (
          <ul className="grid gap-4">
            {rows.map((row) => (
              <li
                key={row.factoryPacketId}
                className="break-inside-avoid rounded-lg border-2 border-border-strong bg-surface p-5 print:border-black"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                      {t("factoryPacket")}
                    </p>
                    <h3 className="mt-1 text-xl font-bold text-text">
                      {row.packetNumber}
                    </h3>
                    <p className="mt-1 text-sm text-muted">
                      {row.customerOrderNumber} ·{" "}
                      {row.customerReference ?? t("notProvided")}
                    </p>
                  </div>
                  <StatusBadge
                    tone={tone(row.status)}
                    label={t(`status.${row.status}`)}
                  />
                </div>
                <p className="mt-3 font-mono text-xs break-all text-muted print:hidden">
                  {t("factoryPacketId")}: {row.factoryPacketId}
                </p>
                <dl className="mt-5 grid gap-3 border-y border-border py-4 text-sm sm:grid-cols-4">
                  <Fact
                    label={t("revision")}
                    value={`R${row.revisionNumber}`}
                  />
                  <Fact
                    label={t("quantity")}
                    value={formatCount(row.quantity, locale)}
                  />
                  <Fact
                    label={t("approvedFiles")}
                    value={String(row.approvedFileIds.length)}
                  />
                  <Fact
                    label={t("routeSteps")}
                    value={String(row.specification.route?.length ?? 0)}
                  />
                </dl>
                <ol className="mt-4 grid gap-2 sm:grid-cols-3">
                  {row.specification.route?.map((step) => (
                    <li
                      key={step.sequence}
                      className="rounded border border-border bg-raised p-3 text-sm"
                    >
                      <span className="font-bold text-text">
                        {step.sequence}. {step.operationCode}
                      </span>
                      <span className="mt-1 block text-muted">
                        {step.workCenterCode}
                      </span>
                      {step.instruction === undefined ? null : (
                        <span className="mt-1 block text-text">
                          {step.instruction}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <section aria-label={t("structuredSpecification")}>
                    <h4 className="font-bold text-text">
                      {t("structuredSpecification")}
                    </h4>
                    <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
                      <Fact
                        label={t("styleCode")}
                        value={row.specification.styleCode}
                      />
                      <Fact
                        label={t("boardGrade")}
                        value={row.specification.boardGrade}
                      />
                      <Fact
                        label={t("dimensions")}
                        value={`${row.specification.internalLengthMm} × ${row.specification.internalWidthMm} × ${row.specification.internalHeightMm} mm`}
                      />
                      <Fact
                        label={t("productNameEn")}
                        value={
                          row.specification.productNameEn ?? t("notProvided")
                        }
                      />
                      <Fact
                        label={t("productNameTh")}
                        value={
                          row.specification.productNameTh ?? t("notProvided")
                        }
                      />
                      <Fact
                        label={t("flute")}
                        value={row.specification.fluteCode ?? t("notProvided")}
                      />
                      <Fact
                        label={t("sheetDimensions")}
                        value={
                          row.specification.sheetLengthMm === undefined ||
                          row.specification.sheetWidthMm === undefined
                            ? t("notProvided")
                            : `${row.specification.sheetLengthMm} × ${row.specification.sheetWidthMm} mm`
                        }
                      />
                      <Fact
                        label={t("printMethod")}
                        value={
                          row.specification.printMethod ?? t("notProvided")
                        }
                      />
                      <Fact
                        label={t("printColours")}
                        value={
                          row.specification.printColours?.join(", ") ??
                          t("notProvided")
                        }
                      />
                      <Fact
                        label={t("printColourCount")}
                        value={String(row.specification.printColourCount)}
                      />
                      <Fact
                        label={t("qualityChecks")}
                        value={String(
                          row.specification.qualityRequirements?.length ?? 0,
                        )}
                      />
                    </dl>
                  </section>
                  <section aria-label={t("releaseEvidence")}>
                    <h4 className="font-bold text-text">
                      {t("releaseEvidence")}
                    </h4>
                    <dl className="mt-2 grid gap-3 text-sm">
                      <Fact
                        label={t("releasedBy")}
                        value={row.releaseEvidence.releasedByUserId}
                      />
                      <Fact
                        label={t("releasedAt")}
                        value={formatInstant(
                          row.releaseEvidence.releasedAt,
                          locale,
                        )}
                      />
                      <Fact
                        label={t("decisionNote")}
                        value={
                          row.releaseEvidence.decisionNote ?? t("notProvided")
                        }
                      />
                    </dl>
                  </section>
                </div>
                <section className="mt-5" aria-label={t("approvedFiles")}>
                  <h4 className="font-bold text-text">{t("approvedFiles")}</h4>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {row.approvedFileIds.map((fileId) => (
                      <li
                        key={fileId}
                        className="rounded bg-raised px-2 py-1 font-mono text-xs text-text"
                      >
                        <span className="break-all">{fileId}</span>
                        <span className="ml-2 print:hidden">
                          <FactoryFileButton
                            warehouseId={row.warehouseId}
                            factoryPacketId={row.factoryPacketId}
                            masterCardFileId={fileId}
                          />
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
                <PacketSpecificationDetails specification={row.specification} />
                <details className="mt-5 print:hidden">
                  <summary className="min-h-touch cursor-pointer py-2 font-semibold text-text">
                    {t("packetActions")}
                  </summary>
                  <FactoryWorkflowActions
                    warehouseId={row.warehouseId}
                    factoryPacketId={row.factoryPacketId}
                  />
                </details>
              </li>
            ))}
          </ul>
        )}
      />
    </QueueSection>
  );
}

function PacketSpecificationDetails({
  specification,
}: {
  readonly specification: FactoryPacketRow["specification"];
}) {
  const t = useTranslations("OrderToShip");
  const locale = useLocale() as AppLocale;
  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <PacketList
        title={t("paperLayers")}
        rows={specification.layers?.map(
          (row) => `${row.position}. ${row.paperCode} · ${row.grammageGsm} gsm`,
        )}
      />
      <PacketList
        title={t("materials")}
        rows={specification.materials?.map(
          (row) =>
            `${row.itemCode} · ${row.description} · ${row.quantityPerUnit} ${row.uom}`,
        )}
      />
      <PacketList
        title={t("qualityRequirements")}
        rows={specification.qualityRequirements?.map(
          (row) =>
            `${row.code} · ${row.description} · ${row.target}${row.tolerance === undefined ? "" : ` ± ${row.tolerance}`}`,
        )}
      />
      <PacketList
        title={t("calculations")}
        rows={specification.calculations?.map(
          (row) =>
            `${row.name} (${row.formulaVersion}) · ${row.inputs.map((input) => `${input.name}=${input.value} ${input.unit}`).join(", ")} · ${row.result} ${row.unit} · ${row.passed ? t("calculationPass") : t("calculationFail")} · ${t("verifiedBy")}: ${row.verifiedByUserId} · ${formatInstant(row.verifiedAt, locale)}`,
        )}
      />
      <PacketList
        title={t("packing")}
        rows={[
          specification.bundleQuantity === undefined
            ? undefined
            : `${t("bundleQuantity")}: ${specification.bundleQuantity}`,
          specification.palletQuantity === undefined
            ? undefined
            : `${t("palletQuantity")}: ${specification.palletQuantity}`,
          specification.packingInstructions,
        ].filter(
          (value): value is string => value !== undefined && value.length > 0,
        )}
      />
      <PacketList title={t("finishing")} rows={specification.finishing} />
      <PacketList
        title={t("tolerances")}
        rows={[
          specification.lengthToleranceMm === undefined
            ? undefined
            : `${t("lengthToleranceMm")}: ${specification.lengthToleranceMm}`,
          specification.widthToleranceMm === undefined
            ? undefined
            : `${t("widthToleranceMm")}: ${specification.widthToleranceMm}`,
          specification.heightToleranceMm === undefined
            ? undefined
            : `${t("heightToleranceMm")}: ${specification.heightToleranceMm}`,
        ].filter((value): value is string => value !== undefined)}
      />
      <PacketList
        title={t("notes")}
        rows={
          specification.notes === undefined ? undefined : [specification.notes]
        }
      />
    </div>
  );
}

function PacketList({
  title,
  rows,
}: {
  readonly title: string;
  readonly rows: readonly string[] | undefined;
}) {
  const t = useTranslations("OrderToShip");
  return (
    <section className="rounded border border-border bg-raised p-3">
      <h4 className="font-bold text-text">{title}</h4>
      {rows === undefined || rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t("notProvided")}</p>
      ) : (
        <ul className="mt-2 grid gap-1 text-sm text-text">
          {rows.map((row, index) => (
            <li key={`${index}-${row}`}>{row}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function QueueSection({
  title,
  description,
  action,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`section-${title.replace(/\s/g, "-")}`}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id={`section-${title.replace(/\s/g, "-")}`}
            className="text-lg font-bold text-text"
          >
            {title}
          </h2>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted">
            {description}
          </p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Fact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
        {label}
      </dt>
      <dd className="mt-1 font-medium text-text">{value}</dd>
    </div>
  );
}
