import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { PurchaseOrderForm } from "@/features/inbound/InboundForms";
import { PurchaseOrdersPanel } from "@/features/inbound/InboundPanels";
import { InboundSection } from "@/features/inbound/InboundPrimitives";
import { WriteDialog } from "@/features/masterData/WriteDialog";

export default async function PurchaseOrdersPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Purchasing");
  const writeT = await getTranslations("Write");

  return (
    <>
      <PageHeader
        title={t("ordersTitle")}
        description={t("ordersDescription")}
      />
      <div className="mb-4 flex justify-end">
        <WriteDialog
          triggerLabel={t("formLegend")}
          closeLabel={writeT("closeForm")}
          size="wide"
        >
          <PurchaseOrderForm />
        </WriteDialog>
      </div>
      <InboundSection title={t("ordersTitle")}>
        <PurchaseOrdersPanel />
      </InboundSection>
    </>
  );
}
