import { getTranslations, setRequestLocale } from "next-intl/server";

import { PrototypeSwitcher } from "@/components/prototype/PrototypeSwitcher";

import {
  ActionQueueDashboard,
  DASHBOARD_STYLE_IDS,
  ExecutiveBriefDashboard,
  resolveDashboardStyle,
  SpatialCommandDashboard,
} from "./DashboardStyleVariants";

export default async function DashboardPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams?: Promise<{
    readonly variant?: string | readonly string[] | undefined;
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("OwnerDashboard");
  const variant = resolveDashboardStyle((await searchParams)?.variant);

  const renderDashboard = {
    a: ExecutiveBriefDashboard,
    b: ActionQueueDashboard,
    c: SpatialCommandDashboard,
  }[variant];
  const dashboard = await renderDashboard();

  return (
    <>
      {dashboard}
      {process.env.NODE_ENV === "production" ? null : (
        <PrototypeSwitcher
          variants={DASHBOARD_STYLE_IDS.map((id) => ({
            id,
            label: t(`prototype.style${id.toUpperCase()}`),
          }))}
          current={variant}
          label={t("prototype.switcherLabel")}
          previousLabel={t("prototype.previous")}
          nextLabel={t("prototype.next")}
        />
      )}
    </>
  );
}
