import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import {
  OpenReceiptForm,
  ReceivingExceptionForm,
} from "@/features/inbound/InboundForms";
import {
  InboundSection,
  ReceiptsPanel,
} from "@/features/inbound/InboundPanels";

/**
 * The receiving desk.
 *
 * Receipts are listed, opened, and — separately — exceptions are raised. The
 * exception form sits on this screen rather than inside the capture flow because
 * raising one and receiving against it must be done by *different* people
 * (`INV-0007-04`): putting them in one flow would suggest one person does both.
 */
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
