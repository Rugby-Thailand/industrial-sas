import { getTranslations, setRequestLocale } from "next-intl/server";

import { ROUTES } from "@/lib/navigation";
import { PageBackLink } from "@/components/ui/PageBackLink";
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
      <div className="mb-4">
        <PageBackLink href={ROUTES.storageLayouts} label={t("back")} />
      </div>
      <StorageBuildingEditor buildingId={buildingId} />
    </>
  );
}
