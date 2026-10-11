import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/navigation";

export default async function HrIndexPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}${ROUTES.hrToday}`);
}
