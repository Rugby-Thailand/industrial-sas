import { getTranslations, setRequestLocale } from "next-intl/server";

import {
  LabelTemplateForm,
  LabelTemplatesPanel,
} from "@/features/masterData/EntityPanels";
import { MasterDataCreateLayout } from "@/features/masterData/MasterDataCreateLayout";

export default async function LabelTemplatesPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("MasterData");

  return (
    <MasterDataCreateLayout
      title={t("labelTemplatesTitle")}
      description={t("labelTemplatesDescription")}
      notice={t("maintainNotice")}
      registerTitle={t("sectionRegister")}
      createLabel={t("templateFormLegend")}
      closeLabel={t("closeForm")}
      register={<LabelTemplatesPanel />}
      form={<LabelTemplateForm />}
    />
  );
}
