import { setRequestLocale } from "next-intl/server";

import { StorageBuildingReview } from "@/features/storageLayouts/StorageLayoutScreens";

export default async function StorageReviewPage({
  params,
}: {
  readonly params: Promise<{ locale: string; buildingId: string }>;
}) {
  const { locale, buildingId } = await params;
  setRequestLocale(locale);
  return <StorageBuildingReview buildingId={buildingId} />;
}
