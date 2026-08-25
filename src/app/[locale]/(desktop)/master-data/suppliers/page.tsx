import { getTranslations, setRequestLocale } from "next-intl/server";

import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  PanelSection,
  SupplierForm,
  SuppliersPanel,
} from "@/features/masterData/EntityPanels";

export default async function SuppliersPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("MasterData");

  return (
    <>
      <PageHeader
        title={t("suppliersTitle")}
        description={t("suppliersDescription")}
      />
      <div className="mb-6">
        <Notice tone="muted" title={t("maintainNotice")} />
      </div>
      <PanelSection title={t("sectionRegister")}>
        <SuppliersPanel />
      </PanelSection>
      <PanelSection title={t("sectionAdd")}>
        <SupplierForm />
      </PanelSection>
    </>
  );
}
