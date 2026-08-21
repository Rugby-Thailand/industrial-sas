import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { OperatorWorkBoard } from "@/features/operator/OperatorWorkBoard";

/**
 * The first screen an operator opens.
 *
 * "My work" before the site queue, because the question an operator has when
 * they pick the handheld up is "what am I in the middle of" — a static wall of
 * module icons answers a question nobody asked (`FF-P1-01`).
 */
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
