import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { HandheldReceive } from "@/features/inbound/HandheldReceive";

export default async function HandheldReceivePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Receiving");

  return (
    <>
      <PageHeader
        title={t("handheldTitle")}
        description={t("handheldDescription")}
      />
      <HandheldReceive />
    </>
  );
}
