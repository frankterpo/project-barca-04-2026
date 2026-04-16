import { describe, expect, it } from "vitest";
import {
  buildHarvestUniverse,
  isLikelyCalaNasdaqListedSymbol,
  isPriceDbStale,
  normalizeCalaTickerSymbol,
  priceDbAgeHours,
  splitHarvestUniverse,
} from "./cala-ticker-universe";

describe("normalizeCalaTickerSymbol + isLikelyCalaNasdaqListedSymbol", () => {
  it("accepts 1–5 letter NASDAQ-style symbols", () => {
    expect(isLikelyCalaNasdaqListedSymbol(normalizeCalaTickerSymbol("nvda"))).toBe(true);
    expect(isLikelyCalaNasdaqListedSymbol("A")).toBe(true);
    expect(isLikelyCalaNasdaqListedSymbol("MSTU")).toBe(true);
  });

  it("rejects too-long / dotted / non-alpha", () => {
    expect(isLikelyCalaNasdaqListedSymbol("LARAMEE")).toBe(false);
    expect(isLikelyCalaNasdaqListedSymbol("FOOBAR1")).toBe(false);
    expect(isLikelyCalaNasdaqListedSymbol("BRK.B")).toBe(false);
    expect(isLikelyCalaNasdaqListedSymbol("AB")).toBe(true);
  });
});

describe("splitHarvestUniverse", () => {
  it("dedupes case-insensitively and preserves first occurrence order", () => {
    const { valid, invalidFormat } = splitHarvestUniverse(["nvda", "NVDA", "AAPL", "LARAMEE"]);
    expect(valid).toEqual(["NVDA", "AAPL"]);
    expect(invalidFormat).toContain("LARAMEE");
  });
});

describe("buildHarvestUniverse", () => {
  it("merges extra CSV tickers", () => {
    const u = buildHarvestUniverse(["AAA", "BBB"], "ccc, invalid.toolong", []);
    expect(u).toContain("AAA");
    expect(u).toContain("BBB");
    expect(u).toContain("CCC");
    expect(u.some((t) => t.includes("."))).toBe(false);
  });
});

describe("price DB staleness", () => {
  it("treats maxAgeHours<=0 as never stale", () => {
    expect(isPriceDbStale("1990-01-01T00:00:00.000Z", 0)).toBe(false);
  });

  it("flags old timestamps", () => {
    const old = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
    expect(isPriceDbStale(old, 48)).toBe(true);
    expect(priceDbAgeHours(old)).toBeGreaterThan(90);
  });
});
