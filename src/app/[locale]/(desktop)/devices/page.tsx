import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { DeviceRegistryPanel } from "@/features/platform/DeviceRegistryPanel";

/**
 * The device registry.
 *
 * A device is context on every transaction it posts (`ADR-0006` §8), so the
 * registry is where an administrator answers "which scanner recorded this" and
 * "which handheld has stopped checking in".
 */
export default async function DevicesPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("DeviceRegistry");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <DeviceRegistryPanel />
    </>
  );
}
