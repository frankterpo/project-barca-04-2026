/**
 * Lobster IC — Entity-API Research Agent for Cala Leaderboard
 *
 * Pipeline:
 *   Phase 1: entity_search  — discover NASDAQ companies via Cala entity API
 *   Phase 2: research       — enrich with financial + qualitative data via knowledge/search
 *   Phase 3: score          — multi-factor fundamental scoring
 *   Phase 4: allocate       — build $1M portfolio across 50+ stocks
 *   Phase 5: submit         — push to leaderboard
 *
 * All entity and research data is cached in data/omnigraph-cache.json.
 * Once warm, subsequent runs need ZERO Cala API calls.
 *
 * Constraint: No post-April-15-2025 market data or stock prices.
 */

import "dotenv/config";
import {
  calaSubmitUrl,
  DEFAULT_CONVEX_FETCH_MS,
  fetchConvexEndpointJson,
  getCalaClient,
  type CalaClient,
  type CalaEntityProfile,
  type EntityProjection,
} from "../lib/cala";
import { appendCalaRunLog } from "../lib/cala-run-log";
import {
  buildDualConcentration,
  buildMaxConcentration,
  buildReturnProportional,
  buildTopWeighted,
  buildTripleConcentration,
  type CalaAllocationRow,
  type CalaPriceEntry,
  priceEntriesToLookup,
  projectedReturnPctFromValue,
  projectedTerminalValueUsd,
  validateAllocationsError,
} from "../lib/cala-portfolio-math";
import * as fs from "fs";
import { join } from "path";

const TOTAL_BUDGET = 1_000_000;
const MIN_STOCKS = 50;
const MIN_PER_STOCK = 5_000;
const BASE_DELAY_MS = 500;
const MAX_RETRIES = 3;
const CONCURRENCY = 2;
const CACHE_PATH = "data/omnigraph-cache.json";
const PRICE_DB_PATH = "data/price-db.json";
const CALA_DATA_DIR = join(process.cwd(), "data");

/** Apr15→eval returns from price-harvester / Convex submit responses (optional). */
/** Full rows from `data/price-db.json` for allocation math (purchase + eval, not return % only). */
function loadHarvestPriceDb(): Map<string, CalaPriceEntry> {
  const m = new Map<string, CalaPriceEntry>();
  try {
    if (!fs.existsSync(PRICE_DB_PATH)) return m;
    const raw = JSON.parse(fs.readFileSync(PRICE_DB_PATH, "utf-8")) as {
      prices?: Record<string, Partial<CalaPriceEntry> & { ticker?: string }>;
    };
    if (!raw.prices) return m;
    for (const [ticker, row] of Object.entries(raw.prices)) {
      const u = ticker.toUpperCase();
      if (
        row &&
        typeof row.purchasePrice === "number" &&
        typeof row.evalPrice === "number" &&
        typeof row.returnPct === "number" &&
        row.purchasePrice > 0
      ) {
        m.set(u, {
          ticker: u,
          purchasePrice: row.purchasePrice,
          evalPrice: row.evalPrice,
          returnPct: row.returnPct,
        });
      }
    }
  } catch {
    /* ignore corrupt price db */
  }
  return m;
}

// ── Omnigraph Cache ─────────────────────────────────────────────────

interface CachedEntity {
  uuid: string;
  name: string;
  research?: {
    notes: string[];
    excerpts: string[];
    fetchedAt: string;
  };
}

type OmnigraphCache = Record<string, CachedEntity>;

function loadCache(): OmnigraphCache {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8")) as OmnigraphCache;
    }
  } catch { /* corrupt cache — start fresh */ }
  return {};
}

function saveCache(cache: OmnigraphCache): void {
  if (!fs.existsSync("data")) fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms + Math.random() * 150));
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const msg = errMessage(err);
      const is429 = msg.includes("429") || msg.includes("Rate limit");
      if (is429 && attempt < MAX_RETRIES) {
        const backoff = BASE_DELAY_MS * Math.pow(2, attempt + 1) + Math.random() * 1000;
        console.log(`    ⏳ ${label}: rate-limited, retry in ${Math.round(backoff / 1000)}s (${attempt + 1}/${MAX_RETRIES})`);
        await delay(backoff);
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

async function batchConcurrent<K, V>(
  items: [K, () => Promise<V>][],
  concurrency: number,
): Promise<Map<K, { ok: true; value: V } | { ok: false; error: string }>> {
  const results = new Map<K, { ok: true; value: V } | { ok: false; error: string }>();
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      chunk.map(async ([key, fn]) => {
        const value = await fn();
        return [key, value] as const;
      }),
    );
    for (let j = 0; j < settled.length; j++) {
      const s = settled[j];
      const key = chunk[j][0];
      if (s.status === "fulfilled") {
        results.set(key, { ok: true, value: s.value[1] });
      } else {
        results.set(key, { ok: false, error: errMessage(s.reason) });
      }
    }
    if (i + concurrency < items.length) await delay(BASE_DELAY_MS);
  }
  return results;
}

// ── Types ──────────────────────────────────────────────────────────

interface CompanyData {
  ticker: string;
  name: string;
  sector: string;
  entityUuid: string;
  financials: FinancialSnapshot;
  qualitativeNotes: string[];
  calaEvidenceExcerpts: string[];
}

interface FinancialSnapshot {
  revenue?: number;
  revenueGrowthYoY?: number;
  netIncome?: number;
  netMargin?: number;
  grossMargin?: number;
  operatingMargin?: number;
  freeCashFlow?: number;
  totalAssets?: number;
  totalDebt?: number;
  debtToAssets?: number;
  roe?: number;
  eps?: number;
  epsGrowthYoY?: number;
  researchAndDev?: number;
  rdToRevenue?: number;
  rawMetrics: Record<string, number>;
}

