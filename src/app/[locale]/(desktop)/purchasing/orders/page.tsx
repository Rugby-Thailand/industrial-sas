import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { PurchaseOrderForm } from "@/features/inbound/InboundForms";
import { PurchaseOrdersPanel } from "@/features/inbound/InboundPanels";
import { InboundSection } from "@/features/inbound/InboundPrimitives";

/**
 * The purchase-order register for one site.
 *
 * Warehouse-scoped, because a delivery arrives at a *site*: an order that
 * belonged only to the organization would be receivable by an actor with no
 * membership at the dock it turned up on (`INV-0006-04`).
 */
export default async function PurchaseOrdersPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Purchasing");

  return (
    <>
      <PageHeader
        title={t("ordersTitle")}
        description={t("ordersDescription")}
      />
      <InboundSection title={t("ordersTitle")}>
        <PurchaseOrdersPanel />
      </InboundSection>
      <InboundSection title={t("formLegend")}>
        <PurchaseOrderForm />
      </InboundSection>
    </>
  );
}
