/**
 * Pure Cala portfolio constraints + allocation builders (shared by scripts/tests).
 * Invariants: 50 unique tickers, $5k min per line, total exactly $1M.
 */

export const CALA_PORTFOLIO_TOTAL_BUDGET = 1_000_000;
export const CALA_PORTFOLIO_MIN_PER_STOCK = 5_000;
export const CALA_PORTFOLIO_MIN_STOCKS = 50;

export interface CalaAllocationRow {
  nasdaq_code: string;
  amount: number;
}

/** Row shape used by optimize strategies (matches price DB entries). */
export interface CalaPriceEntry {
  ticker: string;
  purchasePrice: number;
  evalPrice: number;
  returnPct: number;
}

export interface CalaPortfolioAudit {
  name: string;
  lineCount: number;
  uniqueCount: number;
  duplicateTickers: string[];
  totalAmount: number;
  minAmount: number;
  belowMinTickers: string[];
  valid: boolean;
  error: string | null;
}

export function auditAllocations(
  name: string,
  allocs: CalaAllocationRow[],
  opts?: {
    totalBudget?: number;
    minPerStock?: number;
    minStocks?: number;
  },
): CalaPortfolioAudit {
  const totalBudget = opts?.totalBudget ?? CALA_PORTFOLIO_TOTAL_BUDGET;
  const minPerStock = opts?.minPerStock ?? CALA_PORTFOLIO_MIN_PER_STOCK;
  const minStocks = opts?.minStocks ?? CALA_PORTFOLIO_MIN_STOCKS;

  const seen = new Set<string>();
  const duplicateTickers: string[] = [];
  const belowMinTickers: string[] = [];
  let totalAmount = 0;
  let minAmount = Number.POSITIVE_INFINITY;

  for (const alloc of allocs) {
    const ticker = alloc.nasdaq_code.toUpperCase();
    if (seen.has(ticker)) duplicateTickers.push(ticker);
    seen.add(ticker);
    totalAmount += alloc.amount;
    minAmount = Math.min(minAmount, alloc.amount);
    if (alloc.amount < minPerStock) belowMinTickers.push(`${ticker}=$${alloc.amount}`);
  }

  const lineCount = allocs.length;
  const uniqueCount = seen.size;
  const minValue = Number.isFinite(minAmount) ? minAmount : 0;
  let error: string | null = null;

  if (lineCount !== minStocks) error = `need ${minStocks} stocks, got ${lineCount}`;
  else if (uniqueCount !== lineCount) error = `duplicate ticker(s): ${duplicateTickers.join(", ")}`;
  else if (belowMinTickers.length > 0) error = `below min: ${belowMinTickers.join(", ")}`;
  else if (totalAmount !== totalBudget) error = `sum $${totalAmount} !== $${totalBudget}`;

  return {
    name,
    lineCount,
    uniqueCount,
    duplicateTickers,
    totalAmount,
    minAmount: minValue,
    belowMinTickers,
    valid: error === null,
    error,
  };
}

export function validateAllocationsError(allocs: CalaAllocationRow[]): string | null {
  return auditAllocations("validation", allocs).error;
}

export function buildEqualAllocations(tickers: string[]): CalaAllocationRow[] {
  const n = tickers.length;
  const totalBudget = CALA_PORTFOLIO_TOTAL_BUDGET;
  const perStock = Math.floor(totalBudget / n);
  let remainder = totalBudget - perStock * n;
  return tickers.map(t => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder--;
    return { nasdaq_code: t, amount: perStock + extra };
  });
}

export function buildMaxConcentration(entries: CalaPriceEntry[]): CalaAllocationRow[] {
  const top = entries.slice(0, 50);
  const minBudget = CALA_PORTFOLIO_MIN_PER_STOCK * 49;
  const topBudget = CALA_PORTFOLIO_TOTAL_BUDGET - minBudget;

  return top.map((e, i) => ({
    nasdaq_code: e.ticker,
    amount: i === 0 ? topBudget : CALA_PORTFOLIO_MIN_PER_STOCK,
  }));
}

