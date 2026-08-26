"use client";

import { PencilLine } from "lucide-react";
import { useTranslations } from "next-intl";

import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import {
  acknowledgeFactoryPacketRef,
  addCustomerOrderLineRef,
  assignDesignRequestRef,
  confirmSimilarDesignRef,
  decideMasterCardRevisionRef,
  editDesignRequestRef,
  fulfilDesignRequestRef,
  issueFactoryPacketRef,
  progressDesignRequestRef,
  recordDesignRequirementsRef,
  releaseCustomerOrderRef,
  submitMasterCardRevisionRef,
} from "@/lib/convex/orderToShipApi";

const whole = (value: string | undefined) => Number.parseInt(value ?? "", 10);

const dateInputValue = (epochMilliseconds: number | undefined) =>
  epochMilliseconds === undefined
    ? ""
    : new Date(epochMilliseconds).toISOString().slice(0, 10);

export function DesignRequestEditForm({
  designRequestId,
  priority,
  dueAt,
}: {
  readonly designRequestId: string;
  readonly priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  readonly dueAt?: number;
}) {
  const t = useTranslations("OrderToShip");
  return (
    <EntityWriteForm
      mutationRef={editDesignRequestRef}
      legend={t("editDesignRequest")}
      triggerIcon={<PencilLine aria-hidden="true" className="size-4" />}
      description={t("editDesignRequestDetail")}
      submitLabel={t("saveDesignRequestChanges")}
      requiredMessage={t("requiredField")}
      testId={`edit-design-request-${designRequestId}`}
      fields={[
        {
          name: "priority",
          label: t("priority"),
          kind: "select",
          required: true,
          initialValue: priority,
          options: (["LOW", "NORMAL", "HIGH", "URGENT"] as const).map(
            (value) => ({ value, label: t(`priorityValue.${value}`) }),
          ),
        },
        {
          name: "dueAt",
          label: t("designDueDate"),
          kind: "text",
          initialValue: dateInputValue(dueAt),
          placeholder: "2026-08-31",
          hint: t("designDueDateHint"),
        },
      ]}
      toArgs={(values, requestId) => {
        const dueDate = values.dueAt ?? "";
        const parsedDueAt =
          dueDate === "" ? null : Date.parse(`${dueDate}T12:00:00Z`);
        return {
          requestId,
          designRequestId,
          priority: (values.priority ?? priority) as
            "LOW" | "NORMAL" | "HIGH" | "URGENT",
          dueAt:
            parsedDueAt === null || Number.isFinite(parsedDueAt)
              ? parsedDueAt
              : 0,
        };
      }}
    />
  );
}

export function SalesWorkflowActions({
  customerOrderId,
}: {
  readonly customerOrderId?: string;
}) {
  const t = useTranslations("OrderToShip");
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <EntityWriteForm
        mutationRef={addCustomerOrderLineRef}
        legend={t("addOrderLine")}
        description={t("addOrderLineDetail")}
        submitLabel={t("saveOrderLine")}
        requiredMessage={t("requiredField")}
        fields={[
          ["customerOrderId", "customerOrderId", "text"],
          ["lineNumber", "lineNumber", "number"],
          ["customerProductCode", "customerProductCode", "text"],
          ["orderedQuantity", "quantity", "number"],
          ["styleCode", "styleCode", "text"],
          ["internalLengthMm", "internalLengthMm", "number"],
          ["internalWidthMm", "internalWidthMm", "number"],
          ["internalHeightMm", "internalHeightMm", "number"],
          ["boardGrade", "boardGrade", "text"],
          ["printColourCount", "printColourCount", "number"],
        ].map(([name, label, kind]) => ({
          name: name!,
          label: t(label!),
          kind: kind as "text" | "number",
          required: true,
          monospace: kind === "text",
          ...(name === "customerOrderId" && customerOrderId !== undefined
            ? { initialValue: customerOrderId }
            : {}),
        }))}
        toArgs={(values, requestId) => ({
          requestId,
          customerOrderId: values.customerOrderId ?? "",
          lineNumber: whole(values.lineNumber),
          customerProductCode: values.customerProductCode ?? "",
          orderedQuantity: whole(values.orderedQuantity),
          specification: {
            styleCode: values.styleCode ?? "",
            internalLengthMm: whole(values.internalLengthMm),
            internalWidthMm: whole(values.internalWidthMm),
            internalHeightMm: whole(values.internalHeightMm),
            boardGrade: values.boardGrade ?? "",
            printColourCount: whole(values.printColourCount),
          },
        })}
      />
      <EntityWriteForm
        mutationRef={releaseCustomerOrderRef}
        legend={t("releaseOrder")}
        description={t("releaseOrderDetail")}
        submitLabel={t("release")}
        requiredMessage={t("requiredField")}
        fields={[
          {
            name: "customerOrderId",
            label: t("customerOrderId"),
            kind: "text",
            required: true,
            monospace: true,
            ...(customerOrderId === undefined
              ? {}
              : { initialValue: customerOrderId }),
          },
        ]}
        toArgs={(values, requestId) => ({
          requestId,
          customerOrderId: values.customerOrderId ?? "",
        })}
      />
    </div>
  );
}

