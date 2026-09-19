import { getTranslations, setRequestLocale } from "next-intl/server";

import { storageBuildingPath } from "@/lib/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { StorageFloorEditor } from "@/features/storageLayouts/StorageLayoutScreens";

export default async function StorageFloorPage({
  params,
}: {
  readonly params: Promise<{
    locale: string;
    buildingId: string;
    floorNumber: string;
  }>;
}) {
  const { locale, buildingId, floorNumber } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("StorageLayouts");
  const parsedFloor = Number(floorNumber);
  return (
    <>
      <PageHeader
        back={{
          href: storageBuildingPath(buildingId),
          label: t("editBuilding"),
        }}
        title={t("editFloor", { floor: parsedFloor })}
        description={t("description")}
      />
      <StorageFloorEditor buildingId={buildingId} floorNumber={parsedFloor} />
    </>
  );
}
