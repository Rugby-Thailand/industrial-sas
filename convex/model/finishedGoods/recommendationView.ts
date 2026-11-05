/**
 * Fields every recommendation candidate of one zone shares, which a screen
 * renders only for the candidate it previews (scene geometry, stack surfaces,
 * identifiers). `recommend`/`recommendMove` with `view: "list"` omit them from
 * each candidate; `recommendationZone` returns them once for the zone being
 * viewed, so `{ ...listed, ...zone }` is exactly the full candidate.
 */
export const ZONE_PREVIEW_FIELDS = [
  "unmeasuredPalletCount",
  "locationId",
  "locationQrValue",
  "buildingId",
  "floorId",
  "zone",
  "occupied",
  "unavailable",
  "previewSupports",
] as const;
export type ZonePreviewField = (typeof ZONE_PREVIEW_FIELDS)[number];

/** A candidate without its zone's preview fields. */
export function listedCandidate<Candidate extends object>(
  candidate: Candidate,
): Omit<Candidate, ZonePreviewField> {
  const listed = { ...candidate } as Record<string, unknown>;
  for (const field of ZONE_PREVIEW_FIELDS) delete listed[field];
  return listed as Omit<Candidate, ZonePreviewField>;
}

/** The zone preview fields a candidate carries (the same for its whole zone). */
export function zonePreview<Candidate extends { zoneId: unknown }>(
  candidate: Candidate,
): Pick<Candidate, "zoneId" | (ZonePreviewField & keyof Candidate)> {
  const preview: Record<string, unknown> = { zoneId: candidate.zoneId };
  for (const field of ZONE_PREVIEW_FIELDS)
    if ((candidate as Record<string, unknown>)[field] !== undefined)
      preview[field] = (candidate as Record<string, unknown>)[field];
  return preview as Pick<
    Candidate,
    "zoneId" | (ZonePreviewField & keyof Candidate)
  >;
}
