import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { ItemDetailPanel } from "@/features/masterData/ItemDetailPanel";

export default async function ItemDetailPage({
  params,
}: {
  readonly params: Promise<{ locale: string; itemId: string }>;
}) {
  const { locale, itemId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("MasterData");

  return (
    <>
      <PageHeader
        title={t("itemDetailTitle")}
        description={t("itemDetailDescription")}
      />
      <ItemDetailPanel itemId={itemId} />
    </>
  );
}
