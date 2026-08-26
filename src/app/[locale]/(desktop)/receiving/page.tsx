import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import {
  OpenReceiptForm,
  ReceivingExceptionForm,
} from "@/features/inbound/InboundForms";
import { ReceiptsPanel } from "@/features/inbound/InboundPanels";
import { InboundSection } from "@/features/inbound/InboundPrimitives";
import { WriteDialog } from "@/features/masterData/WriteDialog";

export default async function ReceivingPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Receiving");
  const writeT = await getTranslations("Write");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="mb-4 flex flex-wrap justify-end gap-3">
        <WriteDialog
          triggerLabel={t("sectionOpen")}
          closeLabel={writeT("closeForm")}
        >
          <OpenReceiptForm chooseOrder />
        </WriteDialog>
        <WriteDialog
          triggerLabel={t("sectionException")}
          closeLabel={writeT("closeForm")}
          triggerVariant="outline"
          showPlus={false}
        >
          <ReceivingExceptionForm />
        </WriteDialog>
      </div>
      <InboundSection title={t("sectionReceipts")}>
        <ReceiptsPanel />
      </InboundSection>
    </>
  );
}
