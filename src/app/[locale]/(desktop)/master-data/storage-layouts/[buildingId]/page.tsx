import { getTranslations, setRequestLocale } from "next-intl/server";

import { ROUTES } from "@/lib/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { StorageBuildingEditor } from "@/features/storageLayouts/StorageLayoutScreens";

export default async function StorageBuildingPage({
  params,
}: {
  readonly params: Promise<{ locale: string; buildingId: string }>;
}) {
  const { locale, buildingId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("StorageLayouts");
  return (
    <>
      <PageHeader
        back={{ href: ROUTES.storageLayouts, label: t("back") }}
        title={t("editBuilding")}
        description={t("description")}
      />
      <StorageBuildingEditor buildingId={buildingId} />
    </>
  );
}
