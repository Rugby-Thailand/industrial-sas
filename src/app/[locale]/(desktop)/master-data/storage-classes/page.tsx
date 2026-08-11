import { getTranslations, setRequestLocale } from "next-intl/server";

import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  PanelSection,
  StorageClassForm,
  StorageClassesPanel,
} from "@/features/masterData/EntityPanels";

/**
 * Storage classes.
 *
 * Organization-scoped rather than warehouse-scoped, and that is the decision
 * worth stating: "flammable" means the same thing at every site (D-13). A class
 * defined per warehouse would let two sites disagree about what a rule is while
 * both calling it by the same name.
 */
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
