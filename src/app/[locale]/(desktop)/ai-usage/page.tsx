import { setRequestLocale } from "next-intl/server";

import { AiUsageScreen } from "@/features/aiUsage/AiUsageScreen";
import { loadUsageEstimate } from "@/lib/aiUsage/usageEstimate.server";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Started on the server and streamed to the report without blocking it:
  // public FX and funding-policy data from the one-day Next.js data cache.
  // The loader never rejects; failures arrive as UNAVAILABLE sources.
  return <AiUsageScreen estimate={loadUsageEstimate()} />;
}
