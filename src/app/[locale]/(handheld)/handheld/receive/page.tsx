import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { HandheldReceive } from "@/features/inbound/HandheldReceive";

/**
 * Receiving on a scanner.
 *
 * The same functions and the same rules as the desktop desk — one server, one
 * tolerance, one status vocabulary (UX plan §1). What differs is the shell and
 * the ordering: the scan field is first, the controls are touch-sized, and the
 * screen shows one receipt at a time rather than a register.
 */
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
