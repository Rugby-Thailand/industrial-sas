import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily(
  "expire temporary credentials and replay cache",
  { hourUTC: 3, minuteUTC: 0 },
  internal.operations.temporaryRetention.dispatch,
  {},
);
export default crons;