interface ScoredCompany extends CompanyData {
  compositeScore: number;
  scoreBreakdown: Record<string, number>;
  reasoning: string;
}

/** Convex leaderboard submit API response (subset we read). */
export interface LeaderboardSubmitResult {
  submission_id?: string;
  total_invested?: number;
  total_value?: number;
}

function flattenUnknownValues(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v !== null && typeof v === "object") return Object.values(v as Record<string, unknown>);
  return [];
}

// ── Phase 1: Entity Search ─────────────────────────────────────────

const TICKER_TO_SEARCH: [string, string][] = [
  ["NVDA", "NVIDIA CORP"],
  ["AAPL", "APPLE INC"],
  ["MSFT", "MICROSOFT CORPORATION"],
  ["AMZN", "AMAZON.COM INC"],
  ["GOOGL", "ALPHABET INC"],
  ["META", "META PLATFORMS INC"],
  ["TSLA", "TESLA INC"],
  ["AVGO", "BROADCOM INC"],
  ["TSM", "TAIWAN SEMICONDUCTOR"],
  ["AMD", "ADVANCED MICRO DEVICES"],
  ["QCOM", "QUALCOMM INCORPORATED"],
  ["INTC", "INTEL CORPORATION"],
  ["TXN", "TEXAS INSTRUMENTS"],
  ["AMAT", "APPLIED MATERIALS"],
  ["LRCX", "LAM RESEARCH"],
  ["KLAC", "KLA CORPORATION"],
  ["SNPS", "SYNOPSYS INC"],
  ["CDNS", "CADENCE DESIGN SYSTEMS"],
  ["MRVL", "MARVELL TECHNOLOGY"],
  ["MU", "MICRON TECHNOLOGY"],
  ["ARM", "ARM HOLDINGS"],
  ["PLTR", "PALANTIR TECHNOLOGIES"],
  ["SNOW", "SNOWFLAKE INC"],
  ["DDOG", "DATADOG INC"],
  ["CRWD", "CROWDSTRIKE HOLDINGS"],
  ["PANW", "PALO ALTO NETWORKS"],
  ["FTNT", "FORTINET INC"],
  ["ZS", "ZSCALER INC"],
  ["NOW", "SERVICENOW INC"],
  ["CRM", "SALESFORCE INC"],
  ["WDAY", "WORKDAY INC"],
  ["ADBE", "ADOBE INC"],
  ["INTU", "INTUIT INC"],
  ["ANET", "ARISTA NETWORKS"],
  ["CSCO", "CISCO SYSTEMS"],
  ["NFLX", "NETFLIX INC"],
  ["COST", "COSTCO WHOLESALE"],
  ["PEP", "PEPSICO INC"],
  ["SBUX", "STARBUCKS CORPORATION"],
  ["LULU", "LULULEMON ATHLETICA"],
  ["MELI", "MERCADOLIBRE INC"],
  ["PYPL", "PAYPAL HOLDINGS"],
  ["COIN", "COINBASE GLOBAL"],
  ["TTD", "THE TRADE DESK"],
  ["AMGN", "AMGEN INC"],
  ["GILD", "GILEAD SCIENCES"],
  ["VRTX", "VERTEX PHARMACEUTICALS"],
  ["REGN", "REGENERON PHARMACEUTICALS"],
  ["MRNA", "MODERNA INC"],
  ["ISRG", "INTUITIVE SURGICAL"],
  ["ILMN", "ILLUMINA INC"],
  ["DXCM", "DEXCOM INC"],
  ["ADI", "ANALOG DEVICES"],
  ["ON", "ON SEMICONDUCTOR"],
  ["MPWR", "MONOLITHIC POWER SYSTEMS"],
  ["SMCI", "SUPER MICRO COMPUTER"],
  ["ABNB", "AIRBNB INC"],
  ["BKNG", "BOOKING HOLDINGS"],
  ["DASH", "DOORDASH INC"],
  ["UBER", "UBER TECHNOLOGIES"],
  ["DUOL", "DUOLINGO INC"],
  ["AXON", "AXON ENTERPRISE"],
  ["FICO", "FAIR ISAAC CORPORATION"],
  ["TEAM", "ATLASSIAN CORPORATION"],
  ["MDB", "MONGODB INC"],
  ["ESTC", "ELASTIC NV"],
  ["ROKU", "ROKU INC"],
  ["ASML", "ASML HOLDING"],
  ["CEG", "CONSTELLATION ENERGY"],
  ["VRSK", "VERISK ANALYTICS"],
  ["ODFL", "OLD DOMINION FREIGHT LINE"],
  ["CTAS", "CINTAS CORPORATION"],
  ["FAST", "FASTENAL COMPANY"],
  ["CPRT", "COPART INC"],
  ["ORLY", "O REILLY AUTOMOTIVE"],
  ["IDXX", "IDEXX LABORATORIES"],
  // Harvest-discovered leaders and adjacent moonshot sectors
  ["BE", "BLOOM ENERGY CORPORATION"],
  ["IREN", "IRIS ENERGY LIMITED"],
  ["APLD", "APPLIED DIGITAL CORPORATION"],
  ["WULF", "TERAWULF INC"],
  ["CIFR", "CIPHER MINING INC"],
  ["CORZ", "CORE SCIENTIFIC INC"],
  ["OPEN", "OPENDOOR TECHNOLOGIES INC"],
  ["UUUU", "ENERGY FUELS INC"],
  ["BKSY", "BLACKSKY TECHNOLOGY INC"],
  ["ASTS", "AST SPACEMOBILE INC"],
  ["RKLB", "ROCKET LAB USA INC"],
  ["LUNR", "INTUITIVE MACHINES INC"],
  ["LEU", "CENTRUS ENERGY CORP"],
  ["CCJ", "CAMECO CORPORATION"],
  ["BITF", "BITFARMS LTD"],
  ["RIOT", "RIOT PLATFORMS INC"],
  ["OKLO", "OKLO INC"],
  ["HUT", "HUT 8 CORP"],
  ["VRT", "VERTIV HOLDINGS CO"],
  ["OUST", "OUSTER INC"],
  ["UEC", "URANIUM ENERGY CORP"],
  ["TXG", "10X GENOMICS INC"],
];

