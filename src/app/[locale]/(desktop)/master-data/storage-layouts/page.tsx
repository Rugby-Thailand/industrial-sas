import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { StorageBuildingCatalogue } from "@/features/storageLayouts/StorageLayoutScreens";

export default async function StorageLayoutsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("StorageLayouts");
  return (
    <>
      <PageHeader title={t("title")} backFallbackHref={null} />
      {/* New building sits beside the search field in each catalogue view. */}
      <StorageBuildingCatalogue />
    </>
  );
}
