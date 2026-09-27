import { setRequestLocale } from "next-intl/server";

import { StorageBuildingEditor } from "@/features/storageLayouts/StorageLayoutScreens";

export default async function StorageBuildingPage({
  params,
}: {
  readonly params: Promise<{ locale: string; buildingId: string }>;
}) {
  const { locale, buildingId } = await params;
  setRequestLocale(locale);
  return <StorageBuildingEditor buildingId={buildingId} />;
}
