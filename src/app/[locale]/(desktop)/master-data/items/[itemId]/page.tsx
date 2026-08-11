import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { ItemDetailPanel } from "@/features/masterData/ItemDetailPanel";

/**
 * One item and everything identified by it.
 *
 * The identifier comes from the route and is passed through untouched. It is not
 * validated here on purpose: the server decides whether an identifier names one
 * of this tenant's items, and a client-side shape check would only decide
 * whether it *looks* like one — which is a different question with a more
 * confident-sounding answer.
 */
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
