import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { HandheldDelivery } from "@/features/fulfillment/HandheldDelivery";

export default async function HandheldDeliveryPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Transport");
  return (
    <>
      <PageHeader
        title={t("deliveryTitle")}
        description={t("deliveryDescription")}
      />
      <HandheldDelivery />
    </>
  );
}
