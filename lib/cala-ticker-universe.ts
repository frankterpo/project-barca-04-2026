/**
 * Cala harvest universe: normalize symbols, drop formats Convex/Cala won't resolve
 * (OTC suffixes, >5 chars, dots), merge optional candidate files with provenance.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Cala harvest path expects NASDAQ-style symbols: **only** A–Z, length 1–5.
 * Drops symbols longer than five letters, dotted names, and non–A–Z characters.
 */
const NASDAQ_STYLE_RE = /^[A-Z]{1,5}$/;

export function normalizeCalaTickerSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isLikelyCalaNasdaqListedSymbol(normalized: string): boolean {
  if (!normalized) return false;
  return NASDAQ_STYLE_RE.test(normalized);
}

export interface UniverseSplit {
  /** Deduped, order-preserving (first occurrence wins). */
  valid: string[];
  /** Symbols rejected by format rules (unique). */
  invalidFormat: string[];
}

/**
 * Split raw ticker strings into valid NASDAQ-style symbols vs obvious junk.
 * Does not consult Cala — only character class / length heuristics.
 */
export function splitHarvestUniverse(raw: string[]): UniverseSplit {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalidFormat: string[] = [];

  for (const r of raw) {
    const t = normalizeCalaTickerSymbol(r);
    if (!t) continue;
    if (seen.has(t)) continue;
    if (!isLikelyCalaNasdaqListedSymbol(t)) {
      invalidFormat.push(t);
      continue;
    }
    seen.add(t);
    valid.push(t);
  }

  return {
    valid,
    invalidFormat: [...new Set(invalidFormat)],
  };
}

export function buildHarvestUniverse(
  base: string[],
  extraCsv: string | undefined,
  extraFromFiles: string[],
): string[] {
  const extraSymbols: string[] = [...extraFromFiles];
  if (extraCsv?.trim()) {
    for (const part of extraCsv.split(/[,\s]+/)) {
      const t = normalizeCalaTickerSymbol(part);
      if (t) extraSymbols.push(t);
    }
  }
  return splitHarvestUniverse([...base, ...extraSymbols]).valid;
}

/** Load tickers from JSON: `{ "tickers": ["A","B"] }` or `["A","B"]`. */
export function loadTickersFromCandidateJson(absPath: string): string[] {
  try {
    const raw = JSON.parse(readFileSync(absPath, "utf-8")) as unknown;
    if (Array.isArray(raw)) {
      return raw.map((x) => (typeof x === "string" ? x : "")).filter(Boolean);
    }
    if (raw && typeof raw === "object" && "tickers" in raw) {
      const t = (raw as { tickers?: unknown }).tickers;
      if (Array.isArray(t)) {
        return t.map((x) => (typeof x === "string" ? x : "")).filter(Boolean);
      }
    }
  } catch {
    /* missing or corrupt */
  }
  return [];
}

export interface LoadedCandidateFile {
  path: string;
  tickers: string[];
}

/**
 * Resolve paths relative to cwd; skip missing files.
 */
export function loadHarvestCandidateFiles(paths: string[], cwd = process.cwd()): LoadedCandidateFile[] {
  const out: LoadedCandidateFile[] = [];
  for (const p of paths) {
    const abs = join(cwd, p);
    if (!existsSync(abs)) continue;
    const tickers = loadTickersFromCandidateJson(abs);
    if (tickers.length) out.push({ path: p, tickers });
  }
  return out;
}

// ── Timestamped bad-ticker persistence ──────────────────────────────

export interface BadTickerEntry {
  ticker: string;
  failedAt: string;
  reason?: string;
}

/**
 * Read bad-tickers file. Handles both legacy (string[]) and timestamped
 * (BadTickerEntry[]) formats gracefully.
 */
export function parseBadTickerFile(absPath: string): BadTickerEntry[] {
  try {
    if (!existsSync(absPath)) return [];
    const raw = JSON.parse(readFileSync(absPath, "utf-8")) as unknown;
    if (!Array.isArray(raw)) return [];
    if (raw.length === 0) return [];

    if (typeof raw[0] === "string") {
      const now = new Date().toISOString();
      return (raw as string[]).map((t) => ({
        ticker: t,
        failedAt: now,
        reason: "legacy_migration",
      }));
    }

    return (raw as BadTickerEntry[]).filter(
      (e) => typeof e.ticker === "string" && typeof e.failedAt === "string",
    );
  } catch {
    return [];
  }
}

export function serializeBadTickerFile(
  absPath: string,
  entries: BadTickerEntry[],
): void {
  const sorted = [...entries].sort((a, b) => a.ticker.localeCompare(b.ticker));
  writeFileSync(absPath, JSON.stringify(sorted, null, 2));
}

/**
 * Return tickers from the bad list that failed more than `olderThanHours` ago
 * (candidates for retry — transient API errors may have resolved).
 */
export function retryableBadTickers(
  entries: BadTickerEntry[],
  olderThanHours: number,
  now = Date.now(),
): string[] {
  if (olderThanHours <= 0) return entries.map((e) => e.ticker);
  return entries
    .filter((e) => {
      const age = now - Date.parse(e.failedAt);
      return Number.isFinite(age) && age > olderThanHours * 3600 * 1000;
    })
    .map((e) => e.ticker);
}

// ── Price DB staleness helpers ──────────────────────────────────────

export function priceDbAgeHours(lastUpdatedIso: string): number | null {
  const t = Date.parse(lastUpdatedIso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / (3600 * 1000);
}

/** When maxAgeHours > 0, true if DB older than threshold or unparseable date. */
export function isPriceDbStale(lastUpdatedIso: string, maxAgeHours: number): boolean {
  if (maxAgeHours <= 0) return false;
  const age = priceDbAgeHours(lastUpdatedIso);
  if (age == null) return true;
  return age > maxAgeHours;
}
