"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { hrRefs } from "@/lib/convex/hrApi";
import { HR_CODES } from "@/lib/navigation";
import { guardedNavigate } from "@/lib/navigationGuard";
import { HrGate, HrInlineError, HrQueryState, SectionTitle } from "./HrShared";
import {
  LeaveCancel,
  LeaveForm,
  LeaveRequestCard,
  type LeaveRequest,
} from "./LeaveScreen";

export function HrLeaveDetailScreen({
  requestId,
}: {
  readonly requestId: string;
}) {
  const t = useTranslations("Hr.leave");
  const identity = useHrAccess().identityKey;
  return (
    <>
      <PageHeader
        title={t("requests")}
        breadcrumbs={[{ label: t("title"), href: "/hr/leave" }]}
      />
      <HrGate code={HR_CODES.self}>
        <LeaveDetail key={`${identity}:${requestId}`} requestId={requestId} />
      </HrGate>
    </>
  );
}
function LeaveDetail({ requestId }: { readonly requestId: string }) {
  const t = useTranslations("Hr.leave");
  const outcome = useQuery(hrRefs.leaveSelfDetail, {
    leaveRequestId: requestId,
  });
  return (
    <HrQueryState outcome={outcome}>
      {() =>
        outcome?.ok ? (
          outcome.value.ok ? (
            <div className="space-y-6">
              <LeaveRequestCard
                request={outcome.value.item}
                actions={
                  <LeaveCancel
                    request={outcome.value.item}
                    today={outcome.value.today}
                  />
                }
              />
              {outcome.value.item.status === "RETURNED" ? (
                <ReturnedEdit
                  key={`${outcome.value.item._id}:${outcome.value.item.version}`}
                  request={outcome.value.item}
                />
              ) : null}
              {outcome.value.revisions.length ? (
                <Panel className="space-y-4">
                  <SectionTitle>{t("revisions")}</SectionTitle>
                  {outcome.value.revisions.map((revision) => (
                    <details key={revision.version}>
                      <summary className="min-h-touch cursor-pointer text-sm font-semibold text-text">
                        {t("revision", { version: revision.version })}
                      </summary>
                      <LeaveRequestCard
                        request={{
                          ...revision.snapshot,
                          _id: requestId,
                        }}
                      />
                      <ul className="flex flex-wrap gap-3 text-sm text-muted">
                        {revision.snapshot.dates.map((date) => (
                          <li key={date}>
                            <time dateTime={date}>{date}</time>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </Panel>
              ) : null}
            </div>
          ) : (
            <HrInlineError code={outcome.value.code} />
          )
        ) : null
      }
    </HrQueryState>
  );
}
function ReturnedEdit({ request }: { readonly request: LeaveRequest }) {
  const t = useTranslations("Hr.leave");
  const [editing, setEditing] = useState(false);
  return (
    <div className="space-y-4">
      <Button
        variant="outline"
        onClick={() => guardedNavigate(() => setEditing(!editing))}
      >
        {t(editing ? "discardEdit" : "editReturned")}
      </Button>
      {editing ? (
        <LeaveForm
          employeeId={request.employeeId}
          retained={request}
          types={[
            "ANNUAL",
            "SICK",
            "PERSONAL",
            "MATERNITY",
            "SPOUSE",
            "NEWBORN_CARE",
            "STERILIZATION",
            "MILITARY",
            "TRAINING",
          ]}
        />
      ) : null}
    </div>
  );
}
