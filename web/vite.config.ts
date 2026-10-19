import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const target = "http://localhost:8080";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", sourcemap: false },
  server: {
    port: 5173,
    proxy: {
      "/api": target,
      "/media": target,
      "/ws": { target, ws: true },
    },
  },
});
