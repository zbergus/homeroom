import { describe, expect, it, vi } from "vitest";
import { createLogger, isLevelEnabled, sanitizeUrl, setLogLevel } from "../src/logger.js";

describe("logger", () => {
  it("enforces level hierarchy", () => {
    setLogLevel("warn");
    expect(isLevelEnabled("debug")).toBe(false);
    expect(isLevelEnabled("info")).toBe(false);
    expect(isLevelEnabled("warn")).toBe(true);
    expect(isLevelEnabled("error")).toBe(true);

    setLogLevel("info");
    expect(isLevelEnabled("debug")).toBe(false);
    expect(isLevelEnabled("info")).toBe(true);
    expect(isLevelEnabled("warn")).toBe(true);

    setLogLevel("silent");
    expect(isLevelEnabled("error")).toBe(false);
    expect(isLevelEnabled("warn")).toBe(false);
  });

  it("redacts tokens in URLs", () => {
    expect(sanitizeUrl("/api/hook/goal?token=my-secret&league=nhl")).toBe("/api/hook/goal?token=%5BREDACTED%5D&league=nhl");
    expect(sanitizeUrl("/api/games/raw")).toBe("/api/games/raw");
  });

  it("redacts sensitive fields and bearer tokens in logs", () => {
    const log = createLogger("test");
    setLogLevel("info");

    const spyLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const spyWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      log.info("Request with auth:", "Bearer super-secret-token-123");
      expect(spyLog).toHaveBeenCalledWith("[test]", "Request with auth:", "Bearer [REDACTED]");

      log.warn("Payload:", { token: "secret", user: "admin", nested: { password: "123" } });
      expect(spyWarn).toHaveBeenCalledWith("[test]", "Payload:", {
        token: "[REDACTED]",
        user: "admin",
        nested: { password: "[REDACTED]" },
      });
    } finally {
      spyLog.mockRestore();
      spyWarn.mockRestore();
    }
  });
});
