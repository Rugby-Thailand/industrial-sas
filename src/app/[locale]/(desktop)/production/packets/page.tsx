import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { OrderToShipWorkspace } from "@/features/orderToShip/OrderToShipWorkspace";

export default async function FactoryPacketsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("OrderToShip");
  return (
    <>
      <PageHeader
        title={t("factoryTitle")}
        description={t("factoryDescription")}
      />
      <OrderToShipWorkspace view="factory" />
    </>
  );
}
