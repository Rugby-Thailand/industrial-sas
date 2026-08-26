import { getTranslations, setRequestLocale } from "next-intl/server";

import {
  StorageClassForm,
  StorageClassesPanel,
} from "@/features/masterData/EntityPanels";
import { MasterDataCreateLayout } from "@/features/masterData/MasterDataCreateLayout";

export default async function StorageClassesPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("MasterData");

  return (
    <MasterDataCreateLayout
      title={t("storageClassesTitle")}
      description={t("storageClassesDescription")}
      notice={t("maintainNotice")}
      registerTitle={t("sectionRegister")}
      createLabel={t("storageClassFormLegend")}
      closeLabel={t("closeForm")}
      register={<StorageClassesPanel />}
      form={<StorageClassForm />}
    />
  );
}
