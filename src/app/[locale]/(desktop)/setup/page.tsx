import { getTranslations, setRequestLocale } from "next-intl/server";

import { SetupChecklist } from "@/components/system/SetupChecklist";
import { PageHeader } from "@/components/ui/PageHeader";
import { currentAppEnvironment } from "@/lib/environment";

export default async function SetupPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Setup");
  const environment = currentAppEnvironment();
  const configured =
    environment.backendConfigured && environment.identityConfigured;

  return (
    <>
      <PageHeader
        title={t(configured ? "configuredTitle" : "title")}
        summary={t(configured ? "configuredIntro" : "intro")}
      />
      <SetupChecklist />
    </>
  );
}
