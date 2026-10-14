"use client";

import { useHrQuery } from "@/hooks/useHrQuery";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { usePageSearchContext } from "@/components/shell/search/pageContext";
import { hrRefs } from "@/lib/convex/hrApi";
import { useDeepLinkFocus, useQueryParams } from "@/lib/deepLink";
import {
  FOCUS_TARGET_IDS,
  HR_CODES,
  ROUTES,
  readDayFocus,
} from "@/lib/navigation";

import { CorrectionForm, type CorrectionRetention } from "./CorrectionForm";
import { DayDetailView, type DayDetail } from "./DayDetailView";
import { formatBusinessDate } from "./format";
import { HrGate, HrInlineError, HrQueryState } from "./HrShared";

export function HrDayScreen({
  businessDate,
}: {
  readonly businessDate: string;
}) {
  const t = useTranslations("Hr.day");
  const nav = useTranslations("Navigation");
  const locale = useLocale();
  return (
    <>
      <PageHeader
        title={formatBusinessDate(businessDate, locale, { weekday: true })}
        summary={t("summary")}
        breadcrumbs={[{ href: ROUTES.hrTime, label: nav("hrTime") }]}
      />
      <HrGate code={HR_CODES.self}>
        <DayContent businessDate={businessDate} />
      </HrGate>
    </>
  );
}

function DayContent({ businessDate }: { readonly businessDate: string }) {
  const params = useQueryParams();
  const focus = readDayFocus(params);
  const outcome = useHrQuery(hrRefs.selfDayDetail, { businessDate });
  usePageSearchContext(
    outcome?.ok === true && outcome.value.ok
      ? { page: "hr.day", date: businessDate }
      : null,
  );
  // The correction area (form or the reason it is unavailable) after load.
  useDeepLinkFocus(
    focus === null ? null : FOCUS_TARGET_IDS.correction,
    outcome?.ok === true,
    `${businessDate}?${params.toString()}`,
  );
  return (
    <HrQueryState outcome={outcome}>
      {() => {
        if (!outcome?.ok) return null;
        const result = outcome.value;
        if (!result.ok) return <HrInlineError code={result.code} />;
        const { detail, timezone, today } = result;
        return (
          <DayDetailView detail={detail} timezone={timezone}>
            <div id={FOCUS_TARGET_IDS.correction} className="rounded-xl">
              <CorrectionArea
                key={`${detail.employeeId}:${businessDate}`}
                detail={detail}
                timezone={timezone}
                today={today}
                focused={focus !== null}
              />
            </div>
          </DayDetailView>
        );
      }}
    </HrQueryState>
  );
}

/** Live eligibility explains itself without replacing a held draft or receipt. */
function CorrectionArea({
  detail,
  timezone,
  today,
  focused,
}: {
  readonly detail: DayDetail;
  readonly timezone: string;
  readonly today: string;
  readonly focused: boolean;
}) {
  const t = useTranslations("Hr.day");
  const returned =
    detail.corrections[0]?.status === "RETURNED"
      ? detail.corrections[0]
      : undefined;
  const available =
    !detail.locked &&
    detail.pendingCorrectionId === undefined &&
    detail.businessDate <= today &&
    detail.status !== "UPCOMING";
  const liveTarget = returned ? `${returned.id}:${returned.version}` : "new";
  const [retention, setRetention] = useState<{
    mode: CorrectionRetention;
    target: string;
  }>({
    mode: "none",
    target: liveTarget,
  });
  const reportRetention = useCallback((mode: CorrectionRetention) => {
    setRetention((current) =>
      current.mode === mode ? current : { ...current, mode },
    );
  }, []);
  // Dirty/pending owners keep their mounted command. A saved receipt survives
  // the pending subscription; a later Return starts a new resubmission.
  if (
    (retention.mode === "none" ||
      (retention.mode === "receipt" && available)) &&
    retention.target !== liveTarget
  ) {
    setRetention({ ...retention, target: liveTarget });
  }
  const retained = retention.mode !== "none";
  return (
    <>
      {detail.locked ? (
        <Notice tone="warning" title={t("lockedHint")} />
      ) : detail.pendingCorrectionId !== undefined ? (
        <Notice tone="pending" title={t("pendingHint")} />
      ) : !available && (focused || retained) ? (
        <Notice tone="neutral" title={t("notCorrectable")} />
      ) : null}
      {available || retained ? (
        <CorrectionForm
          key={retention.target}
          detail={detail}
          timezone={timezone}
          returnedId={returned?.id}
          available={available}
          onRetained={reportRetention}
        />
      ) : null}
    </>
  );
}
