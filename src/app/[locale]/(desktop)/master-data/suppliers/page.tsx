import { getTranslations, setRequestLocale } from "next-intl/server";

import {
  SupplierForm,
  SuppliersPanel,
} from "@/features/masterData/EntityPanels";
import { MasterDataCreateLayout } from "@/features/masterData/MasterDataCreateLayout";

export default async function SuppliersPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("MasterData");

  return (
    <MasterDataCreateLayout
      title={t("suppliersTitle")}
      description={t("suppliersDescription")}
      notice={t("maintainNotice")}
      registerTitle={t("sectionRegister")}
      createLabel={t("supplierFormLegend")}
      closeLabel={t("closeForm")}
      register={<SuppliersPanel />}
      form={<SupplierForm />}
    />
  );
}
