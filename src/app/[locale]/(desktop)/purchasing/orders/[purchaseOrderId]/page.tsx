import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { PurchaseOrderDetail } from "@/features/inbound/PurchaseOrderDetail";

/**
 * One purchase order: its lines, and the controls that change them.
 *
 * The identifier comes from the route and is passed through untouched. The
 * server decides whether it names one of this tenant's orders; a client-side
 * shape check would only decide whether it *looks* like one, which is a
 * different question with a more confident-sounding answer.
 */
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
