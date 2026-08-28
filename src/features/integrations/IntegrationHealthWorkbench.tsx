"use client";

import { useQuery } from "convex/react";
import { ListOrdered } from "lucide-react";
import { useTranslations } from "next-intl";

import { DataTable } from "@/components/table/DataTable";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import {
  listIntegrationHealthRef,
  registerIntegrationAdapterRef,
  setIntegrationAdapterStatusRef,
  type IntegrationAdapterStatus,
  type IntegrationHealthPayload,
  type IntegrationHealthRow,
} from "@/lib/convex/integrationApi";

const PREVIEW_HEALTH: IntegrationHealthPayload = {
  adapters: [
    {
      adapterId: "prv_adapter_erp",
      code: "ERP_PRIMARY",
      displayName: "ERP primary",
      kind: "ERP",
      status: "ENABLED",
      pending: 3,
      retrying: 0,
      delivering: 1,
      deadLetter: 0,
      lastSuccessAt: Date.UTC(2026, 7, 17, 5, 14),
      complete: true,
    },
    {
      adapterId: "prv_adapter_webhook",
      code: "CUSTOMER_WEBHOOK",
      displayName: "Customer status webhook",
      kind: "WEBHOOK",
      status: "DEGRADED",
      pending: 1,
      retrying: 2,
      delivering: 0,
      deadLetter: 1,
      lastSuccessAt: Date.UTC(2026, 7, 17, 4, 42),
      lastFailureAt: Date.UTC(2026, 7, 17, 5, 16),
      lastFailureCode: "PROVIDER_TIMEOUT",
      complete: true,
    },
    {
      adapterId: "prv_adapter_line",
      code: "LINE_ALERTS",
      displayName: "LINE operational alerts",
      kind: "LINE",
      status: "DISABLED",
      pending: 0,
      retrying: 0,
      delivering: 0,
      deadLetter: 0,
      complete: true,
    },
  ],
  complete: true,
  asOf: Date.UTC(2026, 7, 17, 5, 17),
};

const dateTime = (value: number | undefined) =>
  value === undefined
    ? "—"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(value);

const toneOf = (status: IntegrationAdapterStatus): BadgeTone => {
  if (status === "ENABLED") return "success";
  if (status === "DEGRADED") return "warning";
  return "muted";
};

export function IntegrationHealthWorkbench() {
  return (
    <QueryGate scope="ORG">
      {(_warehouseId, preview) =>
        preview ? (
          <IntegrationContent health={PREVIEW_HEALTH} preview />
        ) : (
          <ServerIntegrationHealth />
        )
      }
    </QueryGate>
  );
}

function ServerIntegrationHealth() {
  const outcome = useQuery(listIntegrationHealthRef, {});
  if (outcome === undefined) {
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  }
  if (!outcome.ok) {
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  }
  return <IntegrationContent health={outcome.value} />;
}

