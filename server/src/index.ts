import { createApp } from "./app.js";
import { loadConfig, securityNotes } from "./config.js";

const config = loadConfig();
for (const note of securityNotes(config)) console.warn(`[homeroom] ${note}`);

const app = await createApp({ appKey: config.appKey, appSecret: config.appSecret, webDir: config.webDir, port: config.port, startPoller: true, config });
console.log(`[homeroom] listening on :${app.port}  (pusher app key: ${config.appKey})`);

const FORCE_EXIT_MS = 10_000;
let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`[homeroom] ${signal}: shutting down`);
  // a stuck keep-alive socket must not keep a container from restarting
  setTimeout(() => process.exit(1), FORCE_EXIT_MS).unref();
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    console.error("[homeroom] shutdown failed:", err);
    process.exit(1);
  }
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
// a rejected promise nobody awaited is a bug to surface, not a reason to take the lights and horn down with it
process.on("unhandledRejection", (reason) => console.error("[homeroom] unhandled rejection:", reason));
