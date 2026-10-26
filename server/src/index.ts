import { createApp } from "./app.js";
import { loadConfig, securityNotes } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("homeroom");
const config = loadConfig();
for (const note of securityNotes(config)) log.warn(note);

const app = await createApp({ webDir: config.webDir, port: config.port, startPoller: true, config });
if (config.logLevel !== "silent") {
  console.log(`[homeroom] listening on :${app.port}`);
  console.log(`[homeroom] web root: ${config.webDir}`);
  console.log(`[homeroom] log level: ${config.logLevel}`);
}

const FORCE_EXIT_MS = 10_000;
let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  if (config.logLevel !== "silent") console.log(`[homeroom] ${signal}: shutting down`);
  // a stuck keep-alive socket must not keep a container from restarting
  setTimeout(() => process.exit(1), FORCE_EXIT_MS).unref();
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    log.error("shutdown failed:", err);
    process.exit(1);
  }
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
// a rejected promise nobody awaited is a bug to surface, not a reason to take the lights and horn down with it
process.on("unhandledRejection", (reason) => log.error("unhandled rejection:", reason));
