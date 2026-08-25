import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { ReceiptDetail } from "@/features/inbound/ReceiptDetail";

export default async function ReceiptPage({
  params,
}: {
  readonly params: Promise<{ locale: string; receiptId: string }>;
}) {
  const { locale, receiptId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Receiving");

  return (
    <>
      <PageHeader
        title={t("receiptTitle")}
        description={t("receiptDescription")}
      />
      <ReceiptDetail receiptId={receiptId} />
    </>
  );
}
