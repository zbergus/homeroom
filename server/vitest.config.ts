import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

const tmp = path.join(os.tmpdir(), "homeroom-vitest");

export default defineConfig({
  test: {
    // tests must never write into the repo
    env: { DATA_DIR: path.join(tmp, "data"), MEDIA_DIR: path.join(tmp, "media") },
  },
});