export function EngineeringWorkflowActions({
  designRequestId,
  masterCardRevisionId,
  mode = "request",
  revisionStatus,
}: {
  readonly designRequestId?: string;
  readonly masterCardRevisionId?: string;
  readonly mode?: "request" | "revision";
  readonly revisionStatus?:
    "DRAFT" | "IN_REVIEW" | "RELEASED" | "REJECTED" | "SUPERSEDED";
}) {
  const t = useTranslations("OrderToShip");
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {mode === "revision" ? null : (
        <EntityWriteForm
          mutationRef={recordDesignRequirementsRef}
          legend={t("recordRequirements")}
          description={t("recordRequirementsDetail")}
          submitLabel={t("saveRequirements")}
          requiredMessage={t("requiredField")}
          fields={[
            {
              name: "designRequestId",
              label: t("designRequestId"),
              kind: "text" as const,
              required: true,
              monospace: true,
              ...(designRequestId === undefined
                ? {}
                : { initialValue: designRequestId }),
            },
            ...[
              "CUSTOMER_PRODUCT_IDENTITY",
              "DIMENSIONS",
              "CONSTRUCTION",
              "PRINT",
              "PACKING",
              "ROUTE",
              "MATERIALS",
              "QUALITY",
            ].map((key) => ({
              name: key,
              label: t(`requirement.${key}`),
              kind: "select" as const,
              required: true,
              options: [
                { value: "YES", label: t("confirmed") },
                { value: "NO", label: t("notConfirmed") },
              ],
              initialValue: "NO",
            })),
            {
              name: "requirementsNote",
              label: t("requirementsNote"),
              kind: "textarea" as const,

              importance: "secondary" as const,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            designRequestId: values.designRequestId ?? "",
            confirmations: {
              CUSTOMER_PRODUCT_IDENTITY:
                values.CUSTOMER_PRODUCT_IDENTITY === "YES",
              DIMENSIONS: values.DIMENSIONS === "YES",
              CONSTRUCTION: values.CONSTRUCTION === "YES",
              PRINT: values.PRINT === "YES",
              PACKING: values.PACKING === "YES",
              ROUTE: values.ROUTE === "YES",
              MATERIALS: values.MATERIALS === "YES",
              QUALITY: values.QUALITY === "YES",
            },
            ...((values.requirementsNote ?? "") === ""
              ? {}
              : { note: values.requirementsNote }),
          })}
        />
      )}
      {mode === "revision" ? null : (
        <EntityWriteForm
          mutationRef={assignDesignRequestRef}
          legend={t("assignDesign")}
          submitLabel={t("assign")}
          requiredMessage={t("requiredField")}
          fields={[
            ["designRequestId", "designRequestId"],
            ["assignedToUserId", "assignedToUserId"],
          ].map(([name, label]) => ({
            name: name!,
            label: t(label!),
            kind: "text" as const,
            required: true,
            monospace: true,
            ...(name === "designRequestId" && designRequestId !== undefined
              ? { initialValue: designRequestId }
              : {}),
          }))}
          toArgs={(values, requestId) => ({
            requestId,
            designRequestId: values.designRequestId ?? "",
            assignedToUserId: values.assignedToUserId ?? "",
          })}
        />
      )}
      {mode === "revision" ? null : (
        <EntityWriteForm
          mutationRef={progressDesignRequestRef}
          legend={t("progressDesign")}
          submitLabel={t("progress")}
          requiredMessage={t("requiredField")}
          fields={[
            {
              name: "designRequestId",
              label: t("designRequestId"),
              kind: "text",
              required: true,
              monospace: true,
              ...(designRequestId === undefined
                ? {}
                : { initialValue: designRequestId }),
            },
            {
              name: "nextStatus",
              label: t("nextStatus"),
              kind: "select",
              required: true,
              options: [
                { value: "IN_PROGRESS", label: t("status.IN_PROGRESS") },
                { value: "IN_REVIEW", label: t("status.IN_REVIEW") },
              ],
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            designRequestId: values.designRequestId ?? "",
            nextStatus: (values.nextStatus ?? "IN_PROGRESS") as
              "IN_PROGRESS" | "IN_REVIEW",
          })}
        />
      )}
      {mode === "request" || revisionStatus !== "DRAFT" ? null : (
        <EntityWriteForm
          mutationRef={submitMasterCardRevisionRef}
          legend={t("submitRevision")}
          submitLabel={t("submitForReview")}
          requiredMessage={t("requiredField")}
          fields={[revisionIdField(t, masterCardRevisionId)]}
          toArgs={(values, requestId) => ({
            requestId,
            masterCardRevisionId: values.masterCardRevisionId ?? "",
          })}
        />
      )}
      {mode === "request" || revisionStatus !== "IN_REVIEW" ? null : (
        <EntityWriteForm
          mutationRef={decideMasterCardRevisionRef}
          legend={t("decideRevision")}
          submitLabel={t("recordDecision")}
          requiredMessage={t("requiredField")}
          fields={[
            revisionIdField(t, masterCardRevisionId),
            {
              name: "decision",
              label: t("decision"),
              kind: "select",
              required: true,
              options: [
                { value: "APPROVE", label: t("approve") },
                { value: "REJECT", label: t("reject") },
              ],
            },
            {
              name: "note",
              label: t("decisionNote"),
              kind: "textarea",

              importance: "secondary",
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            masterCardRevisionId: values.masterCardRevisionId ?? "",
            decision: (values.decision ?? "REJECT") as "APPROVE" | "REJECT",
            ...((values.note ?? "") === "" ? {} : { note: values.note }),
          })}
        />
      )}
      {mode === "revision" || designRequestId === undefined ? null : (
        <EntityWriteForm
          mutationRef={fulfilDesignRequestRef}
          legend={t("fulfilDesign")}
          submitLabel={t("fulfil")}
          requiredMessage={t("requiredField")}
          fields={[
            {
              name: "designRequestId",
              label: t("designRequestId"),
              kind: "text",
              required: true,
              monospace: true,
              initialValue: designRequestId,
            },
            revisionIdField(t, masterCardRevisionId),
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            designRequestId: values.designRequestId ?? "",
            masterCardRevisionId: values.masterCardRevisionId ?? "",
          })}
        />
      )}
      {mode === "revision" ? null : (
        <EntityWriteForm
          mutationRef={confirmSimilarDesignRef}
          legend={t("confirmSimilar")}
          description={t("confirmSimilarDetail")}
          submitLabel={t("confirmReuse")}
          requiredMessage={t("requiredField")}
          fields={[
            {
              name: "designRequestId",
              label: t("designRequestId"),
              kind: "text",
              required: true,
              monospace: true,
              ...(designRequestId === undefined
                ? {}
                : { initialValue: designRequestId }),
            },
            revisionIdField(t, masterCardRevisionId),
            {
              name: "reason",
              label: t("confirmationReason"),
              kind: "textarea",
              required: true,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            designRequestId: values.designRequestId ?? "",
            masterCardRevisionId: values.masterCardRevisionId ?? "",
            reason: values.reason ?? "",
          })}
        />
      )}
    </div>
  );
}

