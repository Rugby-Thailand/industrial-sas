"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { CheckCircle2, Clock, Copy, Send, Unlink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { useNavigationDraft } from "@/components/navigation/navigationDraft";
import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { ErrorNotice, Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SelectControl } from "@/components/ui/SelectControl";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { CustomerGate } from "@/features/customers/customerAccess";
import { useAsyncOperation } from "@/hooks/useAsyncOperation";
import {
  customerLineRefs,
  readLineWriteOutcome,
  resolveLineWebhookUrl,
  type LinePrimaryConnection,
} from "./lineApi";
import { ConnectionStateBadge, useLineViewer } from "./lineShared";

export function CustomerLineSettings() {
  const t = useTranslations("CustomerLine");
  return (
    <CustomerGate
      loadingLabel={t("loadingSettings")}
      frame={
        <PageHeader
          title={t("settingsTitle")}
          summary={t("settingsSummary")}
          backFallbackHref="/master-data/customers/line"
        />
      }
    >
      <CustomerLineSettingsBody />
    </CustomerGate>
  );
}

function CustomerLineSettingsBody() {
  const t = useTranslations("CustomerLine");
  const { loading, deniedRequestId, viewer } = useLineViewer();

  if (loading) {
    return (
      <>
        <PageHeader
          title={t("settingsTitle")}
          summary={t("settingsSummary")}
          backFallbackHref="/master-data/customers/line"
        />
        <LedgerPanelStatus
          state={{ kind: "LOADING" }}
          label={t("loadingSettings")}
        />
      </>
    );
  }

  if (deniedRequestId !== null) {
    return (
      <>
        <PageHeader
          title={t("settingsTitle")}
          summary={t("settingsSummary")}
          backFallbackHref="/master-data/customers/line"
        />
        <LedgerPanelStatus
          state={{ kind: "DENIED", requestId: deniedRequestId }}
        />
      </>
    );
  }

  if (!viewer?.canManageConnection) {
    return (
      <>
        <PageHeader
          title={t("settingsTitle")}
          summary={t("settingsSummary")}
          backFallbackHref="/master-data/customers/line"
        />
        <Notice
          tone="danger"
          role="alert"
          title={t("settingsDeniedTitle")}
          body={t("settingsDeniedBody")}
          testId="customer-line-settings-denied"
        />
      </>
    );
  }

  return <CustomerLineSettingsContent />;
}

