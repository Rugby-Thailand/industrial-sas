import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { FulfillmentBoard } from "@/features/fulfillment/FulfillmentBoard";
import { FulfillmentExecutionBoard } from "@/features/fulfillment/FulfillmentExecutionBoard";

export default async function FulfillmentPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Fulfillment");
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <FulfillmentBoard />
      <FulfillmentExecutionBoard />
    </>
  );
}
