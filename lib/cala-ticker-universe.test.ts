import { describe, expect, it } from "vitest";
import {
  type BadTickerEntry,
  buildHarvestUniverse,
  isLikelyCalaNasdaqListedSymbol,
  isPriceDbStale,
  normalizeCalaTickerSymbol,
  parseBadTickerFile,
  priceDbAgeHours,
  retryableBadTickers,
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

describe("parseBadTickerFile", () => {
  it("returns empty array for non-existent path", () => {
    expect(parseBadTickerFile("/tmp/__nonexistent_bad_tickers__.json")).toEqual([]);
  });
});

describe("retryableBadTickers", () => {
  const old: BadTickerEntry = { ticker: "FOO", failedAt: new Date(Date.now() - 50 * 3600 * 1000).toISOString() };
  const recent: BadTickerEntry = { ticker: "BAR", failedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString() };

  it("returns all when olderThanHours <= 0", () => {
    expect(retryableBadTickers([old, recent], 0)).toEqual(["FOO", "BAR"]);
  });

  it("filters by age threshold", () => {
    expect(retryableBadTickers([old, recent], 24)).toEqual(["FOO"]);
  });

  it("returns empty when all are recent", () => {
    expect(retryableBadTickers([recent], 24)).toEqual([]);
  });
});
