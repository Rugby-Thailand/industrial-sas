import { setRequestLocale } from "next-intl/server";
import { PackingScreen } from "@/features/finishedGoods/PackingScreen";

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string; productId: string }>;
  readonly searchParams: Promise<{ draft?: string }>;
}) {
  const [{ locale, productId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  setRequestLocale(locale);
  const draftToken =
    typeof query.draft === "string" && /^[0-9a-f-]{36}$/.test(query.draft)
      ? query.draft
      : undefined;
  return <PackingScreen productId={productId} draftToken={draftToken} />;
}
