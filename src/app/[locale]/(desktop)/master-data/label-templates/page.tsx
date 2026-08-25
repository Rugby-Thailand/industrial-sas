import { getTranslations, setRequestLocale } from "next-intl/server";

import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  LabelTemplateForm,
  LabelTemplatesPanel,
  PanelSection,
} from "@/features/masterData/EntityPanels";

export default async function LabelTemplatesPage({
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
        title={t("labelTemplatesTitle")}
        description={t("labelTemplatesDescription")}
      />
      <div className="mb-6">
        <Notice tone="muted" title={t("maintainNotice")} />
      </div>
      <PanelSection title={t("sectionRegister")}>
        <LabelTemplatesPanel />
      </PanelSection>
      <PanelSection title={t("sectionAdd")}>
        <LabelTemplateForm />
      </PanelSection>
    </>
  );
}
