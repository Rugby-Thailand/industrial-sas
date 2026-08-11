import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { PutawayWorkbench } from "@/features/inbound/PutawayWorkbench";

/**
 * Putaway on a scanner.
 *
 * The board, the explanation, and the confirmation, in the shell an operator
 * holds while walking to the rack. The explanation is not trimmed for the
 * smaller screen: "why this bin?" is the question most likely to be asked *at*
 * the rack, and an answer only the desktop carries is an answer nobody reads.
 */
export default async function HandheldPutawayPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Putaway");

  return (
    <>
      <PageHeader
        title={t("handheldTitle")}
        description={t("handheldDescription")}
      />
      <PutawayWorkbench />
    </>
  );
}
