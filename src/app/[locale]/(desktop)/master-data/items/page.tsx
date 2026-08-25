import { getTranslations, setRequestLocale } from "next-intl/server";

import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { ItemForm } from "@/features/masterData/CoreForms";
import { PanelSection } from "@/features/masterData/EntityPanels";
import { ItemsPanel } from "@/features/masterData/ItemsPanel";

export default async function ItemsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("MasterData");

  return (
    <>
      <PageHeader title={t("itemsTitle")} description={t("itemsDescription")} />
      <div className="mb-4">
        <Notice tone="muted" title={t("maintainNotice")} />
      </div>
      <PanelSection title={t("sectionRegister")}>
        <ItemsPanel />
      </PanelSection>
      <PanelSection title={t("sectionAdd")}>
        <ItemForm />
      </PanelSection>
    </>
  );
}
