import { describe, expect, it } from "vitest";
import { parseScoreBug } from "./ocr";

describe("parseScoreBug", () => {
  it("parses Sportsnet English bug", () => {
    const text = `
      TOR 2
      MTL 1
      2nd 14:22
      SOG 18 12
    `;
    const res = parseScoreBug(text);
    expect(res.period).toBe(2);
    expect(res.clock).toBe("14:22");
  });

  it("parses TSN broadcast layout with 3rd period", () => {
    const text = `
      WPG 3 - OTT 1
      3RD 05:14
      POWER PLAY
    `;
    const res = parseScoreBug(text);
    expect(res.period).toBe(3);
    expect(res.clock).toBe("5:14");
  });

  it("parses RDS French bug with 1ère period", () => {
    const text = `
      MTL 1  BOS 0
      1ère 18:45
      TIRS 5 - 8
    `;
    const res = parseScoreBug(text);
    expect(res.period).toBe(1);
    expect(res.clock).toBe("18:45");
  });

  it("parses TVA Sports French bug with 1re and 2e", () => {
    const tva1 = `TVA SPORTS - MTL 0 NYR 0 - 1re 12:30`;
    expect(parseScoreBug(tva1)).toEqual({ period: 1, clock: "12:30", rawText: tva1 });

    const tva2 = `TVA SPORTS - 2E 08:15`;
    expect(parseScoreBug(tva2).period).toBe(2);
    expect(parseScoreBug(tva2).clock).toBe("8:15");
  });

  it("parses Overtime and Prolongation across providers", () => {
    const otEnglish = `EDM 2  VAN 2  OT 03:45`;
    expect(parseScoreBug(otEnglish)).toEqual({ period: 4, clock: "3:45", rawText: otEnglish });

    const otFrench = `MTL 3  TOR 3  PROL 02:18`;
    expect(parseScoreBug(otFrench)).toEqual({ period: 4, clock: "2:18", rawText: otFrench });

    const prFrench = `MTL 3  TOR 3  PR 01:10`;
    expect(parseScoreBug(prFrench)).toEqual({ period: 4, clock: "1:10", rawText: prFrench });
  });

  it("parses Amazon Prime Video hockey format", () => {
    const prime = `
      Prime Video
      1st 19:40
      EDM 0  CGY 0
    `;
    const res = parseScoreBug(prime);
    expect(res.period).toBe(1);
    expect(res.clock).toBe("19:40");
  });

  it("parses real Sportsnet TV screen photo with isolated text blocks", () => {
    const raw = "ot es\n\nSN\n\n9:41\n\ns\n\nSHOTS\n\n1ST\n\nTa\n\n-\n\ncx\n\naa\n\nie\n";
    const res = parseScoreBug(raw);
    expect(res.period).toBe(1);
    expect(res.clock).toBe("9:41");
  });

  it("handles clock with decimal tenths", () => {
    const tenths = `3rd 0:42.5`;
    const res = parseScoreBug(tenths);
    expect(res.period).toBe(3);
    expect(res.clock).toBe("0:42.5");
  });

  it("ignores invalid times or ratios", () => {
    const bad = `PP 5:4 SOG 24:18`;
    const res = parseScoreBug(bad);
    // 5:4 does not have 2 digits for seconds, 24:18 could be a clock if mins <= 120
    expect(res.clock).toBe("24:18");
  });
});
