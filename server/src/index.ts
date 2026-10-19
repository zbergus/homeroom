import path from "node:path";
import { createApp } from "./app.js";

const PORT = Number(process.env.PORT ?? 8080);
const APP_KEY = process.env.PUSHER_APP_KEY ?? "homeroom-local-key";
const APP_SECRET = process.env.PUSHER_APP_SECRET ?? "homeroom-local-secret";
const WEB_DIR = process.env.WEB_DIR ?? path.resolve("../web/dist");

if (APP_SECRET === "homeroom-local-secret") {
  console.warn("[homeroom] PUSHER_APP_SECRET is the default; fine on a trusted LAN, change it otherwise.");
}

const app = await createApp({ appKey: APP_KEY, appSecret: APP_SECRET, webDir: WEB_DIR, port: PORT, startPoller: true });
console.log(`[homeroom] listening on :${app.port}  (pusher app key: ${APP_KEY})`);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