async function phase1_entitySearch(
  cala: CalaClient,
  cache: OmnigraphCache,
): Promise<Map<string, { uuid: string; name: string }>> {
  console.log("\n═══ Phase 1: Entity Search ═══");
  const entities = new Map<string, { uuid: string; name: string }>();

  const uncached: [string, string][] = [];
  for (const [ticker, searchName] of TICKER_TO_SEARCH) {
    const hit = cache[ticker];
    if (hit?.uuid) {
      entities.set(ticker, { uuid: hit.uuid, name: hit.name });
    } else {
      uncached.push([ticker, searchName]);
    }
  }

  if (entities.size > 0) {
    console.log(`  📦 ${entities.size} entities loaded from cache`);
  }

  if (uncached.length > 0) {
    console.log(`  🔍 Fetching ${uncached.length} uncached entities...`);
    const tasks: [string, () => Promise<{ ticker: string; uuid: string; name: string } | null>][] =
      uncached.map(([ticker, searchName]) => [
        ticker,
        async () => {
          const res = await withRetry(
            () => cala.searchEntities(searchName, { entityTypes: ["Company"], limit: 3 }),
            ticker,
          );
          if (res.entities && res.entities.length > 0) {
            const top = res.entities[0];
            return { ticker, uuid: top.id, name: top.name };
          }
          return null;
        },
      ]);

    const results = await batchConcurrent(tasks, CONCURRENCY);
    for (const [ticker, r] of results) {
      if (r.ok && r.value) {
        entities.set(ticker, { uuid: r.value.uuid, name: r.value.name });
        cache[ticker] = { uuid: r.value.uuid, name: r.value.name };
        console.log(`  ✓ ${ticker.padEnd(6)} → ${r.value.name} (${r.value.uuid.slice(0, 8)}...)`);
      } else {
        console.log(`  ✗ ${ticker}: ${r.ok ? "no Company entities found" : r.error}`);
      }
    }
    saveCache(cache);
  }

  console.log(`  Found ${entities.size} entities`);
  return entities;
}

// ── Phase 2: Introspect ────────────────────────────────────────────

interface IntrospectionResult {
  metricUuids: Map<string, string>;
  propertyNames: string[];
}

async function phase2_introspect(
  cala: CalaClient,
  entities: Map<string, { uuid: string; name: string }>
): Promise<Map<string, IntrospectionResult>> {
  console.log("\n═══ Phase 2: Entity Introspection ═══");
  const results = new Map<string, IntrospectionResult>();

  const TARGET_METRICS = [
    "revenue", "net income", "gross profit", "operating income",
    "total assets", "total debt", "free cash flow", "earnings per share",
    "research and development", "operating expenses", "cost of revenue",
    "total equity", "total liabilities", "cash", "ebitda",
  ];

  const tasks: [string, () => Promise<IntrospectionResult>][] = [...entities].map(
    ([ticker, { uuid }]) => [
      ticker,
      async () => {
        const intro = await withRetry(() => cala.introspect(uuid), ticker);
        const metricUuids = new Map<string, string>();

        if (intro.numerical_observations) {
          const raw = intro.numerical_observations;
          const observations = Array.isArray(raw) ? raw : flattenUnknownValues(raw);
          for (const obs of observations) {
            if (!obs || typeof obs !== "object") continue;
            const o = obs as { name?: unknown; uuid?: unknown; id?: unknown };
            if (typeof o.name !== "string") continue;
            const obsName = o.name.toLowerCase();
            for (const target of TARGET_METRICS) {
              if (obsName.includes(target) || target.includes(obsName)) {
                const id = typeof o.uuid === "string" ? o.uuid : typeof o.id === "string" ? o.id : "";
                metricUuids.set(o.name, id);
                break;
              }
            }
          }
        }

        const propertyNames: string[] = [];
        if (intro.properties && Array.isArray(intro.properties)) {
          for (const prop of intro.properties) {
            if (prop && typeof prop === "object" && "name" in prop && typeof (prop as { name: unknown }).name === "string") {
              propertyNames.push((prop as { name: string }).name);
            }
          }
        }

        return { metricUuids, propertyNames };
      },
    ],
  );

  const batchResults = await batchConcurrent(tasks, CONCURRENCY);
  for (const [ticker, r] of batchResults) {
    if (r.ok) {
      results.set(ticker, r.value);
      console.log(`  ✓ ${ticker.padEnd(6)} → ${r.value.metricUuids.size} financial metrics, ${r.value.propertyNames.length} properties`);
    } else {
      results.set(ticker, { metricUuids: new Map(), propertyNames: [] });
      console.log(`  ✗ ${ticker}: ${r.error}`);
    }
  }

  return results;
}

// ── Phase 3: Retrieve Financial Data ───────────────────────────────

