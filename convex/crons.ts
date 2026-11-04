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
  "prune finished goods change log",
  { minutes: 30 },
  internal.finishedGoods.changeLog.prune,
  {},
);
crons.interval(
  "backfill derived zone occupancy where not ready",
  { hours: 1 },
  internal.storageLayouts.zoneOccupancyBackfill.sweep,
  {},
);
export default crons;
