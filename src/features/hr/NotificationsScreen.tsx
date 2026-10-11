"use client";

import { useMutation, useQuery } from "convex/react";
import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { usePendingGuard } from "@/components/providers/draftGuard";
import { OutcomeGate } from "@/components/system/DataGate";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/CheckboxControl";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Link } from "@/i18n/navigation";
import { hrRefs } from "@/lib/convex/hrApi";
import { HR_CODES } from "@/lib/navigation";
import { AnnouncementPager, AnnouncementTime } from "./AnnouncementsScreen";
import { HrGate, HrInlineError, WriteFeedback } from "./HrShared";
import { HrToolbar } from "./HrUi";
import { useHrWrite } from "./useHrWrite";

interface NotificationRow {
  readonly _id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly unread: boolean;
  readonly event: string;
  readonly announcementId?: string;
  readonly resourceId?: string;
}
export function notificationHref(row: NotificationRow): string | undefined {
  if (row.event === "ANNOUNCEMENT_PUBLISHED" && row.announcementId)
    return `/hr/announcements/${encodeURIComponent(row.announcementId)}`;
  if (row.event === "LEAVE_DECIDED" && row.resourceId)
    return `/hr/leave/${encodeURIComponent(row.resourceId)}`;
  if (row.event === "CORRECTION_DECIDED" && row.resourceId)
    return `/hr/requests/${encodeURIComponent(row.resourceId)}`;
  if (row.event === "PAYSLIP_PUBLISHED" && row.resourceId)
    return `/hr/payslips/${encodeURIComponent(row.resourceId)}`;
  return undefined;
}
export function HrNotificationsScreen() {
  const t = useTranslations("Hr.notifications");
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")} showBack={false} />
      <HrGate code={HR_CODES.self}>
        <NotificationsContent />
      </HrGate>
    </>
  );
}
function NotificationsContent() {
  const t = useTranslations("Hr.notifications");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const outcome = useQuery(hrRefs.notifications, {
    limit: 20,
    unreadOnly,
    ...(cursor ? { cursor } : {}),
  });
  return (
    <div className="space-y-section">
      <HrToolbar label={t("filters")}>
        <CheckboxField
          label={t("unreadOnly")}
          checked={unreadOnly}
          onChange={(event) => {
            setUnreadOnly(event.target.checked);
            setCursors([]);
          }}
        />
      </HrToolbar>
      <OutcomeGate outcome={outcome}>
        {({ value }) =>
          value.ok ? (
            <NotificationsPage
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
function NotificationsPage({
  result,
  cursors,
  setCursors,
}: {
  readonly result: {
    readonly items: readonly NotificationRow[];
    readonly nextCursor: string | null;
    readonly unreadCount: number;
    readonly unreadCountComplete: boolean;
  };
  readonly cursors: readonly string[];
  readonly setCursors: (value: string[]) => void;
}) {
  const t = useTranslations("Hr.notifications");
  const all = useMutation(hrRefs.markAllNotifications);
  const write = useHrWrite<{ written: true; moreUnread: boolean }>(
    "notifications-mark-all",
  );
  usePendingGuard(write.pending);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text">
          {t(
            result.unreadCountComplete
              ? "unreadCount"
              : "unreadCountIncomplete",
            {
              count: result.unreadCount,
            },
          )}
        </p>
        <Button
          variant="outline"
          disabled={write.locked || result.unreadCount === 0}
          pending={write.pending}
          onClick={() => void write.submit((requestId) => all({ requestId }))}
        >
          {t("markAll")}
        </Button>
      </div>
      <WriteFeedback state={write.state} onRetry={() => void write.retry()} />
      {write.state.kind === "SAVED" && write.state.value.moreUnread ? (
        <Notice
          tone="warning"
          title={t("moreUnread")}
          body={t("moreUnreadHint")}
        />
      ) : null}
      {result.items.length ? (
        <ul className="space-y-3">
          {result.items.map((row) => (
            <li key={row._id}>
              <NotificationItem row={row} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Bell />} title={t("empty")} body={t("emptyHint")} />
      )}
      <AnnouncementPager
        cursors={cursors}
        nextCursor={result.nextCursor}
        setCursors={setCursors}
      />
    </>
  );
}
function NotificationItem({ row }: { readonly row: NotificationRow }) {
  const t = useTranslations("Hr.notifications");
  const mark = useMutation(hrRefs.markNotification);
  const write = useHrWrite(`notification-read:${row._id}`);
  usePendingGuard(write.pending);
  const href = notificationHref(row);
  return (
    <Panel className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold wrap-anywhere text-text">
            {row.event !== "ANNOUNCEMENT_PUBLISHED" &&
            t.has(`event.${row.event}`)
              ? t(`event.${row.event}`)
              : row.title}
          </h2>
          <p className="text-xs text-muted">
            <AnnouncementTime at={row.createdAt} />
          </p>
        </div>
        <StatusBadge
          tone={row.unread ? "accent" : "muted"}
          label={t(row.unread ? "unread" : "read")}
        />
      </div>
      <div className="flex flex-wrap gap-3">
        {href ? (
          <Button asChild variant="outline">
            <Link href={href}>{t("open")}</Link>
          </Button>
        ) : null}
        <Button
          variant="outline"
          disabled={!row.unread || write.locked}
          pending={write.pending}
          onClick={() =>
            void write.submit((requestId) =>
              mark({ requestId, notificationId: row._id }),
            )
          }
        >
          {t("markRead")}
        </Button>
      </div>
      <WriteFeedback state={write.state} onRetry={() => void write.retry()} />
    </Panel>
  );
}
