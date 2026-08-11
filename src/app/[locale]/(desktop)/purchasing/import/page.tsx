import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { ImportWorkbench } from "@/features/inbound/ImportWorkbench";

/**
 * Import purchase-order lines from a spreadsheet.
 *
 * Two steps, because the server is two steps: a **query** that parses and cannot
 * write, then bounded chunks that can. What an operator approves here is a parse
 * whose only effect was to produce the list they are reading (`INV-0007-12`).
 */
export default async function PurchaseImportPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Purchasing");

  return (
    <>
      <PageHeader
        title={t("importTitle")}
        description={t("importDescription")}
      />
      <ImportWorkbench />
    </>
  );
}
