import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { PutawayWorkbench } from "@/features/inbound/PutawayWorkbench";

export default async function PutawayPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Putaway");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <PutawayWorkbench />
    </>
  );
}
