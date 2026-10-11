"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ArrowRight, Megaphone } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useHrAccess, useHrCan } from "@/components/providers/HrAccessProvider";
import { usePendingGuard } from "@/components/providers/draftGuard";
import { OutcomeGate } from "@/components/system/DataGate";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/CheckboxControl";
import { DescriptionList } from "@/components/ui/DescriptionList";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Link } from "@/i18n/navigation";
import { hrRefs } from "@/lib/convex/hrApi";
import { HR_CODES } from "@/lib/navigation";
import { formatDateTime } from "./format";
import { HrGate, HrInlineError, WriteFeedback } from "./HrShared";
import { HrActionCard } from "./HrActionCard";
import { HrToolbar } from "./HrUi";
import { useHrWrite } from "./useHrWrite";

export interface AnnouncementRow {
  readonly _id: string;
  readonly title: string;
  readonly body: string;
  readonly status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  readonly version: number;
  readonly publishedVersion?: number;
  readonly publishedAt?: number;
  readonly publishAt?: number;
  readonly scheduleError?: string;
  readonly scheduleFailedAt?: number;
  readonly pinned: boolean;
  readonly acknowledgmentRequired: boolean;
  readonly audience: {
    readonly mode: "ORGANIZATION" | "SITES";
    readonly warehouseIds: readonly string[];
  };
  readonly replacesId?: string;
}
export interface AnnouncementReceipt {
  readonly _id: string;
  readonly contentVersion: number;
  readonly readAt?: number;
  readonly acknowledgedAt?: number;
}
interface AnnouncementItem {
  readonly announcement: AnnouncementRow;
  readonly receipt: AnnouncementReceipt;
  readonly authorName: string | null;
}
export function AnnouncementPager({
  cursors,
  nextCursor,
  setCursors,
}: {
  readonly cursors: readonly string[];
  readonly nextCursor: string | null;
  readonly setCursors: (value: string[]) => void;
}) {
  const t = useTranslations("Hr.announcements");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button
        variant="outline"
        disabled={cursors.length === 0}
        onClick={() => setCursors(cursors.slice(0, -1))}
      >
        <ArrowLeft aria-hidden="true" />
        {t("previous")}
      </Button>
      <p className="text-sm text-muted">
        {t("page", { page: cursors.length + 1 })}
      </p>
      <Button
        variant="outline"
        disabled={!nextCursor}
        onClick={() => {
          if (nextCursor) setCursors([...cursors, nextCursor]);
        }}
      >
        {t("next")}
        <ArrowRight aria-hidden="true" />
      </Button>
    </div>
  );
}
export function AnnouncementState({ row }: { readonly row: AnnouncementRow }) {
  const t = useTranslations("Hr.announcements");
  return (
    <StatusBadge
      tone={row.status === "PUBLISHED" ? "success" : "muted"}
      label={t(`status.${row.status}`)}
    />
  );
}
export function AnnouncementTime({ at }: { readonly at: number | undefined }) {
  const locale = useLocale();
  const access = useHrAccess();
  return at === undefined ? null : (
    <time dateTime={new Date(at).toISOString()}>
      {formatDateTime(at, locale, access.timezone ?? "Asia/Bangkok")}
    </time>
  );
}
export function HrAnnouncementsScreen() {
  const t = useTranslations("Hr.announcements");
  const manage = useHrCan(HR_CODES.admin);
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")} showBack={false}>
        {manage ? (
          <Button asChild variant="outline">
            <Link href="/hr/announcements/manage">{t("manage")}</Link>
          </Button>
        ) : null}
      </PageHeader>
      <HrGate code={HR_CODES.self}>
        <AnnouncementsFeed />
      </HrGate>
    </>
  );
}
function AnnouncementsFeed() {
  const t = useTranslations("Hr.announcements");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const outcome = useQuery(hrRefs.announcements, {
    limit: 20,
    pinnedOnly,
    ...(cursor ? { cursor } : {}),
  });
  return (
    <div className="space-y-section">
      <HrToolbar label={t("filters")}>
        <CheckboxField
          label={t("pinnedOnly")}
          checked={pinnedOnly}
          onChange={(event) => {
            setPinnedOnly(event.target.checked);
            setCursors([]);
          }}
        />
      </HrToolbar>
      <OutcomeGate outcome={outcome}>
        {({ value }) =>
          value.ok ? (
            <AnnouncementFeedPage
              result={value}
              cursors={cursors}
              setCursors={setCursors}
            />
          ) : (
            <HrInlineError code={value.code} />
          )
        }
      </OutcomeGate>
    </div>
  );
}
function AnnouncementFeedPage({
  result,
  cursors,
  setCursors,
}: {
  readonly result: {
    readonly items: readonly AnnouncementItem[];
    readonly nextCursor: string | null;
    readonly gate: string | null;
  };
  readonly cursors: readonly string[];
  readonly setCursors: (value: string[]) => void;
}) {
  const t = useTranslations("Hr.announcements");
  return (
    <>
      {result.gate ? <Notice tone="warning" title={t("policyGate")} /> : null}
      {result.items.length ? (
        <ul className="space-y-3">
          {result.items.map(({ announcement, receipt, authorName }) => (
            <li key={announcement._id}>
              <HrActionCard
                icon={Megaphone}
                label={announcement.title}
                href={`/hr/announcements/${encodeURIComponent(announcement._id)}`}
                description={
                  <>
                    {authorName ?? t("unknownAuthor")} ·{" "}
                    <AnnouncementTime at={announcement.publishedAt} />
                  </>
                }
                value={
                  <StatusBadge
                    tone={
                      receipt.acknowledgedAt
                        ? "success"
                        : receipt.readAt
                          ? "muted"
                          : "accent"
                    }
                    label={t(
                      receipt.acknowledgedAt
                        ? "acknowledged"
                        : receipt.readAt
                          ? "read"
                          : "unread",
                    )}
                  />
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<Megaphone />}
          title={t("empty")}
          body={t("emptyHint")}
        />
      )}
      <AnnouncementPager
        cursors={cursors}
        nextCursor={result.nextCursor}
        setCursors={setCursors}
      />
    </>
  );
}
export function HrAnnouncementDetailScreen({
  announcementId,
}: {
  readonly announcementId: string;
}) {
  const t = useTranslations("Hr.announcements");
  return (
    <>
      <PageHeader title={t("detailTitle")} summary={t("detailSummary")} />
      <HrGate code={HR_CODES.self}>
        <AnnouncementDetail announcementId={announcementId} />
      </HrGate>
    </>
  );
}
function AnnouncementDetail({
  announcementId,
}: {
  readonly announcementId: string;
}) {
  const outcome = useQuery(hrRefs.announcementDetail, { announcementId });
  return (
    <OutcomeGate outcome={outcome}>
      {({ value }) =>
        value.ok ? (
          <AnnouncementDetailView key={announcementId} result={value} />
        ) : (
          <HrInlineError code={value.code} />
        )
      }
    </OutcomeGate>
  );
}
function AnnouncementDetailView({
  result,
}: {
  readonly result: AnnouncementItem;
}) {
  const t = useTranslations("Hr.announcements");
  const write = useHrWrite(`announcement-receipt:${result.announcement._id}`);
  const record = useMutation(hrRefs.recordAnnouncementReceipt);
  usePendingGuard(write.pending);
  const row = result.announcement;
  const act = (action: "READ" | "ACKNOWLEDGE") =>
    void write.submit((requestId) =>
      record({
        requestId,
        announcementId: row._id,
        contentVersion: result.receipt.contentVersion,
        action,
      }),
    );
  return (
    <Panel className="space-y-section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-xl font-semibold wrap-anywhere text-text">
          {row.title}
        </h2>
        <AnnouncementState row={row} />
      </div>
      <DescriptionList
        items={[
          {
            id: "author",
            label: t("author"),
            value: result.authorName ?? t("unknownAuthor"),
          },
          {
            id: "published",
            label: t("publishedAt"),
            value: <AnnouncementTime at={row.publishedAt} />,
          },
          {
            id: "version",
            label: t("contentVersion"),
            value: result.receipt.contentVersion,
          },
          {
            id: "read",
            label: t("read"),
            value: result.receipt.readAt ? (
              <AnnouncementTime at={result.receipt.readAt} />
            ) : (
              t("unread")
            ),
          },
          ...(row.acknowledgmentRequired
            ? [
                {
                  id: "ack",
                  label: t("acknowledged"),
                  value: result.receipt.acknowledgedAt ? (
                    <AnnouncementTime at={result.receipt.acknowledgedAt} />
                  ) : (
                    t("notAcknowledged")
                  ),
                },
              ]
            : []),
        ]}
      />
      <p className="max-w-prose wrap-anywhere whitespace-pre-wrap text-text">
        {row.body}
      </p>
      {row.acknowledgmentRequired ? (
        <Notice tone="accent" title={t("ackHint")} />
      ) : null}
      <WriteFeedback state={write.state} onRetry={() => void write.retry()} />
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          disabled={write.locked || !!result.receipt.readAt}
          onClick={() => act("READ")}
          pending={write.pending}
        >
          {t("markRead")}
        </Button>
        {row.acknowledgmentRequired && row.status === "PUBLISHED" ? (
          <Button
            disabled={write.locked || !!result.receipt.acknowledgedAt}
            onClick={() => act("ACKNOWLEDGE")}
            pending={write.pending}
          >
            {t("acknowledge")}
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}
