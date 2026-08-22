import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { PodReviewQueue } from "@/features/fulfillment/PodReviewQueue";
import { TransportBoard } from "@/features/fulfillment/TransportBoard";
export default async function TransportPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Transport");
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <TransportBoard />
      <PodReviewQueue />
    </>
  );
}