export function FactoryWorkflowActions({
  warehouseId,
  factoryPacketId,
  issueOnly = false,
}: {
  readonly warehouseId?: string;
  readonly factoryPacketId?: string;
  readonly issueOnly?: boolean;
}) {
  const t = useTranslations("OrderToShip");
  return (
    <div className="grid gap-4 xl:grid-cols-2 print:hidden">
      <EntityWriteForm
        mutationRef={issueFactoryPacketRef}
        legend={t("issuePacket")}
        submitLabel={t("issue")}
        requiredMessage={t("requiredField")}
        fields={[
          ["warehouseId", "warehouseId"],
          ["customerOrderLineId", "customerOrderLineId"],
        ].map(([name, label]) => ({
          name: name!,
          label: t(label!),
          kind: "text" as const,
          required: true,
          monospace: true,
          ...(name === "warehouseId" && warehouseId !== undefined
            ? { initialValue: warehouseId }
            : {}),
        }))}
        toArgs={(values, requestId) => ({
          requestId,
          warehouseId: values.warehouseId ?? "",
          customerOrderLineId: values.customerOrderLineId ?? "",
        })}
      />
      {issueOnly ? null : (
        <EntityWriteForm
          mutationRef={acknowledgeFactoryPacketRef}
          legend={t("acknowledgePacket")}
          submitLabel={t("acknowledge")}
          requiredMessage={t("requiredField")}
          fields={[
            ["warehouseId", "warehouseId"],
            ["factoryPacketId", "factoryPacketId"],
          ].map(([name, label]) => ({
            name: name!,
            label: t(label!),
            kind: "text" as const,
            required: true,
            monospace: true,
            ...(name === "warehouseId" && warehouseId !== undefined
              ? { initialValue: warehouseId }
              : name === "factoryPacketId" && factoryPacketId !== undefined
                ? { initialValue: factoryPacketId }
                : {}),
          }))}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId: values.warehouseId ?? "",
            factoryPacketId: values.factoryPacketId ?? "",
          })}
        />
      )}
    </div>
  );
}

const revisionIdField = (
  t: ReturnType<typeof useTranslations>,
  masterCardRevisionId?: string,
) => ({
  name: "masterCardRevisionId",
  label: t("masterCardRevisionId"),
  kind: "text" as const,
  required: true,
  monospace: true,
  ...(masterCardRevisionId === undefined
    ? {}
    : { initialValue: masterCardRevisionId }),
});
