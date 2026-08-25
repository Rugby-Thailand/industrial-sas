import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { DeviceRegistryPanel } from "@/features/platform/DeviceRegistryPanel";

export default async function DevicesPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("DeviceRegistry");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <DeviceRegistryPanel />
    </>
  );
}
