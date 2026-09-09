import { setRequestLocale } from "next-intl/server";
import { FloorMapDemo } from "@/components/storageLayouts/FloorMapDemo";
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <FloorMapDemo />;
}