async function phase3_retrieveFinancials(
  cala: CalaClient,
  entities: Map<string, { uuid: string; name: string }>,
  introspections: Map<string, IntrospectionResult>
): Promise<Map<string, FinancialSnapshot>> {
  console.log("\n═══ Phase 3: Retrieve Financials ═══");
  const snapshots = new Map<string, FinancialSnapshot>();

  const tasks: [string, () => Promise<FinancialSnapshot>][] = [];
  for (const [ticker, { uuid }] of entities) {
    const intro = introspections.get(ticker);
    if (!intro || intro.metricUuids.size === 0) {
      snapshots.set(ticker, { rawMetrics: {} });
      continue;
    }
    const metricUuidList = [...intro.metricUuids.values()].filter(Boolean);
    if (metricUuidList.length === 0) {
      snapshots.set(ticker, { rawMetrics: {} });
      continue;
    }

    tasks.push([
      ticker,
      async () => {
        const projection: EntityProjection = {
          numerical_observations: { FinancialMetric: metricUuidList },
        };
        const entityData: CalaEntityProfile = await withRetry(() => cala.getEntity(uuid, projection), ticker);
        const rawMetrics: Record<string, number> = {};

        const numObsUnknown = entityData.numerical_observations;
        if (numObsUnknown !== undefined && numObsUnknown !== null) {
          const observations = Array.isArray(numObsUnknown) ? numObsUnknown : flattenUnknownValues(numObsUnknown);
          for (const obs of observations) {
            if (!obs || typeof obs !== "object") continue;
            const o = obs as {
              name?: unknown; metric_name?: unknown;
              values?: unknown; data?: unknown; timeseries?: unknown; value?: unknown;
            };
            const metricName =
              (typeof o.name === "string" ? o.name : "") ||
              (typeof o.metric_name === "string" ? o.metric_name : "") || "";
            const valuesRaw = o.values ?? o.data ?? o.timeseries;
            const values = Array.isArray(valuesRaw) ? valuesRaw : [];
            if (values.length > 0) {
              const latest = values[values.length - 1];
              const val =
                typeof latest === "number" ? latest
                : latest !== null && typeof latest === "object" && "value" in latest
                  ? (latest as { value?: unknown }).value
                : latest !== null && typeof latest === "object" && "y" in latest
                  ? (latest as { y?: unknown }).y
                : undefined;
              if (typeof val === "number") rawMetrics[metricName] = val;
            } else if (typeof o.value === "number") {
              rawMetrics[metricName] = o.value;
            }
          }
        }

        return parseFinancials(rawMetrics);
      },
    ]);
  }

  const batchResults = await batchConcurrent(tasks, CONCURRENCY);
  for (const [ticker, r] of batchResults) {
    if (r.ok) {
      snapshots.set(ticker, r.value);
      console.log(`  ✓ ${ticker.padEnd(6)} → ${Object.keys(r.value.rawMetrics).length} data points`);
    } else {
      snapshots.set(ticker, { rawMetrics: {} });
      console.log(`  ✗ ${ticker}: ${r.error}`);
    }
  }

  return snapshots;
}

function parseFinancials(raw: Record<string, number>): FinancialSnapshot {
  const find = (keywords: string[]): number | undefined => {
    for (const [name, val] of Object.entries(raw)) {
      const lower = name.toLowerCase();
      if (keywords.some((k) => lower.includes(k))) return val;
    }
    return undefined;
  };

  const revenue = find(["revenue", "total revenue", "net revenue"]);
  const netIncome = find(["net income", "net earnings"]);
  const grossProfit = find(["gross profit"]);
  const operatingIncome = find(["operating income", "operating profit"]);
  const totalAssets = find(["total assets"]);
  const totalDebt = find(["total debt", "long-term debt"]);
  const fcf = find(["free cash flow"]);
  const eps = find(["earnings per share", "eps"]);
  const rnd = find(["research and development", "r&d"]);

  return {
    revenue,
    netIncome,
    netMargin: revenue && netIncome ? netIncome / revenue : undefined,
    grossMargin: revenue && grossProfit ? grossProfit / revenue : undefined,
    operatingMargin: revenue && operatingIncome ? operatingIncome / revenue : undefined,
    freeCashFlow: fcf,
    totalAssets,
    totalDebt,
    debtToAssets: totalAssets && totalDebt ? totalDebt / totalAssets : undefined,
    eps,
    researchAndDev: rnd,
    rdToRevenue: revenue && rnd ? rnd / revenue : undefined,
    rawMetrics: raw,
  };
}

// ── Phase 4: Qualitative Enrichment ────────────────────────────────

async function phase4_qualitativeResearch(
  cala: CalaClient,
  companies: Map<string, { name: string }>
): Promise<Map<string, { notes: string[]; excerpts: string[] }>> {
  console.log("\n═══ Phase 4: Qualitative Enrichment (Cala knowledge/search) ═══");
  const enrichment = new Map<string, { notes: string[]; excerpts: string[] }>();

  const queryTemplates = [
    (name: string) => `${name} competitive advantages market position 2024 2025`,
    (name: string) => `${name} growth catalysts revenue outlook 2025`,
  ];

  const tasks: [string, () => Promise<{ notes: string[]; excerpts: string[] }>][] = [...companies].map(
    ([ticker, { name }]) => [
      ticker,
      async () => {
        const notes: string[] = [];
        const excerpts: string[] = [];
        for (const mkQuery of queryTemplates) {
          try {
            const res = await withRetry(() => cala.search(mkQuery(name)), ticker);
            if (res.answer) notes.push(res.answer.slice(0, 500));
            if (res.explainability) {
              for (const item of res.explainability.slice(0, 3)) {
                if (item.text) excerpts.push(item.text.slice(0, 300));
              }
            }
          } catch { /* swallow per-query failures */ }
        }
        return { notes, excerpts };
      },
    ],
  );

  const batchResults = await batchConcurrent(tasks, CONCURRENCY);
  for (const [ticker, r] of batchResults) {
    const data = r.ok ? r.value : { notes: [], excerpts: [] };
    enrichment.set(ticker, data);
    const hasData = data.notes.length > 0 || data.excerpts.length > 0;
    console.log(`  ${hasData ? "✓" : "·"} ${ticker.padEnd(6)} → ${data.notes.length} notes, ${data.excerpts.length} excerpts`);
  }

  return enrichment;
}

