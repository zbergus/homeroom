import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  try {
    ({ chromium } = require(path.resolve(process.env.PLAYWRIGHT_PATH || "/home/antigravity/src/github.com/zbergus/arrstack/node_modules/playwright")));
  } catch {
    console.error("Playwright not found. Install playwright or run in an environment with playwright.");
    process.exit(1);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, "../web/dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
};

function startServer(port = 4567) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      let filePath = path.join(DIST_DIR, urlPath);

      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
      if (!fs.existsSync(filePath)) {
        filePath = path.join(DIST_DIR, "index.html");
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME[ext] || "application/octet-stream";

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("Not found");
        } else {
          res.writeHead(200, { "Content-Type": contentType });
          res.end(data);
        }
      });
    });

    server.listen(port, "127.0.0.1", () => {
      console.log(`Static server running at http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

async function main() {
  const server = await startServer(4567);

  console.log("Launching headless chromium...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("[browser error]", msg.text());
  });

  const urls = [
    { name: "Scoreboard (NHL)", url: "http://127.0.0.1:4567/scoreboard?mock=1&game=nhl:m1" },
    { name: "Scoreboard (IIHF)", url: "http://127.0.0.1:4567/scoreboard?mock=1&game=iihf:m1" },
    { name: "Plate (Hockey Scorebug)", url: "http://127.0.0.1:4567/plate?mock=1&game=nhl:m1" },
    { name: "Grid (Multiview)", url: "http://127.0.0.1:4567/grid?mock=1" },
    { name: "Ticker", url: "http://127.0.0.1:4567/ticker?mock=1" },
    { name: "Dashboard (Calibrate & Scan TV)", url: "http://127.0.0.1:4567/?mock=1" },
  ];

  for (const item of urls) {
    console.log(`Checking ${item.name} at ${item.url}...`);
    await page.goto(item.url, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    const bodyText = await page.innerText("body");
    console.log(`  Rendered body length: ${bodyText.length} chars`);

    if (item.name.includes("Scoreboard (NHL)")) {
      if (!bodyText.includes("MIN") || !bodyText.includes("CBJ")) {
        throw new Error("Missing expected NHL teams on scoreboard");
      }
      if (!bodyText.includes("SOG")) {
        throw new Error("Missing SOG badge on hockey scoreboard");
      }
      console.log("  ✓ NHL Scoreboard verified (MIN, CBJ, SOG)");
    } else if (item.name.includes("Scoreboard (IIHF)")) {
      if (!bodyText.includes("CAN") || !bodyText.includes("USA")) {
        throw new Error("Missing expected IIHF national teams on scoreboard");
      }
      console.log("  ✓ IIHF Scoreboard verified (CAN, USA)");
    } else if (item.name.includes("Plate")) {
      if (!bodyText.includes("MIN") || !bodyText.includes("CBJ")) {
        throw new Error("Missing expected teams on Plate");
      }
      if (!bodyText.includes("SOG")) {
        throw new Error("Missing SOG on Plate");
      }
      console.log("  ✓ Hockey Plate verified (SOG, teams)");
    } else if (item.name.includes("Grid")) {
      if (!bodyText.includes("MIN") && !bodyText.includes("USA") && !bodyText.includes("HER")) {
        throw new Error("Grid missing hockey games");
      }
      console.log("  ✓ Hockey Grid multiview verified");
    } else if (item.name.includes("Ticker")) {
      if (!bodyText.includes("MIN") && !bodyText.includes("USA")) {
        throw new Error("Ticker missing hockey games");
      }
      console.log("  ✓ Hockey Ticker verified");
    } else if (item.name.includes("Dashboard")) {
      const scanBtn = await page.$("button:has-text('Scan TV with Camera')");
      if (!scanBtn) {
        throw new Error("Missing 'Scan TV with Camera' button in Calibrate section");
      }
      const fileInput = await page.$("input[type='file'][capture='environment']");
      if (!fileInput) {
        throw new Error("Missing capture='environment' camera file input");
      }
      console.log("  ✓ Dashboard Calibrate card and Scan TV Camera input verified");

      // Take verification screenshot of the Calibrate card on dashboard
      const calibrateCard = await page.$("text=Calibrate");
      if (calibrateCard) {
        await page.screenshot({ path: path.join(__dirname, "../docs/research/verify-calibrate-scan.png") });
        console.log("  ✓ Screenshot saved to docs/research/verify-calibrate-scan.png");
      }
    }
  }

  await browser.close();
  server.close();
  console.log("All kiosk TV views and Dashboard successfully verified with Playwright!");
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});

