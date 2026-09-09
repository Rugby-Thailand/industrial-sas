import { OrganizationList } from "@clerk/nextjs";
import { getLocale, getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { Notice } from "@/components/ui/Notice";

export async function OrganizationRequired() {
  const t = await getTranslations("Access");
  const locale = await getLocale();

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-6">
      <PageHeader title={t("organizationRequiredTitle")} />
      <Notice
        tone="warning"
        title={t("organizationRequiredTitle")}
        body={t("organizationRequiredBody")}
        testId="organization-required"
      />
      <OrganizationList
        hidePersonal
        afterSelectOrganizationUrl={`/${locale}/master-data/storage-layouts`}
      />
    </main>
  );
}
