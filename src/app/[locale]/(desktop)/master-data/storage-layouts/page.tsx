import { getTranslations, setRequestLocale } from "next-intl/server";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { StorageBuildingCatalogue } from "@/features/storageLayouts/StorageLayoutScreens";
import { Link } from "@/i18n/navigation";
import { ROUTES } from "@/lib/navigation";

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
      <PageHeader title={t("title")} summary={t("description")}>
        <Button asChild>
          <Link href={`${ROUTES.storageLayouts}/new`}>
            <Plus aria-hidden="true" className="size-4" />
            {t("newBuilding")}
          </Link>
        </Button>
      </PageHeader>
      <StorageBuildingCatalogue />
    </>
  );
}