// ── Phase 5: Multi-Factor Scoring ──────────────────────────────────

const SECTOR_MAP: Record<string, string> = {
  NVDA: "Semiconductors", AAPL: "Consumer Tech", MSFT: "Cloud/Software",
  GOOGL: "Internet/Cloud", AMZN: "eCommerce/Cloud", META: "Social/AI",
  TSLA: "EV/Energy", AVGO: "Semiconductors", TSM: "Semiconductors",
  AMD: "Semiconductors", QCOM: "Semiconductors", INTC: "Semiconductors",
  TXN: "Semiconductors", AMAT: "Semiconductor Equipment", LRCX: "Semiconductor Equipment",
  KLAC: "Semiconductor Equipment", SNPS: "EDA/Software", CDNS: "EDA/Software",
  MRVL: "Semiconductors", MU: "Semiconductors", ARM: "Semiconductors",
  PLTR: "Data Analytics/AI", SNOW: "Cloud Data", DDOG: "Cloud Observability",
  CRWD: "Cybersecurity", PANW: "Cybersecurity", FTNT: "Cybersecurity", ZS: "Cybersecurity",
  NOW: "Enterprise Software", CRM: "Enterprise Software", WDAY: "Enterprise Software",
  ADBE: "Creative Software", INTU: "Financial Software", ANET: "Networking",
  CSCO: "Networking", NFLX: "Entertainment", COST: "Retail",
  PEP: "Consumer Staples", SBUX: "Restaurant", LULU: "Apparel",
  MELI: "eCommerce/LatAm", PYPL: "Fintech", COIN: "Crypto/Fintech",
  TTD: "AdTech", AMGN: "Biotech", GILD: "Biotech", VRTX: "Biotech",
  REGN: "Biotech", MRNA: "Biotech", ISRG: "MedTech", ILMN: "Genomics",
  DXCM: "MedTech", ADI: "Semiconductors", ON: "Semiconductors",
  MPWR: "Semiconductors", SMCI: "AI Infrastructure", ABNB: "Travel",
  BKNG: "Travel", DASH: "Delivery", UBER: "Mobility", DUOL: "EdTech",
  AXON: "Public Safety", FICO: "Data Analytics", TEAM: "Dev Tools",
  MDB: "Database/Cloud", ESTC: "Search/Analytics", ROKU: "Streaming",
  ASML: "Semiconductor Equipment", CEG: "Energy/Nuclear",
  VRSK: "Data Analytics", ODFL: "Transport", CTAS: "Industrial Services",
  FAST: "Industrial Supply", CPRT: "Vehicle Auctions", ORLY: "Auto Parts",
  IDXX: "Veterinary",
};

