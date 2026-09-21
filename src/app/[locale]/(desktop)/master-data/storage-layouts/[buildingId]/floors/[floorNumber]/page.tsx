import { hasLocale } from "next-intl";
import { notFound, redirect } from "next/navigation";

import { routing } from "@/i18n/routing";
import { storageFloorPath } from "@/lib/navigation";

/** Keep bookmarked floor links working in the shared building workspace. */
export default async function StorageFloorPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{
    locale: string;
    buildingId: string;
    floorNumber: string;
  }>;
  readonly searchParams: Promise<{ editZone?: string | string[] }>;
}) {
  const [{ locale, buildingId, floorNumber }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const parsedFloor = Number(floorNumber);
  if (
    !hasLocale(routing.locales, locale) ||
    !/^\d+$/.test(floorNumber) ||
    !Number.isSafeInteger(parsedFloor) ||
    parsedFloor < 1
  ) {
    notFound();
  }
  const editZone = Array.isArray(query.editZone)
    ? query.editZone[0]
    : query.editZone;
  const destination = `/${locale}${storageFloorPath(buildingId, parsedFloor)}`;
  redirect(
    editZone
      ? `${destination}&${new URLSearchParams({ editZone }).toString()}`
      : destination,
  );
}
