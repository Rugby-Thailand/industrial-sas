import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { HandheldPick } from "@/features/fulfillment/HandheldPick";

export default async function HandheldPickPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Fulfillment");
  return (
    <>
      <PageHeader title={t("pickTitle")} description={t("pickDescription")} />
      <HandheldPick />
    </>
  );
}