function CustomerLineSettingsContent() {
  const t = useTranslations("CustomerLine");
  const format = useFormatter();
  const environment = useAppEnvironment();

  const connectionOutcome = useQuery(customerLineRefs.getPrimaryConnection, {});
  const groupsOutcome = useQuery(customerLineRefs.listGroups, {});
  const disconnectConnection = useMutation(
    customerLineRefs.disconnectConnection,
  );
  const testConnection = useAction(customerLineRefs.testConnection);

  const disconnectOperation = useAsyncOperation({
    scope: "customer-line-disconnect-oa",
    describeError: () => "UNKNOWN",
    navigation: "write",
  });
  const testOperation = useAsyncOperation({
    scope: "customer-line-test-oa",
    describeError: () => "UNKNOWN",
    navigation: "write",
  });

  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState({
    connectionId: "",
    name: "",
  });
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const [selectedTestGroupId, setSelectedTestGroupId] = useState("");
  const [testError, setTestError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  if (connectionOutcome === undefined) {
    return (
      <>
        <PageHeader
          title={t("settingsTitle")}
          summary={t("settingsSummary")}
          backFallbackHref="/master-data/customers/line"
        />
        <LedgerPanelStatus
          state={{ kind: "LOADING" }}
          label={t("loadingSettings")}
        />
      </>
    );
  }

  if (!connectionOutcome.ok) {
    return (
      <>
        <PageHeader
          title={t("settingsTitle")}
          summary={t("settingsSummary")}
          backFallbackHref="/master-data/customers/line"
        />
        <LedgerPanelStatus
          state={{
            kind: "DENIED",
            requestId: connectionOutcome.denial.requestId,
          }}
        />
      </>
    );
  }

  const connection = connectionOutcome.value;
  const pendingGroups = (
    groupsOutcome?.ok ? groupsOutcome.value.page : []
  ).filter((group) => group.state === "pending");
  const effectiveTestGroupId = pendingGroups.some(
    (group) => group._id === selectedTestGroupId,
  )
    ? selectedTestGroupId
    : (pendingGroups[0]?._id ?? "");
  const webhookUrl = connection
    ? resolveLineWebhookUrl(connection.webhookPath, {
        convexUrl: environment.convexUrl,
      })
    : "";

  async function handleCopyWebhook() {
    if (!webhookUrl) return;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(webhookUrl);
        setCopyStatus(t("copied"));
        return;
      } catch {
        // Fall through to status hint if clipboard is unavailable.
      }
    }
    setCopyStatus(t("copyFallbackSelected"));
  }

  async function handleSendTestPing() {
    if (testOperation.busy || !connection || !effectiveTestGroupId) return;
    setTestError(null);
    setTestStatus("");
    await testOperation.run(
      async () =>
        testConnection({
          connectionId: connection._id,
          groupId: effectiveTestGroupId,
        }),
      (outcome) => {
        const result = readLineWriteOutcome(outcome);
        if (!result.ok) {
          setTestError(t(`errors.${result.code}`));
          return;
        }
        setTestStatus(t("testPingSuccess"));
      },
    );
  }

  async function confirmDisconnectOa() {
    if (disconnectOperation.busy || !disconnectTarget.connectionId) return;
    setDisconnectError(null);
    await disconnectOperation.run(
      async () =>
        disconnectConnection({
          connectionId: disconnectTarget.connectionId,
        }),
      (outcome) => {
        const result = readLineWriteOutcome(outcome);
        if (!result.ok) {
          setDisconnectError(t(`errors.${result.code}`));
        } else {
          disconnectOperation.complete(() => setDisconnectOpen(false));
        }
      },
    );
  }

  const displayedTestError =
    testError ?? (testOperation.error ? t("errors.UNKNOWN") : null);
  const displayedDisconnectError =
    disconnectError ?? (disconnectOperation.error ? t("errors.UNKNOWN") : null);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("settingsTitle")}
        summary={t("settingsSummary")}
        backFallbackHref="/master-data/customers/line"
      />

      {connection ? (
        <Panel as="section" className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg leading-7 font-semibold text-text">
                  {connection.name}
                </h2>
                <StatusBadge tone="accent" label={t("primaryAccountBadge")} />
                <ConnectionStateBadge state={connection.state} />
              </div>
              <p className="font-mono text-xs text-muted">
                {connection.basicId}
              </p>
            </div>
            {connection.state !== "disconnected" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDisconnectError(null);
                  setDisconnectTarget({
                    connectionId: connection._id,
                    name: connection.name,
                  });
                  setDisconnectOpen(true);
                }}
                data-testid="line-disconnect-oa"
              >
                <Unlink aria-hidden="true" className="size-4" />
                {t("disconnectOa")}
              </Button>
            ) : null}
          </div>

          <div className="space-y-1.5 border-t border-border pt-4">
            <p className="text-xs font-medium text-muted">
              {t("webhookUrlLabel")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code
                data-testid="line-webhook-url"
                className="min-w-0 flex-1 rounded-md border border-border bg-raised px-3 py-2 font-mono text-xs wrap-anywhere text-text"
              >
                {webhookUrl}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleCopyWebhook()}
                data-testid="line-copy-webhook"
              >
                <Copy aria-hidden="true" className="size-4" />
                {t("copyWebhookUrl")}
              </Button>
            </div>
            <p role="status" className="text-xs text-muted">
              {copyStatus}
            </p>
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            <SectionHeader
              level={3}
              title={t("readinessTitle")}
              description={t("readinessDescription")}
            />
            <ul
              aria-label={t("readinessTitle")}
              data-testid="line-readiness-checks"
              className="divide-y divide-border rounded-lg border border-border"
            >
              <ReadinessRow
                label={t("checkIdentity")}
                timestamp={connection.identityVerifiedAt}
                format={format}
              />
              <ReadinessRow
                label={t("checkWebhook")}
                timestamp={connection.webhookVerifiedAt}
                format={format}
              />
              <ReadinessRow
                label={t("checkTestPing")}
                timestamp={connection.testSentAt}
                format={format}
              />
            </ul>
            <p className="text-xs leading-relaxed text-muted">
              {t("groupJoinHint")}
            </p>
          </div>

          {connection.state !== "disconnected" ? (
            <div className="space-y-3 border-t border-border pt-4">
              <SectionHeader
                level={3}
                title={t("testPingTitle")}
                description={t("testPingDescription")}
              />
              {pendingGroups.length === 0 ? (
                <p
                  className="text-sm text-muted"
                  data-testid="line-test-groups-empty"
                >
                  {t("testGroupEmpty")}
                </p>
              ) : (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-56 flex-1 space-y-1.5">
                    <span className="block text-xs font-medium text-text">
                      {t("testGroupLabel")}
                    </span>
                    <SelectControl
                      label={t("testGroupLabel")}
                      value={effectiveTestGroupId}
                      onValueChange={(next) => {
                        setSelectedTestGroupId(next);
                        if (testError) setTestError(null);
                      }}
                      placeholder={t("testGroupPlaceholder")}
                      emptyLabel={t("testGroupEmpty")}
                      disabled={testOperation.busy}
                      options={pendingGroups.map((group) => ({
                        value: group._id,
                        label: group.name,
                      }))}
                      testId="line-test-group-select"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!effectiveTestGroupId}
                    pending={testOperation.busy}
                    pendingLabel={t("testPingSending")}
                    onClick={() => void handleSendTestPing()}
                    data-testid="line-send-test-ping"
                  >
                    <Send aria-hidden="true" className="size-4" />
                    {t("testPingSubmit")}
                  </Button>
                </div>
              )}
              <ErrorNotice message={displayedTestError} />
              <p role="status" className="text-xs text-muted">
                {testStatus}
              </p>
            </div>
          ) : null}
        </Panel>
      ) : null}

      <PrimaryCredentialsCard connection={connection} />

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title={t("disconnectOaTitle")}
        description={t("disconnectOaBody", { name: disconnectTarget.name })}
        error={displayedDisconnectError}
        cancelLabel={t("cancel")}
        confirmLabel={t("disconnectOaConfirm")}
        pendingLabel={t("disconnectingOa")}
        tone="destructive"
        pending={disconnectOperation.busy}
        onConfirm={() => void confirmDisconnectOa()}
        testId="line-oa-disconnect-dialog"
      />
    </div>
  );
}

