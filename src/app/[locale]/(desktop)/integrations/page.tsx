import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { IntegrationHealthWorkbench } from "@/features/integrations/IntegrationHealthWorkbench";

export default async function IntegrationsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Integrations");
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <IntegrationHealthWorkbench />
    </>
  );
}
