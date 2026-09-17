import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("expire project presence", { minutes: 5 }, internal.projectPresence.cleanup, {});
crons.interval("sync GitHub issues", { minutes: 2 }, internal.integrations.kick, {});
export default crons;