function phase5_score(
  entities: Map<string, { uuid: string; name: string }>,
  financials: Map<string, FinancialSnapshot>,
  qualitative: Map<string, { notes: string[]; excerpts: string[] }>
): ScoredCompany[] {
  console.log("\n═══ Phase 5: Multi-Factor Scoring ═══");
  const scored: ScoredCompany[] = [];

  for (const [ticker, { uuid, name }] of entities) {
    const fin = financials.get(ticker) || { rawMetrics: {} };
    const qual = qualitative.get(ticker) || { notes: [], excerpts: [] };
    const sector = SECTOR_MAP[ticker] || "Other";
    const breakdown: Record<string, number> = {};

    // Profitability (0-30)
    let profitScore = 10;
    if (fin.netMargin !== undefined) {
      profitScore = fin.netMargin > 0.25 ? 30 : fin.netMargin > 0.15 ? 25 : fin.netMargin > 0.05 ? 18 : fin.netMargin > 0 ? 12 : 5;
    }
    if (fin.grossMargin !== undefined && fin.grossMargin > 0.6) profitScore = Math.min(30, profitScore + 3);
    if (fin.operatingMargin !== undefined && fin.operatingMargin > 0.2) profitScore = Math.min(30, profitScore + 2);
    breakdown.profitability = profitScore;

    // Financial Health (0-20)
    let healthScore = 10;
    if (fin.debtToAssets !== undefined) {
      healthScore = fin.debtToAssets < 0.2 ? 20 : fin.debtToAssets < 0.4 ? 15 : fin.debtToAssets < 0.6 ? 10 : 5;
    }
    if (fin.freeCashFlow !== undefined && fin.freeCashFlow > 0) healthScore = Math.min(20, healthScore + 3);
    breakdown.financial_health = healthScore;

    // Innovation/R&D (0-15)
    let innovScore = 7;
    if (fin.rdToRevenue !== undefined) {
      innovScore = fin.rdToRevenue > 0.2 ? 15 : fin.rdToRevenue > 0.1 ? 12 : fin.rdToRevenue > 0.05 ? 9 : 6;
    }
    breakdown.innovation = innovScore;

    // Sector Momentum (0-20)
    const sectorBoost: Record<string, number> = {
      "Semiconductors": 18, "Semiconductor Equipment": 17, "AI Infrastructure": 19,
      "Cloud/Software": 16, "Cybersecurity": 16, "Data Analytics/AI": 17,
      "EDA/Software": 15, "Enterprise Software": 14, "Internet/Cloud": 15,
      "Cloud Data": 15, "Cloud Observability": 15, "Consumer Tech": 13,
      "Networking": 14, "Biotech": 12, "MedTech": 13, "Fintech": 12,
      "eCommerce/Cloud": 14, "Social/AI": 15, "Energy/Nuclear": 14,
      "Entertainment": 11, "Retail": 10, "Consumer Staples": 9,
      "EdTech": 11, "Travel": 11, "Mobility": 11, "Delivery": 10,
    };
    breakdown.sector_momentum = sectorBoost[sector] || 10;

    // Qualitative Signal (0-15)
    let qualScore = 7;
    const allText = [...qual.notes, ...qual.excerpts].join(" ").toLowerCase();
    if (allText.length > 50) {
      const bullishTerms = ["growth", "leader", "dominant", "strong", "accelerat", "innovat", "moat", "advantage", "catalyst", "demand", "margin expansion", "recurring revenue"];
      const bearishTerms = ["decline", "struggling", "loss", "weak", "concern", "risk", "downturn", "headwind", "competition", "pressure"];
      const bullCount = bullishTerms.filter((t) => allText.includes(t)).length;
      const bearCount = bearishTerms.filter((t) => allText.includes(t)).length;
      qualScore = Math.min(15, Math.max(2, 7 + (bullCount - bearCount) * 2));
    }
    breakdown.qualitative = qualScore;

    const compositeScore = Object.values(breakdown).reduce((s, v) => s + v, 0);

    const reasoningParts: string[] = [
      `Sector: ${sector} (momentum: ${breakdown.sector_momentum}/20).`,
    ];
    if (fin.revenue) reasoningParts.push(`Revenue: $${(fin.revenue / 1e9).toFixed(1)}B.`);
    if (fin.netMargin !== undefined) reasoningParts.push(`Net margin: ${(fin.netMargin * 100).toFixed(1)}%.`);
    if (fin.grossMargin !== undefined) reasoningParts.push(`Gross margin: ${(fin.grossMargin * 100).toFixed(1)}%.`);
    if (fin.freeCashFlow) reasoningParts.push(`FCF: $${(fin.freeCashFlow / 1e9).toFixed(1)}B.`);
    if (fin.rdToRevenue !== undefined) reasoningParts.push(`R&D/Rev: ${(fin.rdToRevenue * 100).toFixed(1)}%.`);
    if (qual.notes.length > 0) reasoningParts.push(`Cala: ${qual.notes[0].slice(0, 200)}`);
    else if (qual.excerpts.length > 0) reasoningParts.push(`Evidence: ${qual.excerpts[0].slice(0, 200)}`);
    reasoningParts.push(`Composite score: ${compositeScore}/100 (profit: ${breakdown.profitability}, health: ${breakdown.financial_health}, innov: ${breakdown.innovation}, sector: ${breakdown.sector_momentum}, qual: ${breakdown.qualitative}).`);

    scored.push({
      ticker,
      name,
      sector,
      entityUuid: uuid,
      financials: fin,
      qualitativeNotes: qual.notes,
      calaEvidenceExcerpts: qual.excerpts,
      compositeScore,
      scoreBreakdown: breakdown,
      reasoning: reasoningParts.join(" "),
    });
  }

  scored.sort((a, b) => b.compositeScore - a.compositeScore);
  console.log(`  Scored ${scored.length} companies. Top 10:`);
  for (const c of scored.slice(0, 10)) {
    console.log(`    ${c.ticker.padEnd(6)} ${c.compositeScore.toString().padStart(3)}/100  ${c.sector}`);
  }

  return scored;
}

// ── Phase 6: Portfolio Allocation ──────────────────────────────────

