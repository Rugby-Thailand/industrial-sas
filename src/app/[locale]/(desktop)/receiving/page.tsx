import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import {
  OpenReceiptForm,
  ReceivingExceptionForm,
} from "@/features/inbound/InboundForms";
import { ReceiptsPanel } from "@/features/inbound/InboundPanels";
import { InboundSection } from "@/features/inbound/InboundPrimitives";

export default async function ReceivingPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Receiving");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <InboundSection title={t("sectionReceipts")}>
        <ReceiptsPanel />
      </InboundSection>
      <InboundSection title={t("sectionOpen")}>
        <OpenReceiptForm chooseOrder />
      </InboundSection>
      <InboundSection title={t("sectionException")}>
        <ReceivingExceptionForm />
      </InboundSection>
    </>
  );
}
