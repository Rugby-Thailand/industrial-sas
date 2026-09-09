import { getTranslations, setRequestLocale } from "next-intl/server";

import { storageBuildingPath } from "@/lib/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { StorageBuildingReview } from "@/features/storageLayouts/StorageLayoutScreens";

export default async function StorageReviewPage({
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
        back={{
          href: storageBuildingPath(buildingId),
          label: t("fullLayoutEdit"),
        }}
        title={t("reviewTitle")}
        description={t("reviewDescription")}
      />
      <StorageBuildingReview buildingId={buildingId} />
    </>
  );
}