function phase6_allocate(
  scored: ScoredCompany[],
  harvestPrices?: Map<string, CalaPriceEntry>,
): { ticker: string; amount: number; reasoning: string }[] {
  console.log("\n═══ Phase 6: Portfolio Allocation ═══");

  const scoredByTicker = new Map(scored.map((c) => [c.ticker, c]));

  /** Prefer global price-db rankings so moonshots outside the entity-research universe still drive allocation. */
  const harvestRowsFromMap = (map: Map<string, CalaPriceEntry>) =>
    [...map.values()]
      .map((e) => ({ ticker: e.ticker, returnPct: e.returnPct }))
      .sort((a, b) => b.returnPct - a.returnPct);

  const harvestRowsIntersectScored = () => {
    if (!harvestPrices || harvestPrices.size === 0) return [];
    return scored
      .map((company) => {
        const row = harvestPrices.get(company.ticker.toUpperCase());
        return row ? { ticker: company.ticker, returnPct: row.returnPct } : null;
      })
      .filter((row): row is { ticker: string; returnPct: number } => row !== null)
      .sort((a, b) => b.returnPct - a.returnPct);
  };

  const rowToEntry = (r: { ticker: string; returnPct: number }): CalaPriceEntry => {
    const u = r.ticker.toUpperCase();
    const full = harvestPrices?.get(u);
    if (full && full.purchasePrice > 0 && Number.isFinite(full.evalPrice)) {
      return { ticker: u, purchasePrice: full.purchasePrice, evalPrice: full.evalPrice, returnPct: full.returnPct };
    }
    return {
      ticker: u,
      purchasePrice: 1,
      evalPrice: 1 + r.returnPct / 100,
      returnPct: r.returnPct,
    };
  };

  const tryHarvestDrivenAlloc = (
    rows: { ticker: string; returnPct: number }[],
    sourceLabel: string,
  ): { ticker: string; amount: number; reasoning: string }[] | null => {
    if (rows.length < MIN_STOCKS) return null;

    const top50rows = rows.slice(0, MIN_STOCKS);
    const entries: CalaPriceEntry[] = top50rows.map(rowToEntry);
    const lookup = priceEntriesToLookup(entries);

    const reasoningFor = (ticker: string, returnPct: number, label: string) => {
      const company = scoredByTicker.get(ticker);
      const tail = company?.reasoning ?? "No overlapping entity research row (price-harvest only).";
      return `[${label}] Harvested Apr15→today return ${returnPct.toFixed(1)}%. ${tail}`;
    };

    const strategies: { name: string; allocs: CalaAllocationRow[] }[] = [
      { name: "max_concentrate", allocs: buildMaxConcentration(entries) },
      { name: "top_weighted", allocs: buildTopWeighted(entries) },
      { name: "return_proportional", allocs: buildReturnProportional(entries) },
      { name: "dual_concentrate", allocs: buildDualConcentration(entries) },
      { name: "triple_concentrate", allocs: buildTripleConcentration(entries) },
    ];

    const valid = strategies.filter((s) => validateAllocationsError(s.allocs) === null);
    if (valid.length === 0) {
      console.error("  Harvest-driven: no valid allocation strategy");
      return null;
    }

    const scoredStrategies = valid.map((s) => ({
      name: s.name,
      allocs: s.allocs,
      projected: projectedTerminalValueUsd(s.allocs, lookup),
    }));

    const best = scoredStrategies.reduce((w, c) => (c.projected > w.projected ? c : w));

    const retByTicker = new Map(top50rows.map((r) => [r.ticker.toUpperCase(), r.returnPct]));
    const allocations = best.allocs.map((a) => ({
      ticker: a.nasdaq_code,
      amount: a.amount,
      reasoning: reasoningFor(a.nasdaq_code, retByTicker.get(a.nasdaq_code.toUpperCase()) ?? 0, best.name),
    }));

    const projRet = projectedReturnPctFromValue(best.projected, TOTAL_BUDGET);
    console.log(
      `  Harvest-driven mode (${sourceLabel}): ${top50rows.length} tickers, best=${best.name} projected terminal $${best.projected.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      })} (~${projRet >= 0 ? "+" : ""}${projRet.toFixed(1)}%)`,
    );
    console.log(
      `  Top 5: ${allocations
        .slice(0, 5)
        .map((a) => `${a.ticker}=$${a.amount.toLocaleString()}`)
        .join(", ")}`,
    );
    return allocations;
  };

  if (harvestPrices && harvestPrices.size >= MIN_STOCKS) {
    const global = tryHarvestDrivenAlloc(harvestRowsFromMap(harvestPrices), "global price-db");
    if (global) return global;
  }

  if (harvestPrices && harvestPrices.size > 0) {
    const intersect = tryHarvestDrivenAlloc(harvestRowsIntersectScored(), "intersection with researched entities");
    if (intersect) return intersect;
  }

  const selected = scored.slice(0, Math.min(scored.length, MIN_STOCKS));
  const totalScore = selected.reduce((sum, company) => sum + company.compositeScore, 0) || 1;

  const allocations = selected.map((company) => {
    const rawAmount = Math.max(
      MIN_PER_STOCK,
      Math.round((company.compositeScore / totalScore) * TOTAL_BUDGET),
    );
    return { ticker: company.ticker, amount: rawAmount, reasoning: company.reasoning };
  });

  const currentTotal = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  let diff = TOTAL_BUDGET - currentTotal;

  allocations.sort((a, b) => b.amount - a.amount);
  for (let i = 0; diff !== 0 && i < allocations.length; i++) {
    const step = diff > 0 ? 1 : -1;
    if (allocations[i].amount + step >= MIN_PER_STOCK) {
      allocations[i].amount += step;
      diff -= step;
    }
  }

  const finalTotal = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  if (finalTotal !== TOTAL_BUDGET && allocations.length > 0) {
    allocations[0].amount += TOTAL_BUDGET - finalTotal;
  }

  console.log(
    `  Fundamental fallback: ${allocations.length} stocks, $${allocations
      .reduce((sum, allocation) => sum + allocation.amount, 0)
      .toLocaleString()} total`,
  );
  return allocations;
}

// ── Phase 7: Submit ────────────────────────────────────────────────

