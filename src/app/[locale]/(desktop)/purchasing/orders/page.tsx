import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { PurchaseOrderForm } from "@/features/inbound/InboundForms";
import { PurchaseOrdersPanel } from "@/features/inbound/InboundPanels";
import { InboundSection } from "@/features/inbound/InboundPrimitives";

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
