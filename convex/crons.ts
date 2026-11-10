import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily(
  "expire temporary credentials and replay cache",
  { hourUTC: 3, minuteUTC: 0 },
  internal.operations.temporaryRetention.dispatch,
  {},
);
crons.interval(
  "backfill derived zone occupancy where not ready",
  { hours: 1 },
  internal.storageLayouts.zoneOccupancyBackfill.sweep,
  {},
);
crons.interval(
  "build warehouse catalogue totals where not current",
  { hours: 1 },
  internal.finishedGoods.totalsBackfill.sweep,
  {},
);
crons.interval(
  "backfill derived search indexes where not ready",
  { hours: 1 },
  internal.finishedGoods.searchIndexBackfill.sweep,
  {},
);
crons.interval(
  "reconcile derived search indexes with unmaintained writes",
  { minutes: 1 },
  internal.finishedGoods.searchIndexBackfill.reconcileSweep,
  {},
);
crons.interval(
  "delete abandoned job ticket uploads",
  { hours: 1 },
  internal.finishedGoods.attachments.dispatchCleanup,
  {},
);
export default crons;
