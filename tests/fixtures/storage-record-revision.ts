import type { Doc, Id } from "../../convex/_generated/dataModel";
import { storageRecordRevision } from "../../convex/model/storageLayout/storageZone";
import type { ConvexTenantWorld } from "./convex-tenant-world";

/** Explicitly capture the current edit token when preparing a fixture command. */
export async function currentStorageRevision(
  world: ConvexTenantWorld,
  table: "storageZones" | "storagePositions",
  id: string,
): Promise<string> {
  const row = await world.t.run((ctx) => ctx.db.get(id as Id<typeof table>));
  if (row === null) throw new Error("Fixture storage row missing");
  return storageRecordRevision(row as Doc<typeof table>);
}
