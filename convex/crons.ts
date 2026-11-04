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
export default crons;
