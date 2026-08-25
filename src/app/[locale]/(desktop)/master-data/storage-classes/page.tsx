import { getTranslations, setRequestLocale } from "next-intl/server";

import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  PanelSection,
  StorageClassForm,
  StorageClassesPanel,
} from "@/features/masterData/EntityPanels";

export default async function StorageClassesPage({
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
        title={t("storageClassesTitle")}
        description={t("storageClassesDescription")}
      />
      <div className="mb-6">
        <Notice tone="muted" title={t("maintainNotice")} />
      </div>
      <PanelSection title={t("sectionRegister")}>
        <StorageClassesPanel />
      </PanelSection>
      <PanelSection title={t("sectionAdd")}>
        <StorageClassForm />
      </PanelSection>
    </>
  );
}