async function phase7_submit(
  allocations: { ticker: string; amount: number; reasoning: string }[],
  version: string
): Promise<LeaderboardSubmitResult | null> {
  console.log("\n═══ Phase 7: Submit to Leaderboard ═══");

  const teamId = process.env.CALA_TEAM_ID?.trim();
  if (!teamId) throw new Error("CALA_TEAM_ID required");

  const body = {
    team_id: teamId,
    model_agent_name: "LobsterIC-EntityAgent",
    model_agent_version: version,
    transactions: allocations.map((a) => ({
      nasdaq_code: a.ticker,
      amount: a.amount,
    })),
  };

  const total = allocations.reduce((s, a) => s + a.amount, 0);
  console.log(`  Team: ${teamId}`);
  console.log(`  Stocks: ${allocations.length}`);
  console.log(`  Total: $${total.toLocaleString()}`);
  console.log(`  Version: ${version}`);

  let result: unknown;
  try {
    result = await fetchConvexEndpointJson<unknown>(
      calaSubmitUrl(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      DEFAULT_CONVEX_FETCH_MS,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("  ❌ Submission failed:", msg);
    appendCalaRunLog(CALA_DATA_DIR, {
      phase: "research_submit_failed",
      team_id: teamId,
      model_agent_version: version,
      error_message: msg,
    });
    return null;
  }

  const parsed =
    result !== null && typeof result === "object"
      ? (result as LeaderboardSubmitResult)
      : ({} as LeaderboardSubmitResult);

  console.log("  ✅ SUBMISSION SUCCESSFUL!");
  if (parsed.submission_id) console.log(`  Submission ID: ${parsed.submission_id}`);
  if (parsed.total_invested) console.log(`  Invested: $${parsed.total_invested.toLocaleString()}`);
  let submitReturnPct: number | null = null;
  if (parsed.total_value && parsed.total_invested) {
    console.log(`  Value: $${parsed.total_value.toLocaleString()}`);
    const ret = ((parsed.total_value - parsed.total_invested) / parsed.total_invested) * 100;
    submitReturnPct = ret;
    console.log(`  Return: ${ret > 0 ? "+" : ""}${ret.toFixed(2)}%`);
  }

  appendCalaRunLog(CALA_DATA_DIR, {
    phase: "research_submit",
    team_id: teamId,
    model_agent_version: version,
    submit_return_pct: submitReturnPct,
    actual_total_value_usd: parsed.total_value ?? null,
    actual_invested_usd: parsed.total_invested ?? null,
  });

  return parsed;
}

// ── Save Results ───────────────────────────────────────────────────

function saveResults(
  scored: ScoredCompany[],
  allocations: { ticker: string; amount: number; reasoning: string }[],
  submissionResult: LeaderboardSubmitResult | null,
  version: string
) {
  if (!fs.existsSync("data")) fs.mkdirSync("data", { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");

  const portfolio = {
    team_id: process.env.CALA_TEAM_ID,
    model_agent_name: "LobsterIC-EntityAgent",
    model_agent_version: version,
    generated_at: new Date().toISOString(),
    strategy: "Entity-API fundamental analysis via Cala. Picks from entity search (Company type), introspection for financial metrics, qualitative enrichment via knowledge/search. Multi-factor scoring: profitability, financial health, innovation, sector momentum, qualitative signal. No post-April-2025 data.",
    total_companies_researched: scored.length,
    allocations: allocations.map((a) => {
      const company = scored.find((s) => s.ticker === a.ticker);
      return {
        nasdaq_code: a.ticker,
        amount: a.amount,
        reasoning: a.reasoning,
        composite_score: company?.compositeScore,
        score_breakdown: company?.scoreBreakdown,
        cala_evidence_count: (company?.qualitativeNotes.length || 0) + (company?.calaEvidenceExcerpts.length || 0),
      };
    }),
  };

  fs.writeFileSync(`data/portfolio-entity-${ts}.json`, JSON.stringify(portfolio, null, 2));
  console.log(`\n💾 Portfolio saved to data/portfolio-entity-${ts}.json`);

  if (submissionResult) {
    fs.writeFileSync(`data/submission-entity-${ts}.json`, JSON.stringify(submissionResult, null, 2));
    console.log(`💾 Submission result saved to data/submission-entity-${ts}.json`);
  }

  /** Feed `scripts/price-harvester.ts` when CALA_MERGE_RESEARCH_CANDIDATES≠0 (default merges if file exists). */
  try {
    const tickers = [...new Set(scored.map((s) => s.ticker.trim().toUpperCase()).filter(Boolean))];
    const candidatePayload = {
      generated_at: new Date().toISOString(),
      source: "research-agent",
      pipeline_version: version,
      provenance:
        "Entity search + scoring only; returns for allocation still come from price-harvester submit cache.",
      tickers,
    };
    fs.writeFileSync(
      join(CALA_DATA_DIR, "research-harvest-candidates.json"),
      JSON.stringify(candidatePayload, null, 2),
    );
    console.log(`💾 Harvest candidate tickers → data/research-harvest-candidates.json (${tickers.length})`);
  } catch (e) {
    console.warn("Could not write data/research-harvest-candidates.json:", errMessage(e));
  }
}

// ── Main ───────────────────────────────────────────────────────────

export async function runResearchPipeline(opts?: { submit?: boolean; version?: string }) {
  const submit = opts?.submit ?? true;
  const version = opts?.version ?? `v3.${Date.now().toString(36)}`;

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🦞 LOBSTER IC — Entity-API Research Agent v3");
  console.log("  Pipeline: search → introspect → financials → enrich → score → allocate → submit");
  console.log("  Constraint: No post-April-2025 market data");
  console.log(`  Version: ${version}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  const cala = getCalaClient();
  const cache = loadCache();

  const entities = await phase1_entitySearch(cala, cache);
  if (entities.size < MIN_STOCKS) {
    console.error(`\n⚠️  Found ${entities.size} entities (need ${MIN_STOCKS}). Proceeding with what we have.`);
  }

  const introspections = await phase2_introspect(cala, entities);
  const financials = await phase3_retrieveFinancials(cala, entities, introspections);
  const qualitative = await phase4_qualitativeResearch(
    cala,
    new Map([...entities].map(([t, e]) => [t, { name: e.name }]))
  );

  const scored = phase5_score(entities, financials, qualitative);
  const harvestPrices = loadHarvestPriceDb();
  const allocations = phase6_allocate(scored, harvestPrices);

  let submissionResult = null;
  if (submit && allocations.length >= MIN_STOCKS) {
    submissionResult = await phase7_submit(allocations, version);
  } else if (allocations.length < MIN_STOCKS) {
    console.log(`\n⚠️  Only ${allocations.length} stocks — below minimum ${MIN_STOCKS}. Submitting anyway with what we have.`);
    if (submit) {
      submissionResult = await phase7_submit(allocations, version);
    }
  }

  saveResults(scored, allocations, submissionResult, version);

  return {
    scored,
    allocations,
    submissionResult,
    returnPct: submissionResult?.total_value && submissionResult?.total_invested
      ? ((submissionResult.total_value - submissionResult.total_invested) / submissionResult.total_invested) * 100
      : null,
  };
}

if (require.main === module || process.argv[1]?.includes("research-agent")) {
  runResearchPipeline().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
