import { OrganizationList } from "@clerk/nextjs";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { Notice } from "@/components/ui/Notice";

export async function OrganizationRequired({
  returnTo,
}: {
  readonly returnTo: string;
}) {
  const t = await getTranslations("Access");

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-6">
      <PageHeader showBack={false} title={t("organizationRequiredTitle")} />
      <Notice
        tone="warning"
        role="alert"
        title={t("organizationRequiredBody")}
        testId="organization-required"
      />
      <OrganizationList hidePersonal afterSelectOrganizationUrl={returnTo} />
    </main>
  );
}
