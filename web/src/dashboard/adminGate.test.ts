import { describe, expect, it } from "vitest";
import { isAdminLocked } from "./adminGate";

describe("admin gate", () => {
  it("stays open for servers without ADMIN_TOKEN, even with no token entered", () => {
    expect(isAdminLocked(undefined, "")).toBe(false);
    expect(isAdminLocked(false, "")).toBe(false);
  });

  it("hides controls when the server requires a token and none is entered", () => {
    expect(isAdminLocked(true, "")).toBe(true);
    expect(isAdminLocked(true, "   ")).toBe(true);
  });

  it("opens as soon as a token is stored", () => {
    expect(isAdminLocked(true, "server-token")).toBe(false);
  });
});
