import { describe, expect, it } from "vitest";
import {
  auditAllocations,
  buildMaxConcentration,
  buildPowerTopWeighted,
  buildTopWeighted,
  calibrateAndSortPriceEntries,
  calibrateCalaPriceEntry,
  CALA_PORTFOLIO_TOTAL_BUDGET,
  type CalaPriceEntry,
  priceEntriesToLookup,
  projectedReturnPctFromValue,
  projectedTerminalValueUsd,
  validateAllocationsError,
} from "./cala-portfolio-math";

function fakeEntries(returns: number[]): CalaPriceEntry[] {
  return returns.map((returnPct, i) => {
    const purchasePrice = 10 + i * 0.01;
    const evalPrice = purchasePrice * (1 + returnPct / 100);
    return {
      ticker: `T${i}`,
      purchasePrice,
      evalPrice,
      returnPct,
    };
  });
}

describe("calibrateCalaPriceEntry", () => {
  it("recomputes returnPct from prices", () => {
    const e: CalaPriceEntry = {
      ticker: "x",
      purchasePrice: 10,
      evalPrice: 30,
      returnPct: 5,
    };
    const c = calibrateCalaPriceEntry(e);
    expect(c.ticker).toBe("X");
    expect(c.returnPct).toBeCloseTo(200, 5);
  });
});

describe("calibrateAndSortPriceEntries", () => {
  it("orders by calibrated return, not stale field", () => {
    const a: CalaPriceEntry = { ticker: "A", purchasePrice: 1, evalPrice: 2, returnPct: 999 };
    const b: CalaPriceEntry = { ticker: "B", purchasePrice: 1, evalPrice: 5, returnPct: 1 };
    const sorted = calibrateAndSortPriceEntries([a, b]);
    expect(sorted[0].ticker).toBe("B");
    expect(sorted[1].ticker).toBe("A");
  });
});

describe("auditAllocations", () => {
  it("accepts a valid max-concentration portfolio", () => {
    const entries = fakeEntries(Array(50).fill(5));
    const allocs = buildMaxConcentration(entries);
    const a = auditAllocations("test", allocs);
    expect(a.valid).toBe(true);
    expect(validateAllocationsError(allocs)).toBeNull();
    expect(a.totalAmount).toBe(CALA_PORTFOLIO_TOTAL_BUDGET);
  });

  it("rejects wrong stock count", () => {
    const allocs = [{ nasdaq_code: "A", amount: CALA_PORTFOLIO_TOTAL_BUDGET }];
    expect(auditAllocations("x", allocs).valid).toBe(false);
  });
});

describe("projectedTerminalValueUsd", () => {
  it("matches amount * (1 + r/100) when purchase is $1", () => {
    const entries: CalaPriceEntry[] = [
      { ticker: "A", purchasePrice: 1, evalPrice: 3, returnPct: 200 },
      { ticker: "B", purchasePrice: 1, evalPrice: 1.1, returnPct: 10 },
    ];
    const lookup = priceEntriesToLookup(entries);
    const allocs = [
      { nasdaq_code: "A", amount: 600_000 },
      { nasdaq_code: "B", amount: 400_000 },
    ];
    const v = projectedTerminalValueUsd(allocs, lookup);
    expect(v).toBeCloseTo(600_000 * 3 + 400_000 * 1.1, 5);
  });

  it("uses real purchase prices (low-priced stock gets more shares per dollar)", () => {
    const entries: CalaPriceEntry[] = [
      { ticker: "CHEAP", purchasePrice: 0.5, evalPrice: 5, returnPct: 900 },
      { ticker: "RICH", purchasePrice: 100, evalPrice: 200, returnPct: 100 },
    ];
    const lookup = priceEntriesToLookup(entries);
    const allocs = [
      { nasdaq_code: "CHEAP", amount: 500_000 },
      { nasdaq_code: "RICH", amount: 500_000 },
    ];
    const v = projectedTerminalValueUsd(allocs, lookup);
    // cheap: 1M shares * 5 = 5M; rich: 5k shares * 200 = 1M
    expect(v).toBeCloseTo(6_000_000, 5);
  });
});

describe("max concentration dominates linear objective", () => {
  it("beats equal split on synthetic returns when #1 is best", () => {
    const returns = [500, 80, 60, ...Array(47).fill(3)];
    const entries = fakeEntries(returns);
    const maxAllocs = buildMaxConcentration(entries);
    const topW = buildTopWeighted(entries);
    const lu = priceEntriesToLookup(entries);
    const vMax = projectedTerminalValueUsd(maxAllocs, lu);
    const vTop = projectedTerminalValueUsd(topW, lu);
    expect(vMax).toBeGreaterThan(vTop);
    expect(projectedReturnPctFromValue(vMax)).toBeGreaterThan(projectedReturnPctFromValue(vTop));
  });

  it("buildPowerTopWeighted is valid and spreads discretionary across top names vs max_concentrate", () => {
    const returns = [400, 350, 300, 280, 260, 240, 220, 200, ...Array(42).fill(2)];
    const entries = fakeEntries(returns);
    const pow = buildPowerTopWeighted(entries, { topN: 8, power: 2 });
    expect(validateAllocationsError(pow)).toBeNull();
    const max = buildMaxConcentration(entries);
    expect(pow[0].amount).toBeLessThan(max[0].amount);
    expect(pow[1].amount).toBeGreaterThan(max[1].amount);
  });
});
