import { getTranslations, setRequestLocale } from "next-intl/server";

import { ItemForm } from "@/features/masterData/CoreForms";
import { ItemsPanel } from "@/features/masterData/ItemsPanel";
import { MasterDataCreateLayout } from "@/features/masterData/MasterDataCreateLayout";

export default async function ItemsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("MasterData");

  return (
    <MasterDataCreateLayout
      title={t("itemsTitle")}
      description={t("itemsDescription")}
      notice={t("maintainNotice")}
      registerTitle={t("sectionRegister")}
      createLabel={t("itemFormLegend")}
      closeLabel={t("closeForm")}
      register={<ItemsPanel />}
      form={<ItemForm />}
    />
  );
}
