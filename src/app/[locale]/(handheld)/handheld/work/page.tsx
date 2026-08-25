import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { OperatorWorkBoard } from "@/features/operator/OperatorWorkBoard";

export default async function HandheldWorkPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("OperatorWork");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <OperatorWorkBoard />
    </>
  );
}
