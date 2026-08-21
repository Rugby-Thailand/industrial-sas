import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { TransferBoard } from "@/features/transfers/TransferBoard";

export default async function TransfersPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Transfers");
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <TransferBoard />
    </>
  );
}
