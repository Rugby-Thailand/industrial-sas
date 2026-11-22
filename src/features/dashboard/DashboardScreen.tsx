"use client";

import { useTranslations } from "next-intl";

import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { SetupChecklist } from "@/components/system/SetupChecklist";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";

import { DashboardLiveContent } from "./DashboardLiveContent";

export function DashboardScreen() {
  const t = useTranslations("Home");
  const { backendConfigured, identityConfigured } = useAppEnvironment();

  return (
    <>
      <PageHeader title={t("title")} backFallbackHref={null} />
      {backendConfigured && identityConfigured ? (
        <DashboardLiveContent />
      ) : (
        <>
          <Notice title={t("setupRequired")} />
          <SetupChecklist />
        </>
      )}
    </>
  );
}
