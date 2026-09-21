"use client";

import { useCallback, useEffect, useState } from "react";
import type { StorageZoneRow } from "@/lib/convex/storageLayoutApi";
import { useWorkspaceQuery } from "./useWorkspaceQuery";

/** One floor-scoped selection feeds the map, collection and inline inspector. */
export function useFloorSelection(
  scope: string,
  zones: readonly StorageZoneRow[],
) {
  const query = useWorkspaceQuery();
  const [selection, setSelection] = useState<{
    scope: string;
    id: string | undefined;
  }>({ scope, id: undefined });
  const selectedZoneId =
    selection.scope === scope &&
    zones.some((zone) => zone.zoneId === selection.id)
      ? selection.id
      : undefined;
  if (
    selection.scope !== scope ||
    (selection.id !== undefined && selectedZoneId === undefined)
  ) {
    setSelection({ scope, id: undefined });
  }
  const setSelectedZoneId = useCallback(
    (id: string | undefined) => setSelection({ scope, id }),
    [scope],
  );
  useEffect(() => {
    const followSelection = () => {
      const params = new URLSearchParams(query);
      const requested =
        params.get("editZone") ??
        window.location.hash.replace(/^#storage-zone-/, "");
      if (zones.some((zone) => zone.zoneId === requested))
        setSelection({ scope, id: requested });
    };
    followSelection();
    window.addEventListener("hashchange", followSelection);
    return () => window.removeEventListener("hashchange", followSelection);
  }, [query, scope, zones]);
  return { selectedZoneId, setSelectedZoneId };
}
