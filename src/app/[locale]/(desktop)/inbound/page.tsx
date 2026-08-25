import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { InboundOperationsBoard } from "@/features/inbound/InboundOperationsBoard";

export default async function InboundBoardPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("InboundBoard");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <InboundOperationsBoard />
    </>
  );
}