export function buildTopWeighted(entries: CalaPriceEntry[]): CalaAllocationRow[] {
  const top50 = entries.slice(0, 50);
  const topN = 5;
  const disc = CALA_PORTFOLIO_TOTAL_BUDGET - CALA_PORTFOLIO_MIN_PER_STOCK * 50;
  const topPool = Math.floor(disc * 0.8);
  const botPool = disc - topPool;
  const amounts = top50.map(() => CALA_PORTFOLIO_MIN_PER_STOCK);

  const topReturns = top50.slice(0, topN).map(e => Math.max(0, e.returnPct));
  const topSum = topReturns.reduce((s, r) => s + r, 0) || 1;
  let allocatedTop = 0;
  for (let i = 0; i < topN; i++) {
    const add = Math.floor(topPool * (topReturns[i] / topSum));
    amounts[i] += add;
    allocatedTop += add;
  }
  const topRem = topPool - allocatedTop;

  const botCount = 50 - topN;
  const perBot = Math.floor(botPool / botCount);
  for (let i = topN; i < 50; i++) {
    amounts[i] += perBot;
  }
  const botAllocated = perBot * botCount;
  const botRem = botPool - botAllocated;

  const sprinkle = (rem: number, indices: number[]) => {
    let k = 0;
    while (rem > 0 && indices.length > 0) {
      amounts[indices[k % indices.length]]++;
      rem--;
      k++;
    }
  };
  const topIdx = [...Array(topN).keys()].sort((a, b) => topReturns[b] - topReturns[a]);
  sprinkle(topRem, topIdx);
  sprinkle(botRem, [...Array(botCount).keys()].map(i => i + topN));

  return top50.map((e, i) => ({ nasdaq_code: e.ticker, amount: amounts[i] }));
}

export function buildReturnProportional(entries: CalaPriceEntry[]): CalaAllocationRow[] {
  const top50 = entries.slice(0, 50);
  const disc = CALA_PORTFOLIO_TOTAL_BUDGET - CALA_PORTFOLIO_MIN_PER_STOCK * 50;
  const returns = top50.map(e => Math.max(0.01, e.returnPct));
  const totalR = returns.reduce((s, r) => s + r, 0);
  const amounts = top50.map(() => CALA_PORTFOLIO_MIN_PER_STOCK);
  let allocated = 0;
  for (let i = 0; i < 50; i++) {
    const add = Math.floor(disc * (returns[i] / totalR));
    amounts[i] += add;
    allocated += add;
  }
  let rem = disc - allocated;
  const idx = [...Array(50).keys()].sort((a, b) => returns[b] - returns[a]);
  let k = 0;
  while (rem > 0) {
    amounts[idx[k % 50]]++;
    rem--;
    k++;
  }
  return top50.map((e, i) => ({ nasdaq_code: e.ticker, amount: amounts[i] }));
}

export function buildDualConcentration(entries: CalaPriceEntry[]): CalaAllocationRow[] {
  const top50 = entries.slice(0, 50);
  const disc = CALA_PORTFOLIO_TOTAL_BUDGET - CALA_PORTFOLIO_MIN_PER_STOCK * 50;
  const r0 = Math.max(0.01, top50[0].returnPct);
  const r1 = Math.max(0.01, top50[1].returnPct);
  const sumR = r0 + r1;
  const amounts = top50.map(() => CALA_PORTFOLIO_MIN_PER_STOCK);
  const add0 = Math.floor(disc * (r0 / sumR));
  const add1 = Math.floor(disc * (r1 / sumR));
  amounts[0] += add0;
  amounts[1] += add1;
  let rem = disc - add0 - add1;
  while (rem > 0) {
    amounts[r0 >= r1 ? 0 : 1]++;
    rem--;
  }
  return top50.map((e, i) => ({ nasdaq_code: e.ticker, amount: amounts[i] }));
}

/** Split discretionary budget across top 3 by return (hedges vs dual when #2–#3 are also huge). */
export function buildTripleConcentration(entries: CalaPriceEntry[]): CalaAllocationRow[] {
  const top50 = entries.slice(0, 50);
  const disc = CALA_PORTFOLIO_TOTAL_BUDGET - CALA_PORTFOLIO_MIN_PER_STOCK * 50;
  const r = top50.slice(0, 3).map((e) => Math.max(0.01, e.returnPct));
  const sumR = r.reduce((s, x) => s + x, 0);
  const amounts = top50.map(() => CALA_PORTFOLIO_MIN_PER_STOCK);
  let allocated = 0;
  for (let i = 0; i < 3; i++) {
    const add = Math.floor(disc * (r[i] / sumR));
    amounts[i] += add;
    allocated += add;
  }
  let rem = disc - allocated;
  const order = [0, 1, 2].sort((a, b) => r[b] - r[a]);
  let k = 0;
  while (rem > 0) {
    amounts[order[k % 3]]++;
    rem--;
    k++;
  }
  return top50.map((e, i) => ({ nasdaq_code: e.ticker, amount: amounts[i] }));
}