function ReadinessRow({
  label,
  timestamp,
  format,
}: {
  readonly label: string;
  readonly timestamp?: number | undefined;
  readonly format: ReturnType<typeof useFormatter>;
}) {
  const t = useTranslations("CustomerLine");
  const passed = typeof timestamp === "number" && timestamp > 0;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
      <span className="flex items-center gap-2 font-medium text-text">
        {passed ? (
          <CheckCircle2
            aria-hidden="true"
            className="size-4 shrink-0 text-success"
          />
        ) : (
          <Clock aria-hidden="true" className="size-4 shrink-0 text-muted" />
        )}
        {label}
      </span>
      <StatusBadge
        tone={passed ? "success" : "pending"}
        label={
          passed
            ? t("checkPassed", {
                time: format.dateTime(timestamp, {
                  dateStyle: "short",
                  timeStyle: "short",
                }),
              })
            : t("checkPending")
        }
      />
    </li>
  );
}

function PrimaryCredentialsCard({
  connection,
}: {
  readonly connection: LinePrimaryConnection | null;
}) {
  const t = useTranslations("CustomerLine");
  const secretId = useId();
  const tokenId = useId();
  const connectPrimary = useAction(customerLineRefs.connectPrimary);
  const operation = useAsyncOperation({
    scope: "customer-line-connect-oa",
    describeError: () => "UNKNOWN",
    navigation: "write",
  });

  const [channelSecret, setChannelSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  useNavigationDraft({
    dirty: channelSecret.trim().length > 0 || accessToken.trim().length > 0,
    pending: operation.busy,
    discard: () => {
      setChannelSecret("");
      setAccessToken("");
      setError(null);
    },
  });

  async function handleConnect(event: FormEvent) {
    event.preventDefault();
    if (operation.busy) return;
    const trimmedSecret = channelSecret.trim();
    const trimmedToken = accessToken.trim();
    if (!trimmedSecret || !trimmedToken) {
      setError(t("credentialsRequired"));
      return;
    }
    setError(null);
    setStatusMessage("");
    await operation.run(
      async () =>
        connectPrimary({
          channelSecret: trimmedSecret,
          accessToken: trimmedToken,
        }),
      (outcome) => {
        const result = readLineWriteOutcome(outcome);
        if (!result.ok) {
          setError(t(`errors.${result.code}`));
          return;
        }
        setChannelSecret("");
        setAccessToken("");
        setStatusMessage(t("connectSuccess"));
      },
    );
  }

  const displayedError =
    error ?? (operation.error ? t("errors.UNKNOWN") : null);

  const form = (
    <form
      onSubmit={(event) => void handleConnect(event)}
      className="space-y-4"
      data-testid="line-connect-oa-form"
    >
      <FormField
        id={secretId}
        label={t("channelSecretLabel")}
        hint={t("channelSecretHint")}
        required
      >
        {(props) => (
          <Input
            {...props}
            type="password"
            autoComplete="off"
            value={channelSecret}
            disabled={operation.busy}
            onChange={(event) => {
              setChannelSecret(event.target.value);
              if (error) setError(null);
              if (statusMessage) setStatusMessage("");
            }}
          />
        )}
      </FormField>
      <FormField
        id={tokenId}
        label={t("accessTokenLabel")}
        hint={t("accessTokenHint")}
        required
      >
        {(props) => (
          <Input
            {...props}
            type="password"
            autoComplete="off"
            value={accessToken}
            disabled={operation.busy}
            onChange={(event) => {
              setAccessToken(event.target.value);
              if (error) setError(null);
              if (statusMessage) setStatusMessage("");
            }}
          />
        )}
      </FormField>
      <ErrorNotice message={displayedError} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          pending={operation.busy}
          pendingLabel={t("connecting")}
          data-testid="line-connect-oa-submit"
        >
          {t("connectSubmit")}
        </Button>
        <span role="status" className="text-xs text-muted">
          {statusMessage}
        </span>
      </div>
    </form>
  );

  if (connection && connection.state !== "disconnected") {
    return (
      <CollapsibleSection
        label={t("settingsUpdateCredentials")}
        testId="line-update-credentials-section"
      >
        <p className="mb-4 text-sm text-muted">
          {t("settingsConnectDescription")}
        </p>
        {form}
      </CollapsibleSection>
    );
  }

  return (
    <Panel as="section" className="space-y-4">
      <SectionHeader
        title={t("settingsConnectTitle")}
        description={t("settingsConnectDescription")}
      />
      {form}
    </Panel>
  );
}
