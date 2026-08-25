import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { PurchaseOrderDetail } from "@/features/inbound/PurchaseOrderDetail";

export default async function PurchaseOrderPage({
  params,
}: {
  readonly params: Promise<{ locale: string; purchaseOrderId: string }>;
}) {
  const { locale, purchaseOrderId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Purchasing");

  return (
    <>
      <PageHeader title={t("orderTitle")} description={t("orderDescription")} />
      <PurchaseOrderDetail purchaseOrderId={purchaseOrderId} />
    </>
  );
}
