"use client";

import { useQuery } from "convex/react";
import { ChevronRight, MessageSquare, Settings2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { CustomerGate } from "@/features/customers/customerAccess";
import { Link } from "@/i18n/navigation";
import { customerPath } from "@/lib/navigation";
import {
  CUSTOMER_LINE_PATH,
  CUSTOMER_LINE_SETTINGS_PATH,
  customerLineGroupPath,
  customerLineRefs,
  type LineGroup,
  type LinePrimaryConnectionSummary,
  type LineViewer,
} from "./lineApi";
import {
  ConnectionStateBadge,
  GroupStateBadge,
  InviteInstructions,
  ProviderDepartureBadge,
  useLineViewer,
} from "./lineShared";

export function CustomerLineInbox({
  customerId,
}: {
  readonly customerId?: string;
}) {
  const t = useTranslations("CustomerLine");
  const title = customerId ? t("inboxFilteredTitle") : t("inboxTitle");
  const summary = customerId ? t("inboxFilteredSummary") : t("inboxSummary");

  return (
    <CustomerGate
      loadingLabel={t("loading")}
      frame={
        <PageHeader
          title={title}
          summary={summary}
          backFallbackHref="/master-data/customers"
        />
      }
    >
      <CustomerLineInboxBody
        {...(customerId === undefined ? {} : { customerId })}
      />
    </CustomerGate>
  );
}

function CustomerLineInboxBody({
  customerId,
}: {
  readonly customerId?: string;
}) {
  const t = useTranslations("CustomerLine");
  const { loading, deniedRequestId, viewer } = useLineViewer();
  const title = customerId ? t("inboxFilteredTitle") : t("inboxTitle");
  const summary = customerId ? t("inboxFilteredSummary") : t("inboxSummary");

  if (loading) {
    return (
      <>
        <PageHeader
          title={title}
          summary={summary}
          backFallbackHref="/master-data/customers"
        />
        <LedgerPanelStatus state={{ kind: "LOADING" }} label={t("loading")} />
      </>
    );
  }

  if (deniedRequestId !== null) {
    return (
      <>
        <PageHeader
          title={title}
          summary={summary}
          backFallbackHref="/master-data/customers"
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
          title={title}
          summary={summary}
          backFallbackHref="/master-data/customers"
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

  return (
    <CustomerLineInboxContent
      viewer={viewer}
      {...(customerId === undefined ? {} : { customerId })}
    />
  );
}

function PrimaryConnectionBanner({
  connection,
  canManageConnection,
}: {
  readonly connection: LinePrimaryConnectionSummary | null | undefined;
  readonly canManageConnection: boolean;
}) {
  const t = useTranslations("CustomerLine");
  if (connection === undefined) return null;

  const settingsAction = canManageConnection ? (
    <Button asChild size="sm" variant="outline">
      <Link href={CUSTOMER_LINE_SETTINGS_PATH}>{t("openSettings")}</Link>
    </Button>
  ) : undefined;

  if (connection === null) {
    return (
      <Notice
        tone="warning"
        title={t("oaMissingTitle")}
        body={t("oaMissingBody")}
        testId="line-oa-missing-notice"
        {...(settingsAction ? { action: settingsAction } : {})}
      />
    );
  }

  if (connection.state === "disconnected") {
    return (
      <Notice
        tone="warning"
        title={t("oaDisconnectedTitle")}
        body={t("oaDisconnectedBody")}
        testId="line-oa-disconnected-notice"
        {...(settingsAction ? { action: settingsAction } : {})}
      />
    );
  }

  if (connection.state === "setup") {
    return (
      <Notice
        tone="warning"
        title={t("oaSetupTitle")}
        body={t("oaSetupBody")}
        testId="line-oa-setup-notice"
        {...(settingsAction ? { action: settingsAction } : {})}
      />
    );
  }

  return (
    <Panel
      appearance="surface"
      padding="compact"
      className="flex flex-wrap items-center justify-between gap-2"
      data-testid="line-primary-oa-summary"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-text">{connection.name}</span>
          <StatusBadge tone="accent" label={t("primaryAccountBadge")} />
          <ConnectionStateBadge state={connection.state} />
        </div>
        <p className="mt-0.5 font-mono text-xs text-muted">
          {connection.basicId}
        </p>
      </div>
    </Panel>
  );
}

function CustomerLineInboxContent({
  viewer,
  customerId,
}: {
  readonly viewer: LineViewer;
  readonly customerId?: string;
}) {
  const t = useTranslations("CustomerLine");
  const [cursors, setCursors] = useState<string[]>([]);
  const activeCursor = cursors.at(-1);

  const connectionOutcome = useQuery(
    customerLineRefs.getPrimaryConnectionSummary,
    {},
  );
  const groupsOutcome = useQuery(customerLineRefs.listGroups, {
    ...(customerId ? { customerId } : {}),
    ...(activeCursor ? { cursor: activeCursor } : {}),
  });

  const connection = connectionOutcome?.ok
    ? connectionOutcome.value
    : undefined;
  const loadingGroups = groupsOutcome === undefined;
  const groupsDenied = groupsOutcome !== undefined && !groupsOutcome.ok;
  const groupsPage = groupsOutcome?.ok ? groupsOutcome.value : null;
  const groups = groupsPage?.page ?? [];
  const hasPrevious = cursors.length > 0;
  const hasNext = Boolean(groupsPage?.continueCursor);

  const title = customerId ? t("inboxFilteredTitle") : t("inboxTitle");
  const summary = customerId ? t("inboxFilteredSummary") : t("inboxSummary");

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        summary={summary}
        backFallbackHref="/master-data/customers"
      >
        {customerId ? (
          <>
            <Button asChild variant="outline">
              <Link
                href={CUSTOMER_LINE_PATH}
                data-testid="line-view-all-groups"
              >
                <MessageSquare aria-hidden="true" className="size-4" />
                {t("viewAllGroups")}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={customerPath(customerId)}>{t("viewCustomer")}</Link>
            </Button>
          </>
        ) : null}
        {viewer.canManageConnection ? (
          <Button asChild variant="outline">
            <Link
              href={CUSTOMER_LINE_SETTINGS_PATH}
              data-testid="line-open-settings"
            >
              <Settings2 aria-hidden="true" className="size-4" />
              {t("openSettings")}
            </Link>
          </Button>
        ) : null}
      </PageHeader>

      <PrimaryConnectionBanner
        connection={connection}
        canManageConnection={viewer.canManageConnection}
      />

      {viewer.canManageGroups &&
      connection?.state === "active" &&
      connection.basicId ? (
        <InviteInstructions
          basicId={connection.basicId}
          showExpanded={Boolean(customerId)}
        />
      ) : null}

      {customerId &&
      viewer.canManageGroups &&
      connection?.state === "active" ? (
        <PendingJoins key={customerId} customerId={customerId} />
      ) : null}

      <Notice
        tone="warning"
        title={t("audienceBannerTitle")}
        body={t("audienceBannerBody")}
        testId="line-audience-notice"
      />

      {customerId ? (
        <h2 className="text-base font-semibold text-text">
          {t("customerGroupsTitle")}
        </h2>
      ) : null}

      {loadingGroups ? (
        <LedgerPanelStatus state={{ kind: "LOADING" }} label={t("loading")} />
      ) : groupsDenied ? (
        <LedgerPanelStatus
          state={{
            kind: "DENIED",
            requestId: groupsOutcome.denial.requestId,
          }}
        />
      ) : groups.length === 0 ? (
        <EmptyState
          title={customerId ? t("filteredEmptyTitle") : t("emptyTitle")}
          body={customerId ? t("filteredEmptyBody") : t("emptyBody")}
          testId="line-groups-empty"
        />
      ) : (
        <GroupRows groups={groups} />
      )}

      {hasPrevious || hasNext ? (
        <div className="flex flex-wrap items-center gap-2">
          {hasPrevious ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loadingGroups}
              onClick={() => setCursors((current) => current.slice(0, -1))}
              data-testid="line-groups-previous"
            >
              {t("previousPage")}
            </Button>
          ) : null}
          {hasNext && groupsPage?.continueCursor ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loadingGroups}
              onClick={() =>
                setCursors((current) => [
                  ...current,
                  groupsPage.continueCursor!,
                ])
              }
              data-testid="line-groups-next"
            >
              {t("nextPage")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PendingJoins({ customerId }: { readonly customerId: string }) {
  const t = useTranslations("CustomerLine");
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const outcome = useQuery(
    customerLineRefs.listPendingGroups,
    cursor ? { cursor } : {},
  );
  const page = outcome?.ok ? outcome.value : null;
  const next = page?.continueCursor;

  return (
    <section
      className="space-y-2.5"
      aria-label={t("pendingJoinsTitle")}
      data-testid="line-pending-joins"
    >
      <h2 className="text-base font-semibold text-text">
        {t("pendingJoinsTitle")}
      </h2>
      {outcome === undefined ? (
        <LedgerPanelStatus state={{ kind: "LOADING" }} label={t("loading")} />
      ) : !outcome.ok ? (
        <LedgerPanelStatus
          state={{ kind: "DENIED", requestId: outcome.denial.requestId }}
        />
      ) : page?.page.length ? (
        <>
          <p className="text-sm text-muted">{t("pendingJoinsHint")}</p>
          <GroupRows groups={page.page} customerId={customerId} />
        </>
      ) : (
        <p className="text-sm text-muted">{t("pendingJoinsEmpty")}</p>
      )}
      {cursors.length > 0 || next ? (
        <div className="flex flex-wrap gap-2">
          {cursors.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={!outcome}
              onClick={() => setCursors((current) => current.slice(0, -1))}
            >
              {t("previousPage")}
            </Button>
          ) : null}
          {next ? (
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setCursors((current) => [...current, next])}
            >
              {t("nextPage")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function GroupRows({
  groups,
  customerId,
}: {
  readonly groups: readonly LineGroup[];
  readonly customerId?: string;
}) {
  const t = useTranslations("CustomerLine");
  const format = useFormatter();
  return (
    <ul
      aria-label={t("groupListLabel")}
      data-testid={customerId ? "line-pending-group-list" : "line-groups-list"}
      className="divide-y divide-border rounded-lg border border-border bg-surface"
    >
      {groups.map((group) => (
        <li key={group._id}>
          <Link
            href={customerLineGroupPath(group._id, customerId)}
            data-testid={`line-group-link-${group._id}`}
            className="flex min-h-touch items-center gap-3 px-4 py-3 hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-link"
          >
            <span className="min-w-0 flex-1 space-y-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold wrap-anywhere text-text">
                  {group.name}
                </span>
                <GroupStateBadge
                  state={group.state}
                  ignored={
                    group.state === "disconnected" &&
                    !group.customerId &&
                    !group.providerDeparture
                  }
                />
                {group.providerDeparture ? (
                  <ProviderDepartureBadge departure={group.providerDeparture} />
                ) : null}
              </span>
              <span className="block text-xs wrap-anywhere text-muted">
                {customerId
                  ? t("reviewJoin")
                  : (group.customerName ?? t("unlinkedCustomer"))}
                {" · "}
                <span className="tabular-nums">
                  {t(group.state === "pending" ? "joinedAt" : "lastActivity", {
                    time: format.dateTime(group.lastActivityAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  })}
                </span>
              </span>
            </span>
            <ChevronRight
              aria-hidden="true"
              className="size-4 shrink-0 text-muted"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
