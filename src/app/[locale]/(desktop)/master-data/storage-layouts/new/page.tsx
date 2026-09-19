import { getTranslations, setRequestLocale } from "next-intl/server";

import { ROUTES } from "@/lib/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { NewStorageBuildingForm } from "@/features/storageLayouts/StorageLayoutScreens";

export default async function NewStorageLayoutPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("StorageLayouts");
  return (
    <>
      <PageHeader
        back={{ href: ROUTES.storageLayouts, label: t("back") }}
        title={t("newBuilding")}
        description={t("description")}
      />
      <NewStorageBuildingForm />
    </>
  );
}
