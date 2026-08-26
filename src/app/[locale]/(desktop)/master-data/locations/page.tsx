import { getTranslations, setRequestLocale } from "next-intl/server";

import { LocationForm } from "@/features/masterData/CoreForms";
import { LocationsPanel } from "@/features/masterData/LocationsPanel";
import { MasterDataCreateLayout } from "@/features/masterData/MasterDataCreateLayout";

export default async function LocationsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("MasterData");

  return (
    <MasterDataCreateLayout
      title={t("locationsTitle")}
      description={t("locationsDescription")}
      notice={t("maintainNotice")}
      registerTitle={t("sectionRegister")}
      createLabel={t("locationFormLegend")}
      closeLabel={t("closeForm")}
      register={<LocationsPanel />}
      form={<LocationForm />}
    />
  );
}
