"use client";

import { useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";

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

import { CorrectionForm } from "./CorrectionForm";
import { DayDetailView } from "./DayDetailView";
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
  const t = useTranslations("Hr.day");
  const params = useQueryParams();
  const focus = readDayFocus(params);
  const outcome = useQuery(hrRefs.selfDayDetail, { businessDate });
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
        const returned = detail.corrections.find(
          (correction) => correction.status === "RETURNED",
        );
        const canRequest =
          !detail.locked &&
          detail.pendingCorrectionId === undefined &&
          businessDate <= today &&
          detail.status !== "UPCOMING";
        return (
          <DayDetailView detail={detail} timezone={timezone}>
            <div id={FOCUS_TARGET_IDS.correction} className="rounded-xl">
              {detail.locked ? (
                <Notice tone="warning" title={t("lockedHint")} />
              ) : detail.pendingCorrectionId !== undefined ? (
                <Notice tone="pending" title={t("pendingHint")} />
              ) : canRequest ? (
                <CorrectionForm
                  key={`${businessDate}:${detail.revision}:${returned?.id ?? ""}`}
                  detail={detail}
                  timezone={timezone}
                  returnedId={
                    returned !== undefined &&
                    detail.corrections[0]?.id === returned.id
                      ? returned.id
                      : undefined
                  }
                />
              ) : focus === null ? null : (
                // Opened for a correction that this day cannot take yet.
                <Notice tone="neutral" title={t("notCorrectable")} />
              )}
            </div>
          </DayDetailView>
        );
      }}
    </HrQueryState>
  );
}
