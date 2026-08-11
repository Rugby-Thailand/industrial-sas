import { getTranslations, setRequestLocale } from "next-intl/server";

import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  LabelTemplateForm,
  LabelTemplatesPanel,
  PanelSection,
} from "@/features/masterData/EntityPanels";

/**
 * Label templates.
 *
 * Two honesty constraints govern this screen, and both are stated on the page
 * rather than in a comment nobody in a warehouse will read:
 *
 * - **Nothing is printed.** There is no printer transport (`INT-04`) and no
 *   physical print verification (`RG-004`). The body is stored text; it is not
 *   parsed, rendered, previewed, or sent anywhere.
 * - **Publishing needs a second person.** The drafter is recorded and the
 *   publish policy refuses them (`INV-0006-05`). The control is still offered to
 *   them, because a denial explains the rule and a hidden button does not.
 */
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