function IntegrationContent({
  health,
  preview = false,
}: {
  readonly health: IntegrationHealthPayload;
  readonly preview?: boolean;
}) {
  const t = useTranslations("Integrations");
  const delayed = health.adapters.reduce(
    (sum, adapter) => sum + adapter.retrying,
    0,
  );
  const blocked = health.adapters.reduce(
    (sum, adapter) => sum + adapter.deadLetter,
    0,
  );

  return (
    <div className="space-y-6">
      {preview ? (
        <Notice
          tone="accent"
          title={t("previewTitle")}
          body={t("previewBody")}
          testId="integration-preview-notice"
        />
      ) : null}

      {/*
       * The delivery-pipeline explainer is training material: collapsed so the
       * live health summary is what an operator lands on.
       */}
      <CollapsibleSection label={t("flowTitle")} icon={ListOrdered}>
        <ol className="grid gap-3 md:grid-cols-5">
          {(["commit", "queue", "deliver", "recover", "verify"] as const).map(
            (step, index) => (
              <li
                key={step}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <span className="text-xs font-semibold text-accent">
                  {t("stepNumber", { value: index + 1 })}
                </span>
                <p className="mt-1 font-semibold text-text">
                  {t(`flow.${step}`)}
                </p>
              </li>
            ),
          )}
        </ol>
      </CollapsibleSection>

      <section
        className="grid gap-4 sm:grid-cols-3"
        aria-label={t("summaryTitle")}
      >
        <Metric label={t("adapters")} value={health.adapters.length} />
        <Metric
          label={t("delayed")}
          value={delayed}
          tone={delayed > 0 ? "warning" : "success"}
        />
        <Metric
          label={t("blocked")}
          value={blocked}
          tone={blocked > 0 ? "danger" : "success"}
        />
      </section>

      <Card data-testid="integration-health-register">
        <CardHeader>
          <CardTitle>{t("healthTitle")}</CardTitle>
          <CardDescription>{t("healthHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {health.adapters.length === 0 ? (
            <Notice
              tone="neutral"
              title={t("emptyTitle")}
              body={t("emptyBody")}
            />
          ) : (
            <HealthTable rows={health.adapters} />
          )}
          {!health.complete ? (
            <Notice
              tone="warning"
              title={t("partialTitle")}
              body={t("partialBody")}
            />
          ) : null}
          <p className="text-xs text-muted">
            {t("asOf", { value: dateTime(health.asOf) })}
          </p>
        </CardContent>
      </Card>

      <section
        className="grid gap-4 xl:grid-cols-2"
        aria-label={t("controlsTitle")}
      >
        <EntityWriteForm
          mutationRef={registerIntegrationAdapterRef}
          legend={t("registerTitle")}
          description={t("registerHelp")}
          submitLabel={t("register")}
          requiredMessage={t("required")}
          testId="integration-register-form"
          fields={[
            {
              name: "code",
              label: t("code"),
              kind: "text",
              required: true,
              monospace: true,
              placeholder: "ERP_PRIMARY",
            },
            {
              name: "displayName",
              label: t("displayName"),
              kind: "text",
              required: true,
            },
            {
              name: "kind",
              label: t("kind"),
              kind: "select",
              required: true,
              placeholder: t("chooseKind"),
              options: (
                ["WEBHOOK", "ERP", "EMAIL", "LINE", "PRINTER"] as const
              ).map((kind) => ({ value: kind, label: t(`kindValue.${kind}`) })),
            },
            {
              name: "configurationKey",
              label: t("configurationKey"),
              kind: "text",
              required: true,
              monospace: true,
              hint: t("configurationHint"),
              placeholder: "ERP_PRIMARY_CONFIG",
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            code: values["code"] ?? "",
            displayName: values["displayName"] ?? "",
            kind: values["kind"] as
              "WEBHOOK" | "ERP" | "EMAIL" | "LINE" | "PRINTER",
            configurationKey: values["configurationKey"] ?? "",
          })}
        />

        <EntityWriteForm
          mutationRef={setIntegrationAdapterStatusRef}
          legend={t("statusTitle")}
          description={t("statusHelp")}
          submitLabel={t("changeStatus")}
          requiredMessage={t("required")}
          testId="integration-status-form"
          fields={[
            {
              name: "adapterId",
              label: t("adapter"),
              kind: "select",
              required: true,
              placeholder: t("chooseAdapter"),
              options: health.adapters.map((adapter) => ({
                value: adapter.adapterId,
                label: `${adapter.code} — ${adapter.displayName}`,
              })),
            },
            {
              name: "status",
              label: t("status"),
              kind: "select",
              required: true,
              placeholder: t("chooseStatus"),
              options: [
                { value: "ENABLED", label: t("statusValue.ENABLED") },
                { value: "DISABLED", label: t("statusValue.DISABLED") },
              ],
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            adapterId: values["adapterId"] ?? "",
            status: values["status"] as "ENABLED" | "DISABLED",
          })}
        />
      </section>

      <Notice
        tone="warning"
        title={t("fallbackTitle")}
        body={t("fallbackBody")}
      />
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: BadgeTone;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center justify-between gap-3">
        <span className="font-medium text-text">{label}</span>
        <StatusBadge tone={tone} label={String(value)} />
      </CardContent>
    </Card>
  );
}

function HealthTable({
  rows,
}: {
  readonly rows: readonly IntegrationHealthRow[];
}) {
  const t = useTranslations("Integrations");
  const caption = t("healthCaption");
  return (
    <DataTable<IntegrationHealthRow>
      caption={caption}
      tableClassName="min-w-[960px]"
      rows={rows}
      rowKey={(row) => row.adapterId}
      columns={[
        {
          key: "adapter",
          header: t("adapter"),
          rowHeader: true,
          monospace: false,
          render: (row) => (
            <>
              <span className="block font-mono font-semibold text-text">
                {row.code}
              </span>
              <span className="block text-xs font-normal text-muted">
                {row.displayName} · {t(`kindValue.${row.kind}`)}
              </span>
            </>
          ),
        },
        {
          key: "status",
          header: t("status"),
          render: (row) => (
            <StatusBadge
              tone={toneOf(row.status)}
              label={t(`statusValue.${row.status}`)}
            />
          ),
        },
        {
          key: "pending",
          header: t("pending"),
          align: "right",
          cellClassName: "tabular-nums",
          render: (row) => row.pending + row.delivering,
        },
        {
          key: "retrying",
          header: t("retrying"),
          align: "right",
          cellClassName: "tabular-nums",
          render: (row) => row.retrying,
        },
        {
          key: "deadLetter",
          header: t("deadLetter"),
          align: "right",
          cellClassName: "tabular-nums",
          render: (row) => row.deadLetter,
        },
        {
          key: "lastResult",
          header: t("lastResult"),
          render: (row) => (
            <>
              <span className="block">{dateTime(row.lastSuccessAt)}</span>
              {row.lastFailureCode === undefined ? null : (
                <code className="mt-1 block text-xs text-danger">
                  {row.lastFailureCode}
                </code>
              )}
            </>
          ),
        },
        {
          key: "nextAction",
          header: t("nextAction"),
          cellClassName: "text-xs text-muted",
          render: (row) =>
            t(
              row.status === "DISABLED"
                ? "actionDisabled"
                : row.deadLetter > 0
                  ? "actionBlocked"
                  : row.retrying > 0
                    ? "actionDelayed"
                    : "actionHealthy",
            ),
        },
      ]}
    />
  );
}
