import { getTranslations, setRequestLocale } from "next-intl/server";

import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { LocationForm } from "@/features/masterData/CoreForms";
import { PanelSection } from "@/features/masterData/EntityPanels";
import { LocationsPanel } from "@/features/masterData/LocationsPanel";

/** One warehouse's locations, backed by `masterData/catalogue:listLocations`. */
export default async function LocationsPage({
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
        title={t("locationsTitle")}
        description={t("locationsDescription")}
      />
      <div className="mb-4">
        <Notice tone="muted" title={t("maintainNotice")} />
      </div>
      <PanelSection title={t("sectionRegister")}>
        <LocationsPanel />
      </PanelSection>
      <PanelSection title={t("sectionAdd")}>
        <LocationForm />
      </PanelSection>
    </>
  );
}
