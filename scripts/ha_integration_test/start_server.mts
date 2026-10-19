// Throw-away Homeroom for the HA integration test: real createApp, NO provider polling (no network),
// ephemeral state. Prints "READY <port>" once listening. Run from server/:  npx tsx ../scripts/ha_integration_test/start_server.mts
import { createApp } from "../../server/src/app.js";
import { Store } from "../../server/src/store.js";

const app = await createApp({
  store: new Store(":memory:"),
  appKey: process.env.PUSHER_APP_KEY ?? "homeroom-local-key",
  appSecret: process.env.PUSHER_APP_SECRET ?? "homeroom-local-secret",
  webDir: "/nonexistent",
  port: Number(process.env.PORT ?? 0),
  startPoller: false,
});
console.log(`READY ${app.port}`);
const stop = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
