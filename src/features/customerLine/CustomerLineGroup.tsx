"use client";

import { useMutation, useQuery } from "convex/react";
import {
  Building2,
  Pause,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  ShieldOff,
  Unlink,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { useNavigationDraft } from "@/components/navigation/navigationDraft";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/CheckboxControl";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { ErrorNotice, Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { CustomerGate } from "@/features/customers/customerAccess";
import { CustomerPicker } from "@/features/customers/CustomerPicker";
import { useAsyncOperation } from "@/hooks/useAsyncOperation";
import { Link, useRouter } from "@/i18n/navigation";
import { customerPath } from "@/lib/navigation";
import { completeTask } from "@/lib/taskNavigation";
import {
  CUSTOMER_LINE_SETTINGS_PATH,
  customerLineGroupPath,
  customerLineRefs,
  readLineWriteOutcome,
  type LineContact,
  type LineGroup,
  type LinePrimaryConnectionSummary,
  type LineViewer,
} from "./lineApi";
import {
  ContactStateBadge,
  GroupStateBadge,
  ProviderDepartureBadge,
  QuestionStateBadge,
  useLineViewer,
} from "./lineShared";

export function CustomerLineGroup({ groupId }: { readonly groupId: string }) {
  const t = useTranslations("CustomerLine");
  return (
    <CustomerGate
      loadingLabel={t("loadingGroup")}
      frame={
        <PageHeader
          title={t("groupDetailTitle")}
          backFallbackHref="/master-data/customers/line"
        />
      }
    >
      <CustomerLineGroupBody key={groupId} groupId={groupId} />
    </CustomerGate>
  );
}

function CustomerLineGroupBody({ groupId }: { readonly groupId: string }) {
  const t = useTranslations("CustomerLine");
  const { loading, deniedRequestId, viewer } = useLineViewer();

  if (loading) {
    return (
      <>
        <PageHeader
          title={t("groupDetailTitle")}
          backFallbackHref="/master-data/customers/line"
        />
        <LedgerPanelStatus
          state={{ kind: "LOADING" }}
          label={t("loadingGroup")}
        />
      </>
    );
  }

  if (deniedRequestId !== null) {
    return (
      <>
        <PageHeader
          title={t("groupDetailTitle")}
          backFallbackHref="/master-data/customers/line"
        />
        <LedgerPanelStatus
          state={{ kind: "DENIED", requestId: deniedRequestId }}
        />
      </>
    );
  }

  if (!viewer?.canRead) {
    return (
      <>
        <PageHeader
          title={t("groupDetailTitle")}
          backFallbackHref="/master-data/customers/line"
        />
        <Notice
          tone="danger"
          role="alert"
          title={t("accessDeniedTitle")}
          body={t("accessDeniedBody")}
          testId="customer-line-denied"
        />
      </>
    );
  }

  return <CustomerLineGroupQuery groupId={groupId} viewer={viewer} />;
}

function CustomerLineGroupQuery({
  groupId,
  viewer,
}: {
  readonly groupId: string;
  readonly viewer: LineViewer;
}) {
  const t = useTranslations("CustomerLine");
  const router = useRouter();
  const setGroupState = useMutation(customerLineRefs.setGroupState);
  const stateOperation = useAsyncOperation({
    scope: `customer-line-group-state:${groupId}`,
    describeError: () => t("errors.UNKNOWN"),
    navigation: "write",
  });
  const [stateError, setStateError] = useState<string | null>(null);

  // The query can lose the old enrollment while the mutation settles.
  async function runStateTransition(
    expectedVersion: number,
    state: "active" | "paused" | "pending",
  ) {
    if (stateOperation.busy) return;
    setStateError(null);
    await stateOperation.run(
      () => setGroupState({ groupId, expectedVersion, state }),
      (outcome) => {
        const result = readLineWriteOutcome(outcome);
        if (!result.ok) {
          setStateError(t(`errors.${result.code}`));
          return;
        }
        if (
          outcome.ok &&
          typeof outcome.value === "object" &&
          outcome.value !== null &&
          "groupId" in outcome.value
        ) {
          const destination = customerLineGroupPath(outcome.value.groupId);
          stateOperation.complete(() =>
            completeTask(destination, router.replace),
          );
        }
      },
    );
  }

  const groupOutcome = useQuery(customerLineRefs.getGroup, { groupId });
  const connectionOutcome = useQuery(
    customerLineRefs.getPrimaryConnectionSummary,
    {},
  );
  const connection = connectionOutcome?.ok
    ? connectionOutcome.value
    : undefined;

  if (
    groupOutcome === undefined ||
    (groupOutcome.ok && groupOutcome.value === null && stateOperation.busy)
  ) {
    return (
      <>
        <PageHeader
          title={t("groupDetailTitle")}
          backFallbackHref="/master-data/customers/line"
        />
        <LedgerPanelStatus
          state={{ kind: "LOADING" }}
          label={t("loadingGroup")}
        />
      </>
    );
  }

  if (!groupOutcome.ok) {
    return (
      <>
        <PageHeader
          title={t("groupDetailTitle")}
          backFallbackHref="/master-data/customers/line"
        />
        <LedgerPanelStatus
          state={{ kind: "DENIED", requestId: groupOutcome.denial.requestId }}
        />
      </>
    );
  }

  if (groupOutcome.value === null) {
    return (
      <>
        <PageHeader
          title={t("groupNotFoundTitle")}
          backFallbackHref="/master-data/customers/line"
        />
        <Notice
          tone="warning"
          title={t("groupNotFoundTitle")}
          body={t("groupNotFoundBody")}
          testId="line-group-not-found"
        />
      </>
    );
  }

  return (
    <CustomerLineGroupContent
      group={groupOutcome.value}
      connection={connection}
      viewer={viewer}
      stateBusy={stateOperation.busy}
      stateError={stateError ?? (stateOperation.error || null)}
      onStateTransition={runStateTransition}
    />
  );
}

function CustomerLineGroupContent({
  group,
  connection,
  viewer,
  stateBusy,
  stateError,
  onStateTransition,
}: {
  readonly group: LineGroup;
  readonly connection: LinePrimaryConnectionSummary | null | undefined;
  readonly viewer: LineViewer;
  readonly stateBusy: boolean;
  readonly stateError: string | null;
  readonly onStateTransition: (
    version: number,
    state: "active" | "paused" | "pending",
  ) => Promise<void>;
}) {
  const t = useTranslations("CustomerLine");
  const setGroupState = useMutation(customerLineRefs.setGroupState);

  const disconnectOperation = useAsyncOperation({
    scope: `customer-line-group-disconnect:${group._id}`,
    describeError: () => "UNKNOWN",
    navigation: "write",
  });
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState({
    name: group.name,
    version: group.version,
  });
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const oaReady = connection?.state === "active";
  const oaConnected =
    connection !== null &&
    connection !== undefined &&
    connection.state !== "disconnected";
  const providerLeft = group.providerDeparture === "left";

  async function confirmDisconnect() {
    if (disconnectOperation.busy) return;
    setDisconnectError(null);
    await disconnectOperation.run(
      async () =>
        setGroupState({
          groupId: group._id,
          expectedVersion: disconnectTarget.version,
          state: "disconnected",
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

  const displayedDisconnectError =
    disconnectError ?? (disconnectOperation.error ? t("errors.UNKNOWN") : null);

  return (
    <div className="space-y-4">
      <PageHeader
        title={group.name}
        backFallbackHref="/master-data/customers/line"
        meta={
          <>
            <GroupStateBadge state={group.state} />
            {group.providerDeparture ? (
              <ProviderDepartureBadge departure={group.providerDeparture} />
            ) : null}
            {group.customerId && group.customerName ? (
              <Link
                href={customerPath(group.customerId)}
                className="font-medium text-link hover:underline focus-visible:outline-2 focus-visible:outline-link"
              >
                {group.customerName}
              </Link>
            ) : connection ? (
              <span>
                {connection.name} ·{" "}
                <span className="font-mono">{connection.basicId}</span>
              </span>
            ) : null}
          </>
        }
      >
        {group.customerId ? (
          <Button asChild variant="outline">
            <Link
              href={customerPath(group.customerId)}
              data-testid="line-group-open-customer"
            >
              <Building2 aria-hidden="true" className="size-4" />
              {t("viewCustomer")}
            </Link>
          </Button>
        ) : null}
        {viewer.canManageGroups && group.state === "active" ? (
          <Button
            type="button"
            variant="outline"
            pending={stateBusy}
            pendingLabel={t("pausingGroup")}
            onClick={() => void onStateTransition(group.version, "paused")}
            data-testid="line-group-pause"
          >
            <Pause aria-hidden="true" className="size-4" />
            {t("pauseGroup")}
          </Button>
        ) : null}
        {viewer.canManageGroups && group.state === "paused" ? (
          <Button
            type="button"
            variant="outline"
            disabled={!oaReady}
            pending={stateBusy}
            pendingLabel={t("resumingGroup")}
            onClick={() => void onStateTransition(group.version, "active")}
            data-testid="line-group-resume"
          >
            <Play aria-hidden="true" className="size-4" />
            {t("resumeGroup")}
          </Button>
        ) : null}
        {viewer.canManageGroups &&
        (group.state === "paused" || group.state === "disconnected") ? (
          <Button
            type="button"
            variant="outline"
            disabled={!oaConnected || providerLeft}
            pending={stateBusy}
            pendingLabel={t("requestingReapproval")}
            onClick={() => void onStateTransition(group.version, "pending")}
            data-testid="line-group-reapprove"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            {t("requestReapproval")}
          </Button>
        ) : null}
        {viewer.canManageGroups &&
        (group.state === "active" || group.state === "paused") ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDisconnectError(null);
              setDisconnectTarget({
                name: group.name,
                version: group.version,
              });
              setDisconnectOpen(true);
            }}
            data-testid="line-group-disconnect"
          >
            <Unlink aria-hidden="true" className="size-4" />
            {t("disconnectGroup")}
          </Button>
        ) : null}
      </PageHeader>

      <ErrorNotice message={stateError} />

      {connection === null ? (
        <Notice
          tone="warning"
          title={t("oaMissingTitle")}
          body={t("oaMissingBody")}
          action={
            viewer.canManageConnection ? (
              <Button asChild size="sm" variant="outline">
                <Link href={CUSTOMER_LINE_SETTINGS_PATH}>
                  {t("openSettings")}
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : connection?.state === "disconnected" ? (
        <Notice
          tone="warning"
          title={t("oaDisconnectedTitle")}
          body={t("oaDisconnectedBody")}
          action={
            viewer.canManageConnection ? (
              <Button asChild size="sm" variant="outline">
                <Link href={CUSTOMER_LINE_SETTINGS_PATH}>
                  {t("openSettings")}
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : connection?.state === "setup" ? (
        <Notice
          tone="warning"
          title={t("oaSetupTitle")}
          body={t("oaSetupBody")}
          action={
            viewer.canManageConnection ? (
              <Button asChild size="sm" variant="outline">
                <Link href={CUSTOMER_LINE_SETTINGS_PATH}>
                  {t("openSettings")}
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {group.state === "pending" ? (
        <div className="space-y-4">
          <Notice
            tone="warning"
            title={t("pendingNoticeTitle")}
            body={t("pendingNoticeBody")}
            testId="line-group-pending-notice"
          />
          {viewer.canManageGroups ? (
            <PendingApprovalSection group={group} oaReady={oaReady} />
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {group.state === "paused" ? (
            <Notice
              tone="warning"
              title={t("pausedNoticeTitle")}
              body={t("pausedNoticeBody")}
              testId="line-group-paused-notice"
            />
          ) : null}
          {group.state === "disconnected" ? (
            <Notice
              tone="muted"
              title={t("disconnectedNoticeTitle")}
              body={
                group.providerDeparture === "left"
                  ? t("providerLeftNoticeBody")
                  : group.providerDeparture === "failed"
                    ? t("providerFailedNoticeBody")
                    : t("disconnectedNoticeBody")
              }
              testId="line-group-disconnected-notice"
            />
          ) : null}

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <GroupQuestionsSection
              group={group}
              oaReady={oaReady}
              canSend={viewer.canSend}
            />
            <GroupContactsSection
              groupId={group._id}
              canManageGroups={viewer.canManageGroups}
            />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title={t("disconnectGroupTitle", { name: disconnectTarget.name })}
        description={t("disconnectGroupBody")}
        error={displayedDisconnectError}
        cancelLabel={t("cancel")}
        confirmLabel={t("disconnectGroupConfirm")}
        pendingLabel={t("disconnectingGroup")}
        tone="destructive"
        pending={disconnectOperation.busy}
        onConfirm={() => void confirmDisconnect()}
        testId="line-group-disconnect-dialog"
      />
    </div>
  );
}

function PendingApprovalSection({
  group,
  oaReady,
}: {
  readonly group: LineGroup;
  readonly oaReady: boolean;
}) {
  const t = useTranslations("CustomerLine");
  const approveGroup = useMutation(customerLineRefs.approveGroup);
  const operation = useAsyncOperation({
    scope: `customer-line-approve:${group._id}`,
    describeError: () => "UNKNOWN",
    navigation: "write",
  });
  const [customerId, setCustomerId] = useState(group.customerId ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useNavigationDraft({
    dirty: customerId !== (group.customerId ?? "") || confirmed,
    pending: operation.busy,
    discard: () => {
      setCustomerId(group.customerId ?? "");
      setConfirmed(false);
      setError(null);
    },
  });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (operation.busy || !oaReady) return;
    if (!customerId) {
      setError(t("approveCustomerRequired"));
      return;
    }
    if (!confirmed) {
      setError(t("approveConfirmRequired"));
      return;
    }
    setError(null);
    await operation.run(
      async () =>
        approveGroup({
          groupId: group._id,
          customerId,
          expectedVersion: group.version,
          confirmed: true,
        }),
      (outcome) => {
        const result = readLineWriteOutcome(outcome);
        if (!result.ok) {
          setError(t(`errors.${result.code}`));
        } else {
          setConfirmed(false);
        }
      },
    );
  }

  const displayedError =
    error ?? (operation.error ? t("errors.UNKNOWN") : null);

  return (
    <Panel as="section" className="space-y-4">
      <SectionHeader
        title={t("approveSectionTitle")}
        description={t("approveSectionDescription")}
      />
      {!oaReady ? (
        <Notice tone="warning" title={t("approveRequiresOa")} />
      ) : null}
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="space-y-4"
        data-testid="line-approve-group-form"
      >
        <CustomerPicker
          label={t("approveCustomerLabel")}
          value={customerId}
          onChange={(next) => {
            setCustomerId(next);
            if (error) setError(null);
          }}
          unlinkedLabel={t("approveCustomerUnlinked")}
          searchPlaceholder={t("approveCustomerSearch")}
          disabled={operation.busy || !oaReady}
          testId="line-approve-customer-picker"
        />
        <CheckboxField
          checked={confirmed}
          disabled={operation.busy || !oaReady}
          onChange={(event) => {
            setConfirmed(event.target.checked);
            if (error) setError(null);
          }}
          label={t("approveConfirmLabel")}
          description={t("approveConfirmDescription")}
          data-testid="line-approve-confirm-checkbox"
        />
        <ErrorNotice message={displayedError} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            disabled={!oaReady}
            pending={operation.busy}
            pendingLabel={t("approving")}
            data-testid="line-approve-submit"
          >
            {t("approveSubmit")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function GroupQuestionsSection({
  group,
  oaReady,
  canSend,
}: {
  readonly group: LineGroup;
  readonly oaReady: boolean;
  readonly canSend: boolean;
}) {
  const t = useTranslations("CustomerLine");
  const format = useFormatter();
  const replyFieldId = useId();
  const queueReply = useMutation(customerLineRefs.queueReply);
  const replyOperation = useAsyncOperation({
    scope: `customer-line-reply:${group._id}`,
    describeError: () => "UNKNOWN",
    navigation: "write",
  });

  const [cursors, setCursors] = useState<string[]>([]);
  const activeCursor = cursors.at(-1);
  const questionsOutcome = useQuery(customerLineRefs.listQuestions, {
    groupId: group._id,
    ...(activeCursor ? { cursor: activeCursor } : {}),
  });

  const loading = questionsOutcome === undefined;
  const denied = questionsOutcome !== undefined && !questionsOutcome.ok;
  const page = questionsOutcome?.ok ? questionsOutcome.value : null;
  const questions = page?.page ?? [];
  const replyableQuestions = questions.filter(
    (item) => item.state === "open" || item.state === "failed",
  );

  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(
    null,
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirmedAudience, setConfirmedAudience] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyStatus, setReplyStatus] = useState("");

  const activeQuestion =
    replyableQuestions.find((item) => item._id === selectedQuestionId) ??
    replyableQuestions[0] ??
    null;
  const currentDraft = activeQuestion ? (drafts[activeQuestion._id] ?? "") : "";
  const hasAnyDraft = Object.values(drafts).some(
    (value) => value.trim().length > 0,
  );

  useNavigationDraft({
    dirty: canSend && group.state === "active" && hasAnyDraft,
    pending: replyOperation.busy,
    discard: () => {
      setDrafts({});
      setConfirmedAudience(false);
      setReplyError(null);
    },
  });

  async function handleSendReply(event: FormEvent) {
    event.preventDefault();
    if (replyOperation.busy || !activeQuestion || !oaReady) return;
    const trimmed = currentDraft.trim();
    if (!trimmed) {
      setReplyError(t("replyRequired"));
      return;
    }
    if (!confirmedAudience) {
      setReplyError(t("replyAudienceRequired"));
      return;
    }
    setReplyError(null);
    setReplyStatus("");
    const targetQuestionId = activeQuestion._id;
    await replyOperation.run(
      async () =>
        queueReply({
          groupId: group._id,
          questionId: targetQuestionId,
          text: trimmed,
          confirmedAudience: true,
        }),
      (outcome) => {
        const result = readLineWriteOutcome(outcome);
        if (!result.ok) {
          setReplyError(t(`errors.${result.code}`));
          return;
        }
        setDrafts((previous) => {
          const next = { ...previous };
          delete next[targetQuestionId];
          return next;
        });
        setConfirmedAudience(false);
        setReplyStatus(t("replyQueuedStatus"));
      },
    );
  }

  const displayedReplyError =
    replyError ?? (replyOperation.error ? t("errors.UNKNOWN") : null);
  const canCompose =
    group.state === "active" && oaReady && canSend && activeQuestion !== null;
  const hasPrevious = cursors.length > 0;
  const hasNext = Boolean(page?.continueCursor);

  return (
    <Panel as="section" className="space-y-4">
      <SectionHeader
        title={t("questionsTitle")}
        description={t("questionsDescription")}
      />

      {loading ? (
        <LedgerPanelStatus state={{ kind: "LOADING" }} label={t("loading")} />
      ) : denied ? (
        <LedgerPanelStatus
          state={{
            kind: "DENIED",
            requestId: questionsOutcome.denial.requestId,
          }}
        />
      ) : questions.length === 0 ? (
        <EmptyState
          compact
          title={t("questionsEmpty")}
          testId="line-questions-empty"
        />
      ) : (
        <ul className="space-y-3" data-testid="line-questions-list">
          {questions.map((question) => {
            const isSelected = activeQuestion?._id === question._id;
            const timeLabel = format.dateTime(question.createdAt, {
              dateStyle: "short",
              timeStyle: "short",
            });
            return (
              <li
                key={question._id}
                className="space-y-2 rounded-lg border border-border bg-raised/40 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span className="font-semibold text-text">
                    {question.senderLabel}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular-nums">{timeLabel}</span>
                    <QuestionStateBadge state={question.state} />
                  </div>
                </div>
                {(question.state === "open" || question.state === "failed") &&
                group.state === "active" &&
                canSend ? (
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={t("selectQuestionLabel", {
                      sender: question.senderLabel,
                    })}
                    onClick={() => {
                      setSelectedQuestionId(question._id);
                      setConfirmedAudience(false);
                      setReplyError(null);
                    }}
                    data-testid={`line-question-select-${question._id}`}
                    className={`w-full rounded-md border p-2.5 text-left text-sm wrap-anywhere transition-colors focus-visible:outline-2 focus-visible:outline-link ${
                      isSelected
                        ? "border-link bg-selected text-text"
                        : "border-border bg-surface text-text hover:border-link"
                    }`}
                  >
                    <span className="block">{question.text}</span>
                    {isSelected ? (
                      <span className="mt-1 block text-xs font-semibold text-link">
                        {t("selectedForReply")}
                      </span>
                    ) : null}
                  </button>
                ) : (
                  <p className="rounded-md bg-surface p-2.5 text-sm wrap-anywhere text-text">
                    {question.text}
                  </p>
                )}
                {question.replyText ? (
                  <div className="ml-4 rounded-md border border-border bg-accent-surface px-3 py-2 text-sm wrap-anywhere text-text">
                    <p className="text-xs font-semibold text-link">
                      {t("replyPrefix")}
                    </p>
                    <p className="mt-0.5 whitespace-pre-line">
                      {question.replyText}
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {hasPrevious || hasNext ? (
        <div className="flex flex-wrap items-center gap-2">
          {hasPrevious ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => setCursors((current) => current.slice(0, -1))}
            >
              {t("previousPage")}
            </Button>
          ) : null}
          {hasNext && page?.continueCursor ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() =>
                setCursors((current) => [...current, page.continueCursor!])
              }
            >
              {t("nextPage")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <p role="status" className="text-xs text-muted">
        {replyStatus}
      </p>

      {canCompose && activeQuestion ? (
        <form
          onSubmit={(event) => void handleSendReply(event)}
          className="space-y-3 border-t border-border pt-4"
          data-testid="line-reply-composer"
        >
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-text">
              {t("composerTitle")}
            </h3>
            <p className="text-xs text-muted" data-testid="line-replying-to">
              {t("replyingTo", { sender: activeQuestion.senderLabel })}
            </p>
          </div>
          <Notice
            tone="warning"
            title={t("replyAudienceTitle")}
            body={t("replyAudienceBody")}
            testId="line-reply-audience-warning"
          />
          <FormField id={replyFieldId} label={t("replyLabel")} required>
            {(props) => (
              <textarea
                {...props}
                rows={3}
                maxLength={1000}
                value={currentDraft}
                disabled={replyOperation.busy}
                placeholder={t("replyPlaceholder")}
                onChange={(event) => {
                  const nextText = event.target.value;
                  setDrafts((previous) => ({
                    ...previous,
                    [activeQuestion._id]: nextText,
                  }));
                  if (replyError) setReplyError(null);
                  if (replyStatus) setReplyStatus("");
                }}
                className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-text focus-visible:outline-2 focus-visible:outline-ring"
              />
            )}
          </FormField>
          <CheckboxField
            checked={confirmedAudience}
            disabled={replyOperation.busy}
            onChange={(event) => {
              setConfirmedAudience(event.target.checked);
              if (replyError) setReplyError(null);
            }}
            label={t("replyConfirmAudience")}
            data-testid="line-reply-audience-checkbox"
          />
          <ErrorNotice message={displayedReplyError} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              pending={replyOperation.busy}
              pendingLabel={t("replySending")}
              data-testid="line-reply-submit"
            >
              <Send aria-hidden="true" className="size-4" />
              {t("replySubmit")}
            </Button>
          </div>
        </form>
      ) : null}
    </Panel>
  );
}

function GroupContactsSection({
  groupId,
  canManageGroups,
}: {
  readonly groupId: string;
  readonly canManageGroups: boolean;
}) {
  const t = useTranslations("CustomerLine");
  const contactNameFieldId = useId();
  const setContact = useMutation(customerLineRefs.setContact);
  const contactOperation = useAsyncOperation({
    scope: `customer-line-contact:${groupId}`,
    describeError: () => "UNKNOWN",
    navigation: "write",
  });

  const [cursors, setCursors] = useState<string[]>([]);
  const activeCursor = cursors.at(-1);
  const contactsOutcome = useQuery(customerLineRefs.listContacts, {
    groupId,
    ...(activeCursor ? { cursor: activeCursor } : {}),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTarget, setDialogTarget] = useState<{
    readonly contactId: string;
    readonly name: string;
    readonly verified: boolean;
  }>({ contactId: "", name: "", verified: true });
  const [verifiedName, setVerifiedName] = useState("");
  const [contactError, setContactError] = useState<string | null>(null);

  const loading = contactsOutcome === undefined;
  const denied = contactsOutcome !== undefined && !contactsOutcome.ok;
  const page = contactsOutcome?.ok ? contactsOutcome.value : null;
  const contacts = page?.page ?? [];
  const hasPrevious = cursors.length > 0;
  const hasNext = Boolean(page?.continueCursor);

  function openContactDialog(contact: LineContact, nextVerified: boolean) {
    setContactError(null);
    setDialogTarget({
      contactId: contact._id,
      name: contact.name,
      verified: nextVerified,
    });
    setVerifiedName(contact.name);
    setDialogOpen(true);
  }

  async function confirmContactChange() {
    if (contactOperation.busy || !dialogTarget.contactId) return;
    const trimmedName = verifiedName.trim();
    if (dialogTarget.verified && !trimmedName) {
      setContactError(t("verifyContactNameRequired"));
      return;
    }
    setContactError(null);
    await contactOperation.run(
      async () =>
        setContact({
          groupId,
          contactId: dialogTarget.contactId,
          verified: dialogTarget.verified,
          ...(dialogTarget.verified ? { name: trimmedName } : {}),
        }),
      (outcome) => {
        const result = readLineWriteOutcome(outcome);
        if (!result.ok) {
          setContactError(t(`errors.${result.code}`));
        } else {
          contactOperation.complete(() => setDialogOpen(false));
        }
      },
    );
  }

  const displayedContactError =
    contactError ?? (contactOperation.error ? t("errors.UNKNOWN") : null);

  return (
    <Panel as="section" className="space-y-4">
      <SectionHeader
        title={t("contactsTitle")}
        description={t("contactsDescription")}
      />

      {loading ? (
        <LedgerPanelStatus state={{ kind: "LOADING" }} label={t("loading")} />
      ) : denied ? (
        <LedgerPanelStatus
          state={{
            kind: "DENIED",
            requestId: contactsOutcome.denial.requestId,
          }}
        />
      ) : contacts.length === 0 ? (
        <EmptyState
          compact
          title={t("contactsEmpty")}
          testId="line-contacts-empty"
        />
      ) : (
        <ul
          className="divide-y divide-border rounded-lg border border-border"
          data-testid="line-contacts-list"
        >
          {contacts.map((contact) => {
            const isVerified = contact.state === "verified";
            const canVerifyOrRevoke =
              canManageGroups && (isVerified || contact.state !== "left");
            return (
              <li
                key={contact._id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium wrap-anywhere text-text">
                    {contact.name}
                  </p>
                  <ContactStateBadge state={contact.state} />
                </div>
                {canVerifyOrRevoke ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => openContactDialog(contact, !isVerified)}
                    data-testid={`line-contact-action-${contact._id}`}
                  >
                    {isVerified ? (
                      <ShieldOff aria-hidden="true" className="size-4" />
                    ) : (
                      <ShieldCheck aria-hidden="true" className="size-4" />
                    )}
                    {isVerified ? t("revokeContact") : t("verifyContact")}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {hasPrevious || hasNext ? (
        <div className="flex flex-wrap items-center gap-2">
          {hasPrevious ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => setCursors((current) => current.slice(0, -1))}
            >
              {t("previousPage")}
            </Button>
          ) : null}
          {hasNext && page?.continueCursor ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() =>
                setCursors((current) => [...current, page.continueCursor!])
              }
            >
              {t("nextPage")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={
          dialogTarget.verified
            ? t("verifyContactTitle", { name: dialogTarget.name })
            : t("revokeContactTitle", { name: dialogTarget.name })
        }
        description={
          dialogTarget.verified
            ? t("verifyContactBody")
            : t("revokeContactBody")
        }
        error={displayedContactError}
        cancelLabel={t("cancel")}
        confirmLabel={
          dialogTarget.verified
            ? t("verifyContactConfirm")
            : t("revokeContactConfirm")
        }
        pendingLabel={
          dialogTarget.verified ? t("verifyingContact") : t("revokingContact")
        }
        tone={dialogTarget.verified ? "default" : "destructive"}
        pending={contactOperation.busy}
        onConfirm={() => void confirmContactChange()}
        testId="line-contact-dialog"
      >
        {dialogTarget.verified ? (
          <FormField
            id={contactNameFieldId}
            label={t("verifyContactNameLabel")}
            hint={t("verifyContactNameHint")}
            required
          >
            {(props) => (
              <Input
                {...props}
                value={verifiedName}
                maxLength={80}
                disabled={contactOperation.busy}
                onChange={(event) => {
                  setVerifiedName(event.target.value);
                  if (contactError) setContactError(null);
                }}
                data-testid="line-contact-verified-name-input"
              />
            )}
          </FormField>
        ) : null}
      </ConfirmDialog>
    </Panel>
  );
}
