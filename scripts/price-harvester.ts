/**
 * Price Harvester: submit batches to collect purchase_prices_apr15 & eval_prices_today,
 * then compute per-stock returns and build the optimal portfolio.
 *
 * Usage:
 *   pnpm tsx scripts/price-harvester.ts --harvest     # collect prices from all batches
 *   pnpm tsx scripts/price-harvester.ts --optimize    # build & submit optimal portfolio from cached prices
 *   pnpm tsx scripts/price-harvester.ts --show        # show cached price data and rankings
 *   pnpm tsx scripts/price-harvester.ts --optimize --dry-run   # preview best strategy, no POST
 *   pnpm tsx scripts/price-harvester.ts --leaderboard          # print scoreboard (no submit)
 */

import "dotenv/config";
import {
  calaLeaderboardUrlCandidates,
  calaSubmitUrl,
  fetchCalaLeaderboardRows,
  fetchConvexEndpointJson,
  leaderboardRowReturnPct,
  leaderboardRowTeamId,
  summarizeLeaderboardForTeam,
  tryFetchCalaLeaderboardRows,
} from "@/lib/cala";
import { appendCalaRunLog } from "@/lib/cala-run-log";
import {
  CALA_PORTFOLIO_MIN_STOCKS as MIN_STOCKS,
  CALA_PORTFOLIO_TOTAL_BUDGET as TOTAL_BUDGET,
  type CalaAllocationRow,
  type CalaPortfolioAudit,
  type CalaPriceEntry,
  auditAllocations,
  buildDualConcentration,
  buildEqualAllocations,
  buildMaxConcentration,
  buildReturnProportional,
  buildTopWeighted,
  buildTripleConcentration,
  priceEntriesToLookup,
  projectedTerminalValueUsd,
  validateAllocationsError as validateAllocations,
} from "@/lib/cala-portfolio-math";
import {
  type BadTickerEntry,
  buildHarvestUniverse,
  loadHarvestCandidateFiles,
  parseBadTickerFile,
  priceDbAgeHours,
  retryableBadTickers,
  serializeBadTickerFile,
  splitHarvestUniverse,
} from "@/lib/cala-ticker-universe";

type Allocation = CalaAllocationRow;
type PriceEntry = CalaPriceEntry & { lastHarvestedAt?: string };
type PortfolioAudit = CalaPortfolioAudit;
import { getOmnigraphClient, probeOmnigraphHealth } from "@/lib/omnigraph/client";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "fs";
import { join } from "path";

function submitUrl(): string {
  return calaSubmitUrl();
}

function toNumOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const FETCH_TIMEOUT_MS = Number(process.env.CALA_FETCH_TIMEOUT_MS ?? 120_000);
const HARVEST_RETRY_LIMIT = 10;
const BATCH_DELAY_MS = Number(process.env.CALA_BATCH_DELAY_MS ?? 2_000);

const CONCURRENCY = Number(process.env.CALA_HARVEST_CONCURRENCY ?? 5);

function resolveDataDir(): string {
  const bundled = join(process.cwd(), "data");
  if (process.env.VERCEL) {
    const tmp = "/tmp/data";
    if (!existsSync(tmp)) mkdirSync(tmp, { recursive: true });
    for (const f of ["price-db.json", "bad-tickers.json"]) {
      const src = join(bundled, f);
      const dst = join(tmp, f);
      if (!existsSync(dst) && existsSync(src)) copyFileSync(src, dst);
    }
    return tmp;
  }
  return bundled;
}

const DATA_DIR = resolveDataDir();
const PRICE_DB_PATH = join(DATA_DIR, "price-db.json");
const BAD_TICKERS_PATH = join(DATA_DIR, "bad-tickers.json");

function schedulePriceDbSupabaseSync(db: PriceDB): void {
  void import("@/lib/cala-supabase-sync").then((m) => m.syncPriceDbToSupabase(db.prices));
}

interface PriceDB {
  lastUpdated: string;
  prices: Record<string, PriceEntry>;
}

function loadPriceDB(): PriceDB {
  if (existsSync(PRICE_DB_PATH)) {
    return JSON.parse(readFileSync(PRICE_DB_PATH, "utf-8"));
  }
  return { lastUpdated: new Date().toISOString(), prices: {} };
}

function savePriceDB(db: PriceDB) {
  db.lastUpdated = new Date().toISOString();
  writeFileSync(PRICE_DB_PATH, JSON.stringify(db, null, 2));
}

/**
 * Entry quality: `price-db.json` is a cache of **live** submit responses (`purchase_prices_apr15` /
 * `eval_prices_today`), not a separate quote API. Re-run `--harvest` to refresh before `--optimize`.
 */
function maybeWarnStalePriceDb(db: PriceDB) {
  const maxH = Number(process.env.CALA_PRICE_DB_WARN_STALE_HOURS ?? "48");
  if (maxH <= 0) return;
  const age = priceDbAgeHours(db.lastUpdated);
  if (age != null && age <= maxH) return;
  console.warn(
    `   ⚠️  price-db stale or unknown age: lastUpdated=${db.lastUpdated}` +
      (age != null ? ` (~${age.toFixed(1)}h ago)` : "") +
      ` (warn if >${maxH}h). Re-run --harvest. CALA_PRICE_DB_WARN_STALE_HOURS=0 silences.`,
  );
}

let badTickerEntries: BadTickerEntry[] = parseBadTickerFile(BAD_TICKERS_PATH);

function loadPersistedBadTickers(): string[] {
  return badTickerEntries.map((e) => e.ticker);
}

function savePersistedBadTickers(tickers: Set<string>) {
  const now = new Date().toISOString();
  const existing = new Map(badTickerEntries.map((e) => [e.ticker, e]));
  const merged: BadTickerEntry[] = [...tickers].map((t) =>
    existing.get(t) ?? { ticker: t, failedAt: now },
  );
  badTickerEntries = merged;
  serializeBadTickerFile(BAD_TICKERS_PATH, merged);
  void import("@/lib/cala-supabase-sync").then((m) => m.syncBadTickersToSupabase(tickers));
}

async function fetchJsonWithTimeout<T>(url: string, init?: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<T> {
  return fetchConvexEndpointJson<T>(url, init, timeoutMs);
}

// ── Omnigraph fire-and-forget sync ──────────────────────────────────

const OMNIGRAPH_ENABLED = process.env.OMNIGRAPH_SYNC !== "0";
let omnigraphHealthy: boolean | null = null;

const CONVICTION_BAND_A_THRESHOLD = 50;
const CONVICTION_BAND_B_THRESHOLD = 1;
const OMNIGRAPH_BATCH_CONCURRENCY = 8;

async function checkOmnigraphOnce(): Promise<boolean> {
  if (omnigraphHealthy !== null) return omnigraphHealthy;
  if (!OMNIGRAPH_ENABLED) { omnigraphHealthy = false; return false; }
  omnigraphHealthy = await probeOmnigraphHealth({ timeoutMs: 2_000, retries: 0 });
  if (omnigraphHealthy) console.log("🔗 Omnigraph connected — will sync companies & runs in background");
  return omnigraphHealthy;
}

function convictionBand(weightPct: number): "A" | "B" | "C" {
  if (weightPct > CONVICTION_BAND_A_THRESHOLD) return "A";
  if (weightPct > CONVICTION_BAND_B_THRESHOLD) return "B";
  return "C";
}

function todayDateTag(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fire-and-forget: upsert companies from the price DB into Omnigraph.
 * Uses batched concurrency to avoid N*5 sequential round-trips.
 */
function syncCompaniesToOmnigraph(db: PriceDB): void {
  void (async () => {
    if (!(await checkOmnigraphOnce())) return;
    const og = getOmnigraphClient();
    const entries = Object.values(db.prices);
    let ok = 0;
    let fail = 0;
    const dateTag = todayDateTag();

    const syncOne = async (e: PriceEntry) => {
      try {
        await og.change("upsert_company", { ticker: e.ticker, name: e.ticker, sector: null });
        await og.change("upsert_financial_metric", {
          metric_id: `${e.ticker}:purchase_price:apr15`,
          metric_name: "purchase_price",
          period: "apr15_2025",
          value: e.purchasePrice,
          cadence: "i", unit: "USD", cala_metric_uuid: null,
        });
        await og.change("link_metric", { ticker: e.ticker, metric_id: `${e.ticker}:purchase_price:apr15` });
        await og.change("upsert_financial_metric", {
          metric_id: `${e.ticker}:eval_price:${dateTag}`,
          metric_name: "eval_price",
          period: dateTag,
          value: e.evalPrice,
          cadence: "i", unit: "USD", cala_metric_uuid: null,
        });
        await og.change("link_metric", { ticker: e.ticker, metric_id: `${e.ticker}:eval_price:${dateTag}` });
        if (e.returnPct != null) {
          await og.change("upsert_financial_metric", {
            metric_id: `${e.ticker}:return_pct:${dateTag}`,
            metric_name: "return_pct",
            period: dateTag,
            value: e.returnPct,
            cadence: "i", unit: "%", cala_metric_uuid: null,
          });
          await og.change("link_metric", { ticker: e.ticker, metric_id: `${e.ticker}:return_pct:${dateTag}` });
        }
        ok++;
      } catch (err) {
        fail++;
        if (fail <= 3) console.log(`🔗 Omnigraph sync error [${e.ticker}]: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    for (let i = 0; i < entries.length; i += OMNIGRAPH_BATCH_CONCURRENCY) {
      await Promise.allSettled(entries.slice(i, i + OMNIGRAPH_BATCH_CONCURRENCY).map(syncOne));
    }
    console.log(`🔗 Omnigraph sync: ${ok} companies upserted, ${fail} failed`);
  })();
}

/**
 * Fire-and-forget: record an optimize submission as a PortfolioRun in Omnigraph.
 */
function syncPortfolioRunToOmnigraph(
  runId: string,
  strategyName: string,
  totalValue: number,
  returnPct: number,
  allocs: Allocation[],
  db: PriceDB,
): void {
  void (async () => {
    if (!(await checkOmnigraphOnce())) return;
    const og = getOmnigraphClient();
    try {
      await og.change("create_portfolio_run", {
        run_id: runId,
        branch_label: strategyName,
        portfolio_value_usd: totalValue,
        return_pct: returnPct,
        updated_at: new Date().toISOString(),
      });
      const holdingTasks = allocs.map(async (a) => {
        const p = db.prices[a.nasdaq_code];
        const weightPct = (a.amount / TOTAL_BUDGET) * 100;
        await og.change("upsert_company", {
          ticker: a.nasdaq_code, name: p?.ticker ?? a.nasdaq_code, sector: null,
        });
        await og.change("link_holding", {
          run_id: runId, ticker: a.nasdaq_code,
          weight_pct: weightPct, conviction_band: convictionBand(weightPct),
        });
      });
      for (let i = 0; i < holdingTasks.length; i += OMNIGRAPH_BATCH_CONCURRENCY) {
        await Promise.allSettled(holdingTasks.slice(i, i + OMNIGRAPH_BATCH_CONCURRENCY));
      }
      console.log(`🔗 Omnigraph: run ${runId} synced (${allocs.length} holdings, return ${returnPct.toFixed(2)}%)`);
    } catch (err) {
      console.log(`🔗 Omnigraph: run sync failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  })();
}

// ── Massive ticker universe to probe ─────────────────────────────────
// We want to test as many stocks as possible to find the best performers.
// Each submission needs exactly 50 stocks, so we batch them.

const ALL_TICKERS = [
  // === TOP PERFORMERS (keep first for max-concentrate) ===
  "IREN", "APLD", "WULF", "CIFR", "MU", "CORZ",

  // === Cala competitor expansion: high-beta / micro / AI / de-SPAC probes ===
  "ALAB", "BMNR", "TMC", "CDLX", "TERN", "ONDS", "CRWV", "PSTG", "RUM", "RCUS",
  "RR", "CRCL", "LICY", "RZLT", "KROS", "PHAT", "AIRE", "MVIS", "LPSN", "COMM",
  "XERS", "WK", "PRME", "SANA", "RZLV", "DFLI", "IVVD", "SOC", "ASPI",
  "UMAC", "USAR", "CRML", "PGY", "FIGR", "LYRA", "BNAI", "ORMP", "INMB", "QNCX",

  // === Crypto mining / BTC infrastructure (likely moonshot territory) ===
  "MARA", "RIOT", "CLSK", "HUT", "BITF", "BTBT", "BTDR",
  "GREE", "SOS", "EBON", "BTCY", "BITF", "ARBK", "SDIG",
  "MIGI", "CBIT", "BKKT", "COIN", "HOOD",

  // === AI infrastructure / data center / GPU plays ===
  "SMCI", "VRT", "DELL", "HPE", "ANET", "NVDA", "AMD",
  "TSM", "AVGO", "ARM", "QCOM", "INTC", "MU", "AMAT",
  "LRCX", "KLAC", "ON", "CRUS", "SWKS", "MRVL",

  // === Nuclear / energy ===
  "CEG", "VST", "NRG", "OKLO", "SMR", "LEU", "NNE", "CCJ",
  "BWXT", "DNN", "UEC", "URG", "EU", "UUUU",

  // === Quantum computing ===
  "IONQ", "RGTI", "QUBT", "ARQQ", "QBTS",

  // === Space / defense ===
  "RKLB", "LUNR", "ASTS", "BKSY", "SPIR", "RDW",
  "JOBY", "ACHR", "EVTL", "RCAT", "KTOS", "PLTR", "AXON",

  // === Mega-cap tech ===
  "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA",
  "NFLX", "CRM", "ADBE", "ORCL", "NOW", "SHOP",

  // === Fintech / payments ===
  "SOFI", "AFRM", "UPST", "PYPL", "V", "MA",

  // === High-growth SaaS / software ===
  "CRWD", "PANW", "NET", "ZS", "FTNT", "S",
  "DDOG", "SNOW", "MDB", "PATH", "CFLT", "ESTC",
  "MNDY", "ASAN", "GTLB", "WDAY", "VEEV", "TWLO",

  // === Consumer / social / gaming ===
  "APP", "SOUN", "SYM", "RDDT", "PINS", "SNAP", "ROKU",
  "RBLX", "TTWO", "EA", "SPOT", "GRAB", "SE", "NU",
  "DUOL", "CAVA", "BIRK", "CART", "CELH", "HIMS", "TOST",

  // === Biotech / pharma ===
  "MRNA", "BNTX", "VKTX", "DNLI", "PCVX", "CRSP",
  "EDIT", "NTLA", "BEAM", "TGTX", "NUVB", "ALNY",
  "DNA", "BNGO", "PACB", "TWST", "TXG", "NNOX",

  // === Meme / speculative ===
  "GME", "AMC", "DJT", "BBAI", "AI",
  "MSTR", "MSTU", "IBIT", "BITO", "GBTC",

  // === Cannabis ===
  "SNDL", "TLRY", "CGC", "ACB",

  // === Clean energy / EV ===
  "RIVN", "LCID", "PLUG", "FCEL", "BE", "BLDP",
  "QS", "GOEV", "LAZR", "OUST", "INVZ",
  "ENPH", "SEDG", "FSLR", "RUN",

  // === Travel / hospitality ===
  "UBER", "DASH", "ABNB", "DKNG", "NCLH", "RCL",
  "MAR", "HLT", "EXPE", "LYFT",

  // === E-commerce / retail ===
  "ETSY", "W", "CHWY", "OPEN", "CARG", "BROS",
  "LULU", "NKE", "TGT", "DG", "DLTR", "COST",

  // === Large-cap value ===
  "LLY", "UNH", "JPM", "WMT", "PG", "JNJ",
  "GE", "BKNG", "FICO", "IRM", "DLR", "EQIX", "AMT", "CCI",
  "IBM", "CSCO", "WIX", "FVRR", "UPWK",

  // === China tech ===
  "BABA", "JD", "PDD",

  // === Auto ===
  "F", "GM", "TM",

  // === MICRO/NANO-CAP MOONSHOT EXPANSION ===
  // Penny stocks, SPACs, micro-caps that could have 100x'd
  "MGOL", "MULN", "FFIE", "GOEV", "AEHL", "BFRG",
  "NKLA", "WKHS", "REE", "XOS", "ELMS", "CENN",
  "PHUN", "DWAC", "CFVI", "DATS", "IMPP", "INDO",
  "CNET", "BBIG", "TYDE", "VINC", "ATNF", "PRPO",
  "BIOR", "CXAI", "NUVB", "TBIO", "SAVA", "PRAX",
  "SERA", "AKRO", "RXRX", "SEER", "BMEA", "VKTX",
  "GFAI", "BRSH", "MKFG", "BEEM", "EVGO", "CHPT",
  "BLNK", "VLTA", "STEM", "ARRY", "MAXN", "SHLS",
  "LMND", "ROOT", "OSCR", "ACVA", "RELY", "TASK",
  "CASS", "PENN", "FUBO", "COUR", "DOCS", "BILL",
  "TTD", "ZM", "DOCU", "WBD",

  // === More micro-cap AI/tech plays ===
  "PRST", "VRME", "VNET", "BTBT", "CANG", "YGTY",
  "SOUN", "GFAI", "TMDX", "NUVB", "BIOR", "VCNX",
  "XPON", "RSLS", "TRKA", "SINT", "LIDR", "BGRY",
  "BTTR", "PRCH", "KULR", "WISA",

  // === Biotech penny stocks ===
  "SAVA", "CRVS", "PRAX", "ACHR", "EBON",
  "HYSR", "MVST", "FSR", "VLDR",

  // === More data center / infra ===
  "EGIO", "FSLY", "LLAP", "HNST", "TRMR",

  // === SPACs / de-SPACs that could moonshot ===
  "LCID", "GRAB", "JOBY", "LILM",
  "DNA", "VIEW", "MVST", "QS",

  // === More aggressive micro-cap sweep ===
  "IMVT", "OLPX", "BRZE", "TRUP", "APLS", "ADPT",
  "MGNI", "PUBM", "DSP", "RAMP", "ZETA", "SEMR",
  "INTA", "CERT", "JAMF", "SWI", "TENB", "VRNS",
  "QLYS", "RPD", "TOST", "RBRK", "OKTA", "PCOR",
  "FRSH", "ALTR", "BRZE", "MBLY", "SMWB",
  "KVYO", "SMAR", "DOCN", "GLBE", "TMDX", "PRMW",
  "HALO", "LNTH", "GKOS", "ESTA", "INSM", "AXSM",
  "CORT", "KRYS", "RPRX", "IRON", "CYTK", "ROIV",
  "MDGL", "PCVX", "SRPT", "BMRN", "EXAS", "NTRA",
  "RARE", "FOLD", "MYGN", "HRTX",
  "NVAX", "BCRX", "XENE", "PTCT", "ALKS",
  "ITCI", "CRNX", "CNTA", "DVAX", "IOVA", "VCEL",
  "LEGN", "AUTL", "KYMR", "IMVT", "ALDX", "ARWR",
  "RVMD", "ACLX", "ANAB", "RCKT", "MNKD",

  // === More AI/compute speculative ===
  "CEVA", "POET", "LASR", "ACMR", "UCTT", "MTSI",
  "COHR", "LITE", "CALX", "SLAB", "DIOD", "AMBA",
  "SITM", "POWI", "ALGM", "FORM", "RMBS", "NXPI",
  "MPWR", "WOLF", "ACLS",

  // === ETFs (to discover underlying trends) ===
  "QQQ", "SMH", "SOXX", "ARKK", "ARKW", "ARKG",
  "XBI", "IBB", "KWEB", "TAN", "ICLN", "LIT",
  "BOTZ", "ROBO", "HACK", "SKYY", "CLOU", "WCLD",
  "BITQ", "WGMI", "MSOS",

  // === MEGA MOONSHOT SWEEP: nano-cap / penny stocks / IPOs / de-SPACs ===
  // Biotech micro-caps
  "SMMT", "PRPH", "RVNC", "GTHX", "AVXL", "TTOO", "DRRX",
  "VRPX", "CLOV", "ALLO", "FATE", "SDGR", "VYGR", "SRRK",
  "CMPS", "ATAI", "MNMD", "DRUG", "NRXP", "CEMI", "CNTB",
  "DBVT", "PROG", "CTXR", "NLSP", "EVFM", "RNXT", "OPGN",
  "CDTX", "DARE", "BTAI", "APRE", "ABOS", "ONCT", "ANVS",
  "CRBU", "PRTX", "STRO", "MNOV", "VTGN", "NUVB",

  // De-SPACs / recent uplists that could have exploded
  "ORGN", "ARBE", "VELO", "SGHC", "MOND", "MEGL",
  "ALLG", "CANO", "TPVG", "CMPO", "ALIT", "NUVG",
  "DNMR", "MTTR", "AMPS", "DCGO", "MAPS", "QNST",
  "OPAD", "PAYO", "PSFE", "RLMD", "ENVX", "TKLF",
  "GDEV", "BZFD", "CMAX", "TSVT", "IINN", "HUBC",
  
  // Ultra-penny crypto / blockchain plays
  "BITQ", "WGMI", "SQ", "MOGO", "SOFI",
  "NXGL", "FRGE", "BTCS", "APLD", "BRDS",
  "CAN", "PHIA", "TLIS", "GBOX", "NCNC",
  "GFOF", "AGFY", "BLOK", "BKCH", "LDOS",

  // AI / robotics / automation micro-caps
  "AIEV", "NXAI", "SOUN", "BBAI", "ISPC",
  "AGRI", "ALBT", "AIMD", "AITX", "SIFY",
  "ADSK", "CDNS", "SNPS",
  "RBOT", "IRBT", "KTOS", "AVAV",
  "LTRY", "TTCF", "EVLV", "BRN",

  // Mining / resources penny stocks
  "PALA", "RGLD", "PAAS", "AG", "SVM",
  "BTG", "GATO", "MAG", "EXK", "FSM",
  "HYMC", "USAS", "AUMN", "ELRN",
  "GORO", "MYNA", "TRX",

  // More semiconductor / tech
  "ACLS", "OLED", "VECO", "CRUS", "SWKS",
  "SYNA", "MAXI", "ETRN", "EAR",
  "AGYS", "DGII", "CALX", "VIAV", "SLAB",

  // SPACs / blank check
  "DWAC", "PSTH", "IPOF", "CRHC",

  // More EV / mobility / green
  "PSNY", "VFS", "XPEV", "LI", "NIO",
  "FFIE", "GOEV", "RIDE", "WKHS", "FSR",
  "AMPX", "CHPT", "EVGO", "BLNK",
  "DRTS", "REE", "XOS", "ELMS", "MULN",

  // Fintech / digital banking micro-caps
  "DAVE", "OPFI", "UPST", "LMFA",
  "ML", "MFIN", "RPAY", "PAGS",
  "STNE", "DLO", "VNET", "FINV",

  // Media / social / gaming micro-caps
  "CURI", "LULU", "REAL", "GRPN",
  "PRCH", "LOVE", "WISH", "WIMI",
  "AMBO", "ATIP", "NWTN", "VRAR",

  // Logistics / supply chain
  "XPO", "SAIA", "ODFL", "JBHT",
  "FWRD", "GXO", "KNX", "HUBG",

  // Healthcare / telehealth micro-caps
  "TDOC", "AMWL", "GDRX", "OSCR",
  "LFMD", "HIMS", "ACCD", "PGNY",
  "TALK", "TALKW",

  // Cannabis SPACs / micro-caps
  "MAPS", "FLGC", "GRNH", "VFF",
  "HEXO", "CRON", "APHA",

  // Energy storage / hydrogen
  "DCFC", "EVEX", "FLUX",
  "BEEM", "GEVO", "CLNE", "OPTT",

  // Space / satellite micro-caps
  "MNTS", "ASTR", "SATL", "GILT",
  "IRDM", "VSAT", "GSAT",
  
  // Real estate tech / proptech
  "OPEN", "RDFN", "COMP", "DOUG", "FTHM",
  "EXP", "REAL", "IRNT",

  // 3D printing / advanced manufacturing
  "DDD", "SSYS", "NNDM", "XONE", "MTLS",
  "VJET", "PRNT",

  // Rare earth / critical minerals
  "MP", "UUUU", "TMRC", "REE",
  "NIOBF", "LTHM", "LAC", "PLL",
  "SGML", "ALTM",

  // KNOWN micro-cap runners from recent years
  "SMCI", "NVDA", "VRT", "DELL",
  "AEHR", "CAVA", "DUOL",
  "CELH", "GEV", "TGTX", "VKTX",
  "JANX", "INSM", "KRYS",
  "RXRX", "SDGR", "ABCL",
  "RPRX", "VERV", "NTLA",
  "BEAM", "CRSP", "EDIT",
  
  // Ultra-speculative: known sub-$1 tickers
  "CENN", "MULN", "FFIE", "NKLA",
  "GOEV", "WKHS", "XOS", "ELMS",
  "RIDE", "FSR", "PSNY",
  "HYSR", "SOS", "EBON", "PHUN",
  "IMPP", "INDO", "CNET",
  "GFAI", "BRSH", "MKFG",
  "VLTA", "STEM", "ARRY",
  "MAXN", "SHLS", "LMND", "ROOT",

  // More speculative micro-cap AI
  "PRST", "VRME", "XPON", "RSLS",
  "TRKA", "SINT", "LIDR", "BGRY",
  "BTTR", "WISA", "CXAI",
  "VCNX", "BIOR", "SERA",

  // Additional untested NASDAQ tickers
  "ARCT", "VCYT", "TWST", "CGEN", "BNGO",
  "ASRT", "NERV", "BRTX", "MVST",
  "VIEW", "NRGV", "LILM", "PLBY",
  "SLNO", "CSSE", "NWSA", "PARA",
  "LBTYA", "LBTYK", "DISCA", "WBD",
  "FOXA", "NWSA", "VIAC",
  "STLA", "RIVN", "PCAR", "TSLA",
  "LCID", "PSNY", "VFS",

  // Quantum computing expansion
  "QMCO", "QUBT", "RGTI", "IONQ", "ARQQ",
  "QTUM", "FORM",

  // More nuclear / uranium
  "BWXT", "UROY", "NXE", "PALAF",
  "FLR", "BWX",

  // Insurance tech
  "LMND", "ROOT", "OSCR", "HIPO",
  "ACVA", "GOAT",

  // EdTech
  "COUR", "UDMY", "LRNG", "TWOU",
  "STRA", "LRN", "CHGG",

  // Food tech / ag tech
  "BYND", "TTCF", "APPH", "AGFY",
  "SMPL", "VITL", "CELZ",

  // Cyber security micro-caps
  "CYBR", "RPD", "QLYS", "TENB",
  "VRNS", "SWI", "SAIL", "OSPN",
  "SCWX", "EVBG", "CALX",

  // === WAVE 2: DEEP MOONSHOT EXPANSION ===

  // Fuel cell / hydrogen (BE-sector peers — highest priority)
  "HTOO", "PCELL", "HYSR", "AFC", "ADEP", "HPNN",
  "CLNE", "GEVO", "OPAL", "AMPT", "ARRY",
  "NRGV", "FLUX", "DCFC", "EVEX",

  // More uranium miners (UUUU, LEU, DNN already performing — expand)
  "UROY", "NXE", "BQSF", "STND", "FCUUF", "BOE",
  "AURA", "FMCL", "LARAMEE", "ENCR",
  "WSTRF", "FUZZY", "GLATF",

  // More crypto mining / BTC adjacent micro-caps
  "HIVE", "BTCM", "BTOG", "GRIID", "HASH", "BTMX",
  "XBTEF", "DGHI", "CIFR", "MIGI",
  "AURUM", "BSRT", "CSIX",

  // AI robotics / automation micro-caps not yet tried
  "NURO", "NVNI", "AEAC", "AITX", "AIXI",
  "CCTG", "JFIN", "AIMD", "ISPC",
  "BTMD", "NMAX", "ADAI",

  // Defense / space new plays
  "SPCE", "MNTS", "ASTR", "GILT", "ORBT",
  "SATL", "GSAT", "IRDM", "VSAT",
  "BKSY", "SPIR", "ASTS",

  // Clean energy IPOs / recent listings
  "AMPX", "HLBZ", "CISO", "PGSS", "EVRI",
  "ACNB", "AFRI", "AFAR", "AMAO",
  "BMBL", "BRPM", "BTAQ",

  // Biotech FDA moonshots (low price → huge pop potential)
  "ALDX", "ACRS", "CNSP", "GNPX", "LYEL",
  "IMTX", "EVAX", "MRAI", "ATRC", "TALS",
  "ADAG", "KRTX", "XBIO", "ATHX",
  "ADVM", "AMRS", "AQST", "ARAV", "ARCT",
  "AVTE", "BCRX", "BCYC", "BIIB",
  "CABA", "CASI", "CDMO", "CERC",
  "CGEM", "CLLS", "CMPS", "CSTL",
  "CYCN", "CYTH", "DAWN", "DCPH",

  // More penny / sub-$5 plays
  "AACG", "ABCL", "ABIO", "ACER",
  "ACOR", "ACRS", "ADIL", "ADMA",
  "ADMP", "ADRO", "AEHR", "AENT",
  "AEVA", "AEYE", "AFIB", "AFRI",
  "AGBA", "AGFY", "AGRI", "AGTI",
  "AIRC", "AIXI", "AKOM", "ALBT",
  "ALDX", "ALEC", "ALEX", "ALFI",
  "ALGM", "ALIS", "ALLK", "ALLT",
  "ALNY", "ALOT", "ALPN", "ALRS",
  "ALSA", "ALTI", "ALTR", "ALTX",
  "ALVO", "AMBO", "AMIO", "AMMO",
  "AMPC", "AMPE", "AMPIO", "AMRS",
  "AMTB", "AMTX", "AMWL", "AMZN",
  "ANAB", "ANCN", "ANGI", "ANIP",
  "ANKAM", "ANSC", "ANTE", "ANZU",
  "AOSL", "AOUT", "APAM", "APCA",
  "APEI", "APEN", "APEX", "APGN",
  "APLD", "APLE", "APOG", "APPM",
  "APPN", "APRE", "AQMS", "AQST",
  "ARAV", "ARCE", "ARCH", "ARCT",
  "AREC", "ARGX", "ARHS", "ARKK",
  "ARKO", "ARMP", "ARNC", "AROC",
  "ARRO", "ARTL", "ARTNA", "ARTW",
  "ARWR", "ASAN", "ASLE", "ASLN",
  "ASND", "ASNS", "ASRT", "ASST",
  "ASTE", "ATAI", "ATEX", "ATGL",
  "ATIP", "ATLO", "ATNI", "ATRI",
  "ATSG", "ATTO", "ATVI", "ATXS",
  "AUPH", "AUST", "AUTH", "AUTL",
  "AUTO", "AUVI", "AVAH", "AVBH",
  "AVCO", "AVDX", "AVGO", "AVID",
  "AVIR", "AVNS", "AVNT", "AVNW",
  "AVPT", "AVRO", "AVTE", "AVXL",
  "AWRE", "AXDX", "AXGN", "AXLA",
  "AXNX", "AXON", "AXSM", "AXTI",

  // More short-ticker micro-caps
  "AZ", "AZEK", "AZPN", "AZTA",
  "BAFI", "BAIN", "BALL", "BANC",
  "BAND", "BANF", "BANR", "BAOS",
  "BARK", "BBAI", "BBBT", "BBIO",
  "BBSI", "BCAB", "BCAL", "BCBP",
  "BCDA", "BCEL", "BCRX", "BCSA",
  "BCYC", "BFAM", "BFLY", "BGCP",
  "BGFV", "BGLC", "BGRY", "BHIL",
  "BHVN", "BIAF", "BIMI", "BIOA",
  "BIOC", "BIOH", "BIOL", "BIOR",
  "BIOT", "BIOX", "BITO", "BJRI",
  "BKSC", "BKYI", "BLBD", "BLBX",
  "BLCM", "BLDE", "BLDP", "BLFS",
  "BLFY", "BLGO", "BLIN", "BLKB",
  "BLMN", "BLND", "BLNK", "BLPH",
  "BLRX", "BLSA", "BLTE", "BLUE",
  "BLZE", "BMBL", "BMEA", "BMNM",
  "BMRA", "BMRC", "BMRN", "BMTX",
  "BNFT", "BNGO", "BNIX", "BNNR",
  "BNOX", "BNRG", "BNTC", "BNTX",
  "BODY", "BOLT", "BOMB", "BPMC",
  "BPOP", "BPRN", "BPTH", "BPTS",
  "BRBR", "BRBS", "BRCN", "BRDG",
  "BRID", "BRKH", "BRKL", "BRKR",
  "BRLT", "BROG", "BRTX", "BRZE",
  "BSFC", "BSGM", "BSRR", "BSTC",
  "BSVN", "BTAI", "BTBT", "BTCS",
  "BTCT", "BTDR", "BTTX", "BTWN",
  "BULD", "BURI", "BURL", "BURN",
  "BUSE", "BVNRY", "BWAC", "BWMX",
  "BYFC", "BYNO", "BYSI", "BZFD",

  // === WAVE 3: HIGH-PROBABILITY EXTREME MOVERS ===
  // Known or suspected 100x+ candidates (April 2025 → April 2026)

  // Summit Therapeutics (ivonescimab cancer trial) — known massive runner
  "SMMT",

  // Nebius Group (AI cloud infra, Yandex spin-off) — cheap AI infra play
  "NBIS",

  // Serve Robotics (autonomous delivery) — early 2025 IPO mover
  "SERV",

  // Quantum / AI compute (could have 100x'd from very low base)
  "QUBT", "RGTI", "QBTS", "IONQ",

  // More nuclear energy micro-caps (uranium bull run)
  "NNE", "SMR", "OKLO", "BWXT", "NXE", "EU",
  "LTBR", "FLNC", "NRGU",

  // More crypto/BTC adjacent plays not yet cached
  "BTCS", "BTOG", "BTMX", "GRIID", "HASH",
  "HIVE", "BTCM", "CAN",

  // Hydrogen / fuel cell peers of BE (BE went 11x — check peers)
  "HTOO", "AFC", "GENM", "HYSR", "HPNN",
  "PCELL", "NRGV",

  // China NASDAQ micro-caps (known for extreme short-term moves)
  "CIFS", "MHUA", "CNEY", "CANG", "GFAI",
  "AIXI", "AIMD", "AITX", "JFIN", "CCTG",
  "NCTY", "MOXC", "SFWL", "ACXP", "TANH",
  "WIMI", "NWTN", "KXIN", "SGLY", "MEGL",
  "CJET", "CLPS", "CBAT", "GOTU", "IMTE",
  "LIQT", "NTES", "MFIN", "SFUN", "SXTC",
  "TC", "TPVG", "TMDI", "COVA", "GXAI",
  "AIFU", "AIXI", "SLNH", "AIAB",

  // Micro-cap AI / robotics (post-ChatGPT boom)
  "SOUN", "BBAI", "ISPC", "BTMD",
  "NMAX", "ACMR", "POET", "LASR",
  "KULR", "WISA", "PRST", "XPON",
  "SINT", "RSLS", "LIDR",

  // Biotech binary events (single-drug companies)
  "SMMT", "PCVX", "VKTX", "TGTX",
  "ALDX", "ACRS", "GNPX", "LYEL",
  "IMTX", "EVAX", "MRAI", "ATRC",
  "ADAG", "KRTX", "XBIO", "ATHX",
  "ADVM", "DAWN", "DCPH", "CGEM",
  "CLLS", "CSTL", "CYCN",

  // Defense / drone micro-caps
  "RCAT", "AVAV", "KTOS", "PLTR",
  "AEVA", "LIDR", "OUST",

  // Energy transition / grid micro-caps
  "STEM", "ARRY", "MAXN", "SHLS",
  "AMPX", "EVGO", "CHPT", "BLNK",

  // Fintech / crypto exchange micro-caps
  "DAVE", "OPFI", "LMFA", "ML",
  "RPAY", "PAGS", "STNE", "DLO",

  // Recent IPO/uplist moonshot targets
  "ACHR", "JOBY", "LILM", "EVTL",
  "VFS", "PSNY", "GOEV",

  // Media / entertainment speculative
  "DJT", "PHUN", "FUBO", "CURI",

  // Biotech with very low purchase price
  "SAVA", "NRXP", "CNTB", "DBVT",
  "PROG", "CTXR", "NLSP", "EVFM",
  "RNXT", "OPGN", "CDTX", "DARE",

  // === WAVE 4: LEVERAGED ETFs & KNOWN EXTREME MOVERS ===
  // 3x leveraged ETFs (massive moves if underlying sector surged)
  "SOXL", "TQQQ", "UPRO", "SPXL", "LABU", "FNGU",
  "TECL", "DFEN", "CURE", "RETL", "NAIL", "DPST",
  "UDOW", "WANT", "HIBL", "MIDU", "UTSL", "YINN",
  "NUGT", "JNUG", "SILJ", "GDXJ",
  // 2x leveraged
  "SSO", "QLD", "BOIL", "UCO", "UWT",

  // === Known mover categories ===
  // Micro-cap Chinese stocks (extreme volatility / thin float)
  "MEGL", "CIFS", "MHUA", "CNEY", "GFAI", "AIXI",
  "NCTY", "SFWL", "SGLY", "CJET", "GXAI", "AIFU",
  "TANH", "TC", "SFUN", "SXTC",

  // NBIS/SERV known 2025 runners
  "NBIS", "SERV", "RDDT", "CLOV", "MSOS",
  "HIPO", "ACVA", "RELY", "TASK",

  // Uranium/energy new listings
  "LTBR", "UROY", "NXE", "BOE", "AURA",

  // AI inference / server plays
  "SMCI", "CRDO", "ACLS", "AEHR", "MTSI",
  "COHR", "LITE", "ACMR", "UCTT", "WOLF",

  // Copper/battery material (EV supply chain boom)
  "COPX", "CPER", "NOVN", "ARIS", "MTAL",
  "NGEX", "IVPK", "CAUA",

  // Biotech FDA approvals 2025 (known catalysts)
  "SMMT", "VKTX", "TGTX", "PCVX", "MRNA",
  "BNTX", "IMVT", "LEGN", "KYMR", "RVMD",
  "RCKT", "ACLX", "ANAB", "AUPH",

  // More micro-cap crypto mining not yet tried
  "BTCS", "GRIID", "HASH", "HIVE", "BTCM",
  "CAN", "MIGI", "CANG", "BTOG",

  // Defense / drone new entries
  "AVAV", "KTOS", "RCAT", "SPCE", "MNTS",
  "ORBT", "IRDM", "GSAT", "GILT",

  // === WAVE 5: Extra nano-cap / clinical-stage probes (competitor sweep) ===
  "RANI", "CGTX", "IMNN", "KNSA", "SLRX", "ALLR", "ABVE", "HOWL",
  "TCRX", "MIRA", "FDMT", "PHVS",

  // === WAVE 6: VERIFIED HIGH-RETURN TICKERS (Apr 2025→2026 research) ===
  // Top verified percentage gainers from NerdWallet/StatMuse/Stocknear
  "RELI", "CHEK", "QMMM", "BW", "NINE", "RGC", "SHAZ", "SNDK",
  "KOD", "SLGL", "TNGX", "ERAS", "ANRO", "CELC", "XWIN",
  "DMRA", "MGRT", "EXAS", "BNAI", "PRAX", "LWLG", "ONDS",
  "NEGG", "OVID", "HYMC",

  // Extreme micro/nano-cap movers (sub-penny → dollars potential)
  "PBLA", "CREV", "SKYQ", "BIAF", "MLGO", "ICCT", "CSAI",
  "ABAT", "WNW", "PSTV", "CRVS",

  // User-requested tickers (remaining not already in list)
  "VINE", "TOP", "XELA", "OBLG", "PRFX", "TCON", "SNOA", "AEMD",
  "NXGL", "SATL", "BFRG",

  // More extreme nano-cap / pink-to-NASDAQ uplist candidates
  "EHYD", "CBDS", "OZSC", "HCDI", "DPSI", "WBUY", "ELEK", "EVIO",
  "MBOT", "RGBP", "LEDS", "ABEO", "CMRX", "CSSE", "DFFN", "EDTX",
  "ETNB", "FEMY", "GRNQ", "HOOK", "ILAG", "KTTA", "LXRX", "MYSZ",
  "NDRA", "ONCS", "PAVS", "PEGY", "RUBY", "SBET", "TRVG", "VVOS",
  "XAIR", "ZIVO", "BRSH", "MKFG",

  // More crypto/BTC plays not yet harvested
  "BKKT", "CIFR", "MSTR", "COIN", "SOS", "EBON", "BTCY",

  // Additional biotech micro-caps with binary event potential
  "INBS", "ARDS", "CLRB", "CASI", "AGTC", "ATOS", "CALA",
  "CYCC", "DERM", "FLGT", "GLSI", "GTBP", "HGEN", "HSTO",
  "IDBA", "IMRN", "INMB", "IPHA", "KPTI", "LPCN", "MRTX",
  "NBRV", "NEOS", "NVAX", "OCUP", "ONCT", "ORPH", "PRTA",
  "PTGX", "RLAY", "SBBP", "SENS", "SGMO", "SNGX", "TARS",
  "TTOO", "TXMD", "VBIV", "VRCA", "VTGN", "ZNTL",

  // === WAVE 7: REVERSE SPLIT CANDIDATES (post Apr 15, 2025) ===
  // High-ratio reverse splits that may yield unadjusted API returns
  // 1:200 splits
  "NXTT", "JTAI",
  // 1:100+ splits
  "ADTX", "CBIO", "AREB", "LBGJ", "ONCO",
  // 1:30-50 splits
  "WCT", "NUWE", "NVVE", "NITO", "YHC", "NVNO", "PAVM", "ABP", "OGEN",
  // 1:20-25 splits
  "ADV", "AGL", "ADIL", "WAI", "ACXP", "TC", "PED", "XHG", "NVDQ", "AMRN", "MRDN",
  // Additional reverse split plays
  "LDSN", "CISO", "COSM", "EDBL", "SBFM", "CNSP", "MGOL", "SMFL",
  "TBLT", "GFAI", "IMPP", "KTTA", "AULT", "TKLF", "KORE", "HOUR",
  "CEMI", "ATPC", "BTBT", "NCPL", "MITQ", "BSFC", "WHLM", "GPAK",
  "CRGE", "AREC", "BASA", "INDO", "SNSE", "BENF", "CPTN", "TLSA",
  "DRCT", "NVTS", "ATHE", "MLTX", "APRE", "ELMS", "CTCX", "EEIQ",

  // === WAVE 7: OTC PINK SHEETS / EXTREME MOVERS (most won't work but worth trying) ===
  "EHYD", "NECA", "STIXF", "BIORQ",

  // === WAVE 7: IPO MOONSHOTS / SPAC de-SPAC plays ===
  "MGRT", "SDM", "TDIC", "EDHL", "BAOS",
  "BRLS", "GCT", "WIMI", "KUKE", "CANG", "GMAB",
  "NUVB", "DM", "ASTR", "SPCE", "RKLB",
  "LUNR", "RDW", "MNTS", "ASTS",

  // === WAVE 7: POST-BANKRUPTCY MOONSHOTS ===
  "WOLF",

  // === WAVE 7: BIOTECH FDA APPROVALS / MERGERS ===
  "HIMS", "CORT", "MDGL", "KRYS", "PCVX", "VERV",
  "BMRN", "SRPT", "ALNY", "VKTX", "PTGX", "AKRO",
  "RXRX", "AGIO", "TGTX", "ADMA", "JANX", "NUVL",

  // === WAVE 7: AI / QUANTUM ULTRA-SMALL-CAP ===
  "SOUN", "BBAI", "BSQR", "DTST", "INOD", "SYM",
  "AEVA", "OUST", "INDI", "LIDR",

  // === WAVE 7: CHINESE NANO-CAPs that moon ===
  "JZ", "LITM", "NIO", "LI", "XPEV",
  "CPOP", "AIXI", "NISN", "WISA", "CXDO",
  "RCAT", "UMAC", "BRLT",   "UTME", "EZGO",

  // === WAVE 8: TICKER CHANGES 2026 — new tickers (API may return old co's Apr 2025 price) ===
  "ZTG", "YOOV", "SDEV", "KEEL", "CSHR", "NEXR", "XNDU", "CYAB",
  "GLND", "MRLN", "GIX", "VIVO", "FNUC", "QUCY", "GRML", "GMEX",
  "DMRA", "FLNA", "OIO", "FRMM", "NXTS", "ALOY", "RYZ", "CVSA",
  "XRN", "GGRP", "ARIS", "CNTN", "AIOS", "RPC", "DFNS", "DCH",
  "TULP", "ZSTK", "QTI", "EZRA", "GPGI", "OLOX", "PDC", "DCBG", "RMIX",

  // === WAVE 8: TICKER CHANGES 2025 — new tickers ===
  "ABXL", "ABX", "OPLN", "BVC", "HTT", "RENX", "DTCX", "FEED",
  "TWAV", "TJGC", "DCX", "AMCI", "XXI", "AGIG", "GRDX", "MBAI",
  "RJET", "OSG", "OPTU", "AIXC", "TDAY", "FWDI", "CYPH", "CD",
  "AVX", "PTN", "HERE", "XWIN", "AXIA", "FTW", "EMBJ", "ALPS",
  "NBP", "IMSR", "BYAH", "GIW", "NUCL", "SLAI", "AURE", "NKLR", "BNKK",

  // === WAVE 8: OLD tickers from changes (may still have API data) ===
  "CIGL", "NBY", "VCIC", "JFBR", "CHAC", "TBMC", "PELI", "BACQ",
  "VVPR", "MYNZ", "KLTO", "FTEL", "GLTO", "SAVA", "ESGL", "GMGI",
  "ETHZ", "BLBX", "ATGE", "GMRE", "VRAR", "ARMN", "THAR", "NUKK",
  "FLGC", "CMPO", "SGBX", "ELWS", "KAR", "STEC", "QD", "SGD",
  "NAOV", "MCTR", "CJET", "CEP", "HUSA", "AMRK", "ENTO", "CHEK",
  "MESA", "AMBC", "ATUS", "QLGN", "GCI", "LPTX", "MFH", "AGRI",
  "PTNT", "QSG", "NVFY", "EBR", "EQV", "GLLI", "IMAB", "HOND",
  "PHH", "SVII", "BTCM", "PWM", "GSRT", "SHOT",

  // === WAVE 8: UPLISTED FROM OTC TO NASDAQ ===
  "GOAI", "ELPW",

  // === WAVE 8: SPAC de-SPAC mergers with ticker changes ===
  "HYAC", "GIXXU", "GIWWU",

  // === WAVE 9: POST-APR-15-2025 IPOs — API may give anomalous purchase price ===
  // Oct 2025 IPO, $4→$172 = potential 10,000x+ if API returns near-zero Apr 15 price
  "TCGL",
  // Major 2025 IPOs after April 15
  "CHYM", "BLLN", "ANDG", "MDLN", "FRMI", "CDNL", "CHA", "WLTH",
  "AERO", "AII", "SMA", "GLOO",
  // 2025 H2 IPOs — biotech, tech, fintech
  "SION", "BBNX", "KMTS", "FIGR", "CRCL", "STUB", "OMDA",
  // 2026 IPOs — very recent, should definitely have no Apr 2025 price
  "MANE", "SGP", "PAYP", "BOBS", "OFRM", "BTGO", "EQPT", "AKTS",
  "YSS", "HMH", "JAN", "MMED", "MWH", "FPS", "PICS", "APC",
  // More 2025 late-year IPOs
  "SCPQ", "SVAQ", "BEBE", "ADAC", "CCXI", "LMRI",
  // High-growth 2025 IPOs — any that mooned from low IPO prices
  "MGRT", "SDST", "BFAM", "NUVB", "HIMS",
  // Chinese nano-caps that IPO'd on NASDAQ after April 2025
  "SDM", "TDIC", "EDHL", "DRCT", "BAOS", "VSME",

  // === WAVE 10: STATMUSE EXTREME MOVERS (53,000%+ in 4 months) ===
  "JNVR",  // Janover Inc, +1,901% since Jan 2025
  "ASST",  // Asset Entities, +840%
  "TOI",   // Oncology Institute, +674%
  "GITS",  // Global Interactive Technologies, +568%
  "DOMH",  // Dominari, +518%
  "KDLY",  // Kindly MD, +517%
  "OCG",   // Oriental Culture, +451%
  "NUTX",  // Nutex Health, +396%
  "RGLS",  // Regulus Therapeutics, +390%
  "ABTS",  // Abits, +386%
  "TDUP",  // ThredUp, +381%
  "YOSH",  // Yoshiharu Global, +346%
  "MNDR",  // Mobile-health Network, +322%
  "CURI",  // CuriosityStream, +298%
  "FNGR",  // FingerMotion, +269%
  "NTCL",  // Netclass Technology, +254%
  "DBVT",  // DBV Technologies, +249%
  "CRVO",  // CervoMed, +247%
  "NXTT",  // Next Technology, +1,069% in 1 month
  "PNBK",  // Patriot National Bancorp, +356% in 1 month
  "UPXI",  // Upexi, +312%
  "AREN",  // Arena, +297%
  "BATL",  // Battalion Oil, +674% in 1 month
  "EDSA",  // Edesa Biotech, +527%
  "TURB",  // Turbo Energy, +396%
  "ANTX",  // AN2 Therapeutics, +385%
  "RXT",   // Rackspace Technology
  "XWEL",  // XWELL
  "SGN",   // Signing Day Sports
  "CDIO",  // Cardio Diagnostics
  "MOBX",  // Mobix Labs
  "SNSE",  // Sensei Biotherapeutics
  "TMDE",  // TMD Energy
  "TWNP",  // Twin Hospitality
  "TPET",  // Trio Petroleum
  "ATOM",  // Atomera
  "NAMM",  // Namib Minerals
  "LVLU",  // Lulu's Fashion Lounge
  "ALMS",  // Alumis
  "WATT",  // Energous
  "ANPA",  // Rich Sparkle Holdings
  "SDOT",  // Sadot
  "ZNTL",  // Zentalis Pharmaceuticals
  "MRNO",  // Murano Global Investments
  "RPID",  // Rapid Micro Biosystems
  "DVLT",  // Datavault AI
  "RCKT",  // Rocket Pharmaceuticals
  "EVTV",  // Envirotech Vehicles, +620%
  "YI",    // 111 Inc
  "IBRX",  // Immunitybio
  "ERAS",  // Erasca
  "PMN",   // ProMIS Neurosciences
];

/** Optional: merge tickers from research-agent (`data/research-harvest-candidates.json`) and CALA_HARVEST_CANDIDATE_FILES. */
const RESEARCH_HARVEST_CANDIDATES_REL = "data/research-harvest-candidates.json";

function discoverHarvestUniverse(): string[] {
  const extraPaths: string[] = [];
  const envFiles = process.env.CALA_HARVEST_CANDIDATE_FILES?.trim();
  if (envFiles) {
    for (const p of envFiles.split(/[,\s]+/)) {
      const s = p.trim();
      if (s) extraPaths.push(s);
    }
  }
  if (process.env.CALA_MERGE_RESEARCH_CANDIDATES !== "0") {
    const abs = join(process.cwd(), RESEARCH_HARVEST_CANDIDATES_REL);
    if (existsSync(abs) && !extraPaths.includes(RESEARCH_HARVEST_CANDIDATES_REL)) {
      extraPaths.push(RESEARCH_HARVEST_CANDIDATES_REL);
    }
  }
  const loaded = loadHarvestCandidateFiles(extraPaths);
  const fromFiles = loaded.flatMap(l => l.tickers);
  return buildHarvestUniverse(ALL_TICKERS, process.env.CALA_EXTRA_TICKERS, fromFiles);
}

/** Deduped list: valid 1–5 letter symbols only; merges research/candidate JSON when configured. */
const HARVEST_UNIVERSE = discoverHarvestUniverse();
const UNIVERSE_RAW_INVALID_FORMAT = splitHarvestUniverse(ALL_TICKERS).invalidFormat.length;

function dedup(tickers: string[]): string[] {
  const seen = new Set<string>();
  return tickers.filter(t => {
    const upper = t.toUpperCase();
    if (seen.has(upper)) return false;
    seen.add(upper);
    return true;
  });
}

/**
 * Filled first in each harvest batch’s “pending” slots so batches fail less on illiquid tickers.
 * (Micro-caps and de-SPACs stay in the universe but move behind this set.)
 */
const HARVEST_PRIORITY = new Set<string>([
  "IREN", "APLD", "WULF", "CIFR", "MU", "CORZ",
  "MARA", "RIOT", "CLSK", "HUT", "BITF", "BTBT", "BTDR", "GREE", "COIN", "HOOD",
  "SMCI", "VRT", "DELL", "HPE", "ANET", "NVDA", "AMD", "TSM", "AVGO", "ARM", "QCOM", "INTC",
  "AMAT", "LRCX", "KLAC", "ON", "CRUS", "SWKS", "MRVL",
  "CEG", "VST", "NRG", "OKLO", "SMR", "LEU", "NNE", "CCJ", "BWXT",
  "IONQ", "RGTI", "QUBT", "ARQQ", "QBTS",
  "RKLB", "LUNR", "ASTS", "BKSY", "SPIR", "RDW", "JOBY", "ACHR", "EVTL", "RCAT", "KTOS", "PLTR", "AXON",
  "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "NFLX", "CRM", "ADBE", "ORCL", "NOW", "SHOP",
  "SOFI", "AFRM", "UPST", "PYPL", "V", "MA",
  "ALAB", "BMNR", "MSTR",
]);

function sortPendingForHarvest(pending: string[], universeOrder: string[]): string[] {
  const pos = new Map(universeOrder.map((t, i) => [t.toUpperCase(), i]));
  const tier = (t: string) => (HARVEST_PRIORITY.has(t.toUpperCase()) ? 0 : 1);
  return [...pending].sort((a, b) => {
    const d = tier(a) - tier(b);
    if (d !== 0) return d;
    return (pos.get(a.toUpperCase()) ?? 99_999) - (pos.get(b.toUpperCase()) ?? 99_999);
  });
}

// Observed live rejects from Cala. Keep them out of future retries.
// Augmented with persisted bad tickers from previous runs.
const badTickers = new Set<string>([
  "SDIG", "CBIT", "GOEV", "LAZR",
  "ANSS",
  "SQ", "ATVI", "TWTR", "DIDI", "BABA", "WISH", "CLOV",
  "BGFV", "GENI", "CLVS", "VXRT", "NKLA", "RIDE",
  "MGOL", "MULN", "FFIE", "ELMS", "DWAC",
  "WKHS", "SOLO", "HYLN", "ATLIS",
  "AFC", "PCELL", "NRGV", "GENM", "HPNN",
  "SXTC", "LIQT", "SFUN", "MFIN", "SLNH", "AIAB", "BTOG", "BTMX",
  "COVA",
  "DATS", "AKRO", "BRSH", "VLTA", "YGTY", "BIOR",
  "BMNR", "CRCL", "LICY", "COMM", "CFVI", "TYDE", "ATNF", "MKFG",
  "BGRY", "BTTR", "WISA", "FSR", "VLDR", "EGIO", "LLAP", "TRMR", "LILM", "VIEW",
  "JAMF", "SWI", "ALTR", "SMAR", "PRMW",
  "ITCI", "DVAX", "WOLF", "RVNC", "GTHX", "DRRX", "MNMD",
  "GRNH", "ACCD", "TALKW", "FLGC", "HEXO", "APHA", "DCFC", "ASTR", "RDFN", "IRNT", "VJET",
  "NIOBF", "LTHM", "PLL", "ALTM", "VERV", "VLTA",
  "CSSE", "PARA", "DISCA", "VIAC", "LRNG", "TWOU", "APPH", "CYBR", "SCWX", "EVBG",
  "MOND",
  ...loadPersistedBadTickers(),
]);

function harvestReplacementCandidates(db: PriceDB, universeOrder: string[]): string[] {
  const u = dedup(universeOrder).filter(t => !badTickers.has(t));
  const pending = u.filter(t => !db.prices[t]);
  const cached = u.filter(t => db.prices[t])
    .sort((a, b) => (db.prices[a].returnPct ?? 0) - (db.prices[b].returnPct ?? 0));
  return [...sortPendingForHarvest(pending, universeOrder), ...cached];
}

function chunkInto50(tickers: string[]): string[][] {
  const unique = dedup(tickers);
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    if (chunk.length === 50) {
      chunks.push(chunk);
    } else if (chunk.length > 0) {
      const padding = unique.filter(t => !chunk.includes(t)).slice(0, 50 - chunk.length);
      chunks.push([...chunk, ...padding]);
    }
  }
  return chunks;
}

/**
 * Pack harvest submits: unknown prices first (max new tickers per batch), then padding
 * from known names sorted by lowest return (keeps “lottery” slots for untested tickers).
 */
function buildHarvestBatches(tickers: string[], db: PriceDB): string[][] {
  const universeOrder = dedup(tickers);
  const unique = universeOrder.filter(t => !badTickers.has(t));
  const pending = sortPendingForHarvest(
    unique.filter(t => !db.prices[t]),
    universeOrder,
  );
  const fillers = unique
    .filter(t => db.prices[t])
    .sort((a, b) => (db.prices[a].returnPct ?? 0) - (db.prices[b].returnPct ?? 0));
  const ordered = [...pending, ...fillers];
  return chunkInto50(ordered);
}

function extractBadTicker(errorStr: string): string | null {
  const up = (s: string) => s.toUpperCase();
  const m0 = errorStr.match(/(\w+): No closing price found/i);
  if (m0) return up(m0[1]);
  const m = errorStr.match(/(\w+): Failed to fetch historical price/);
  if (m) return up(m[1]);
  const m2 = errorStr.match(/Price fetch failed.*?(\b[A-Z]{1,5}\b): Failed/);
  if (m2) return m2[1];
  const m3 = errorStr.match(/Missing price data for (\w+)/i);
  if (m3) return up(m3[1]);
  return null;
}

/** Convex often returns several bad symbols in one message separated by ";". */
function extractAllBadTickers(detail: string): string[] {
  const seen = new Set<string>();
  for (const chunk of detail.split(/;\s*/)) {
    const b = extractBadTicker(chunk.trim());
    if (b) seen.add(b);
  }
  const whole = extractBadTicker(detail);
  if (whole) seen.add(whole);
  return [...seen];
}

function logAllocationAudit(audit: PortfolioAudit) {
  const status = audit.valid ? "PASS" : "FAIL";
  console.log(
    `   [VERIFY:${status}] ${audit.name} lines=${audit.lineCount} unique=${audit.uniqueCount} total=$${audit.totalAmount.toLocaleString()} min=$${audit.minAmount.toLocaleString()}`,
  );
  if (!audit.valid) {
    console.log(`   [VERIFY:DETAIL] ${audit.error}`);
  }
}

async function submitAndHarvest(
  tickers: string[],
  batchLabel: string,
  db: PriceDB,
  retryCount = 0,
): Promise<number> {
  const validTickers = tickers.filter(t => !badTickers.has(t));
  if (validTickers.length < MIN_STOCKS) {
    console.error(`   ❌ Not enough valid tickers (${validTickers.length})`);
    return 0;
  }

  const use = validTickers.slice(0, 50);
  const allocations = buildEqualAllocations(use);
  logAllocationAudit(auditAllocations(`${batchLabel}:harvest`, allocations));
  const teamId = process.env.CALA_TEAM_ID?.trim();
  if (!teamId) throw new Error("CALA_TEAM_ID required");

  const body = {
    team_id: teamId,
    model_agent_name: "harvester",
    model_agent_version: batchLabel,
    transactions: allocations,
  };

  console.log(`\n📤 Submitting "${batchLabel}": ${use.length} stocks${retryCount ? ` (retry ${retryCount})` : ""}`);

  const apiKey = process.env.CALA_API_KEY?.trim();
  const authHeaders: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  try {
    const result = await fetchJsonWithTimeout<Record<string, unknown>>(submitUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(body),
    });

    const purchasePrices = (result.purchase_prices_apr15 ?? {}) as Record<string, number>;
    const evalPrices = (result.eval_prices_today ?? {}) as Record<string, number>;
    const totalValue = result.total_value as number;
    const totalInvested = result.total_invested as number;
    const returnPct = totalInvested ? ((totalValue - totalInvested) / totalInvested) * 100 : 0;

    console.log(`   ✅ Portfolio: $${totalValue?.toLocaleString()} (${returnPct > 0 ? "+" : ""}${returnPct.toFixed(2)}%)`);

    let newCount = 0;
    const harvestTs = new Date().toISOString();
    for (const ticker of Object.keys(purchasePrices)) {
      const pp = purchasePrices[ticker];
      const ep = evalPrices[ticker];
      if (pp && ep) {
        const ret = ((ep - pp) / pp) * 100;
        const isNew = !db.prices[ticker];
        db.prices[ticker] = { ticker, purchasePrice: pp, evalPrice: ep, returnPct: ret, lastHarvestedAt: harvestTs };
        if (isNew) newCount++;
      }
    }

    console.log(`   📊 Harvested ${Object.keys(purchasePrices).length} prices (${newCount} new)`);
    return newCount;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const bads = extractAllBadTickers(String(detail));
    if (bads.length > 0 && retryCount < HARVEST_RETRY_LIMIT) {
      console.log(`   ⚠️  Bad ticker(s): ${bads.join(", ")} — removing and retrying`);
      for (const b of bads) badTickers.add(b);
      savePersistedBadTickers(badTickers);
      const newTickers = use.filter(t => !bads.includes(t));
      while (newTickers.length < MIN_STOCKS) {
        const replacement = harvestReplacementCandidates(db, HARVEST_UNIVERSE).find(t => !newTickers.includes(t));
        if (!replacement) break;
        newTickers.push(replacement);
      }
      if (newTickers.length < MIN_STOCKS) {
        console.error(
          `   ❌ Cannot refill batch to ${MIN_STOCKS} after removing ${bads.length} bad ticker(s)`,
        );
        return 0;
      }
      return submitAndHarvest(newTickers.slice(0, MIN_STOCKS), batchLabel, db, retryCount + 1);
    }
    const isNetworkError = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|abort/i.test(detail);
    if (isNetworkError && retryCount < 3) {
      const backoff = (retryCount + 1) * 2000;
      console.log(`   ⚠️  Network error, retrying in ${backoff / 1000}s... (${detail.slice(0, 80)})`);
      await new Promise(r => setTimeout(r, backoff));
      return submitAndHarvest(tickers, batchLabel, db, retryCount + 1);
    }
    console.error(`   ❌ Failed: ${String(detail).slice(0, 200)}`);
    return 0;
  }
}

async function harvest() {
  const db = loadPriceDB();
  maybeWarnStalePriceDb(db);
  const unique = HARVEST_UNIVERSE;
  const pending = unique.filter(t => !db.prices[t] && !badTickers.has(t));
  let chunks = buildHarvestBatches(HARVEST_UNIVERSE, db);
  const maxBatches = Number(process.env.CALA_HARVEST_MAX_BATCHES ?? "0");
  if (maxBatches > 0 && chunks.length > maxBatches) {
    console.log(`   CALA_HARVEST_MAX_BATCHES=${maxBatches}: limiting to first ${maxBatches}/${chunks.length} batch(es)`);
    chunks = chunks.slice(0, maxBatches);
  }

  console.log(
    `🌾 Price Harvester — ${unique.length} harvest universe (${ALL_TICKERS.length} raw list, ${UNIVERSE_RAW_INVALID_FORMAT} invalid-format dropped), ${pending.length} pending, ${chunks.length} batch(es), concurrency=${CONCURRENCY}`,
  );
  console.log(`   Cached: ${Object.keys(db.prices).length} | Bad: ${badTickers.size}`);
  console.log(
    `   Note: prices come from live submit responses (Apr-15 buy vs mark); refresh with --harvest before trusting --optimize.\n`,
  );

  if (chunks.length === 0) {
    console.log("   Nothing to harvest (all known or blocked). Use --show or expand ALL_TICKERS.");
    showRankings(db);
    appendCalaRunLog(DATA_DIR, {
      phase: "harvest",
      team_id: process.env.CALA_TEAM_ID?.trim() ?? null,
      price_db_count: Object.keys(db.prices).length,
      bad_ticker_count: badTickers.size,
      harvest_new_prices: 0,
      harvest_elapsed_s: 0,
    });
    schedulePriceDbSupabaseSync(db);
    return;
  }

  let totalNew = 0;
  let completed = 0;
  const t0 = Date.now();

  for (let waveStart = 0; waveStart < chunks.length; waveStart += CONCURRENCY) {
    const wave = chunks.slice(waveStart, waveStart + CONCURRENCY);
    const waveIdx = wave.map((_, j) => waveStart + j);

    const elapsed = Date.now() - t0;
    if (completed > 0) {
      const perBatch = elapsed / completed;
      const remaining = (chunks.length - completed) * perBatch / CONCURRENCY;
      console.log(
        `\n⏱️  Wave ${Math.floor(waveStart / CONCURRENCY) + 1}/${Math.ceil(chunks.length / CONCURRENCY)} — ${completed}/${chunks.length} done, ~${Math.ceil(remaining / 1000)}s remaining`,
      );
    }

    const results = await Promise.allSettled(
      wave.map(async (chunk, j) => {
        const idx = waveIdx[j];
        const unknownInBatch = chunk.filter(t => !db.prices[t] && !badTickers.has(t));
        console.log(`   [${idx}] ${unknownInBatch.length} new tickers (+ padding to 50)`);
        await new Promise(r => setTimeout(r, j * 500));
        return submitAndHarvest(chunk, `harvest_${idx}`, db);
      }),
    );

    for (const r of results) {
      completed++;
      if (r.status === "fulfilled") {
        totalNew += r.value;
      } else {
        console.error(`   ❌ Batch error: ${r.reason}`);
      }
    }

    savePriceDB(db);
    savePersistedBadTickers(badTickers);

    if (waveStart + CONCURRENCY < chunks.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  syncCompaniesToOmnigraph(db);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n✅ Harvest complete: ${Object.keys(db.prices).length} total prices (${totalNew} new) in ${elapsed}s`);
  console.log(`   Bad tickers (persisted): ${badTickers.size}`);
  appendCalaRunLog(DATA_DIR, {
    phase: "harvest",
    team_id: process.env.CALA_TEAM_ID?.trim() ?? null,
    price_db_count: Object.keys(db.prices).length,
    bad_ticker_count: badTickers.size,
    harvest_new_prices: totalNew,
    harvest_elapsed_s: Number(elapsed),
  });
  schedulePriceDbSupabaseSync(db);
  showRankings(db);
}

function showRankings(db: PriceDB) {
  const entries = Object.values(db.prices).sort((a, b) => b.returnPct - a.returnPct);

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  TOP PERFORMERS (Apr 15 2025 → Today)`);
  console.log(`${"═".repeat(70)}`);
  const fmtPrice = (v: number) => {
    if (v < 0.001) return v.toExponential(2);
    if (v < 1) return v.toFixed(4);
    return v.toFixed(2);
  };

  console.log(`  ${"Rank".padEnd(6)} ${"Ticker".padEnd(8)} ${"Buy Price".padStart(14)} ${"Now".padStart(14)} ${"Return".padStart(12)}`);
  console.log(`  ${"-".repeat(64)}`);

  for (let i = 0; i < Math.min(60, entries.length); i++) {
    const e = entries[i];
    const sign = e.returnPct >= 0 ? "+" : "";
    console.log(
      `  ${String(i + 1).padEnd(6)} ${e.ticker.padEnd(8)} $${fmtPrice(e.purchasePrice).padStart(13)} $${fmtPrice(e.evalPrice).padStart(13)} ${sign}${e.returnPct.toFixed(1)}%`,
    );
  }

  console.log(`\n  WORST PERFORMERS:`);
  const worst = [...entries].sort((a, b) => a.returnPct - b.returnPct).slice(0, 10);
  for (let i = 0; i < worst.length; i++) {
    const e = worst[i];
    const sign = e.returnPct >= 0 ? "+" : "";
    console.log(
      `  ${String(i + 1).padEnd(6)} ${e.ticker.padEnd(8)} $${fmtPrice(e.purchasePrice).padStart(13)} $${fmtPrice(e.evalPrice).padStart(13)} ${sign}${e.returnPct.toFixed(1)}%`,
    );
  }
}

async function optimize(dryRun: boolean) {
  const db = loadPriceDB();
  maybeWarnStalePriceDb(db);
  const entries = Object.values(db.prices).sort((a, b) => b.returnPct - a.returnPct);

  if (entries.length < MIN_STOCKS) {
    console.error(`Need at least ${MIN_STOCKS} prices, have ${entries.length}. Run --harvest first.`);
    return;
  }

  showRankings(db);

  // Optimal strategy: put minimum ($5k) in the 49 worst-returning stocks,
  // and the remaining budget in the single best-returning stock.
  // But we must have 50 stocks. So: top 1 gets the bulk, bottom 49 get $5k each.
  // Actually more optimal: top N get weighted by return, bottom get minimum.

  // Strategy: allocate proportional to return for top stocks
  // First, reserve $5k × 49 = $245k for bottom 49 slots
  // Remaining $755k goes to #1
  // BUT: better to weight top stocks more heavily
  
  // Strategy A: Maximum concentration — #1 gets max, rest get min
  const strategyA = buildMaxConcentration(entries);
  
  // Strategy B: Top-weighted — top 10 get proportional, rest get min  
  const strategyB = buildTopWeighted(entries);
  
  // Strategy C: Return-proportional for top 50
  const strategyC = buildReturnProportional(entries);
  const strategyD = buildDualConcentration(entries);
  const strategyE = buildTripleConcentration(entries);

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  OPTIMIZATION STRATEGIES`);
  console.log(`${"═".repeat(70)}`);

  const strategies = [
    { name: "max_concentrate", allocs: strategyA },
    { name: "top_weighted", allocs: strategyB },
    { name: "return_proportional", allocs: strategyC },
    { name: "dual_concentrate", allocs: strategyD },
    { name: "triple_concentrate", allocs: strategyE },
  ];

  for (const s of strategies) {
    logAllocationAudit(auditAllocations(`optimize:${s.name}`, s.allocs));
    const err = validateAllocations(s.allocs);
    if (err) console.log(`\n  ⚠️  ${s.name} invalid: ${err}`);
  }

  const priceLookup = priceEntriesToLookup(Object.values(db.prices));
  for (const s of strategies) {
    const projectedValue = projectedTerminalValueUsd(s.allocs, priceLookup);
    const projectedReturn = ((projectedValue - TOTAL_BUDGET) / TOTAL_BUDGET) * 100;
    console.log(`\n  ${s.name}:`);
    console.log(`    Projected: $${projectedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${projectedReturn > 0 ? "+" : ""}${projectedReturn.toFixed(1)}%)`);
    console.log(`    Top 5: ${s.allocs.slice(0, 5).map(a => `${a.nasdaq_code}=$${a.amount.toLocaleString()}`).join(", ")}`);
  }

  const validStrategies = strategies.filter(s => validateAllocations(s.allocs) === null);
  if (validStrategies.length === 0) {
    console.error("   ❌ No valid allocation strategy (check builders / constraints).");
    return;
  }

  const projectedVal = (allocs: Allocation[]) => projectedTerminalValueUsd(allocs, priceLookup);

  const bestStrategy = validStrategies.reduce((best, s) =>
    projectedVal(s.allocs) > projectedVal(best.allocs) ? s : best,
  );

  console.log(`\n🏆 Best strategy: ${bestStrategy.name}`);
  const submitErr = validateAllocations(bestStrategy.allocs);
  if (submitErr) {
    console.error(`   ❌ Best strategy failed validation: ${submitErr}`);
    return;
  }

  const bestProjected = projectedVal(bestStrategy.allocs);
  const bestProjectedReturn = ((bestProjected - TOTAL_BUDGET) / TOTAL_BUDGET) * 100;

  if (dryRun) {
    console.log(`   --dry-run: skipping POST to ${submitUrl()}`);
    appendCalaRunLog(DATA_DIR, {
      phase: "optimize_dry_run",
      team_id: process.env.CALA_TEAM_ID?.trim() ?? null,
      best_strategy: bestStrategy.name,
      dry_run: true,
      projected_value_usd: bestProjected,
      projected_return_pct: bestProjectedReturn,
      price_db_count: entries.length,
    });
    return;
  }

  if (process.env.CALA_ALLOW_SUBMIT !== "1") {
    console.error(
      "   ❌ Live optimize submit blocked — set CALA_ALLOW_SUBMIT=1 after operator approval, or use --dry-run.",
    );
    appendCalaRunLog(DATA_DIR, {
      phase: "optimize_submit_blocked",
      team_id: process.env.CALA_TEAM_ID?.trim() ?? null,
      best_strategy: bestStrategy.name,
      dry_run: false,
      projected_value_usd: bestProjected,
      projected_return_pct: bestProjectedReturn,
      price_db_count: entries.length,
      error_message: "CALA_ALLOW_SUBMIT is not 1",
    });
    return;
  }

  const teamId = process.env.CALA_TEAM_ID?.trim();
  if (!teamId) throw new Error("CALA_TEAM_ID required");

  const apiKey = process.env.CALA_API_KEY?.trim();
  const authHeaders: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  async function trySubmit(allocs: Allocation[], stratName: string, attempt: number): Promise<Record<string, unknown> | null> {
    console.log(`   Submitting (attempt ${attempt})...`);
    try {
      return await fetchJsonWithTimeout<Record<string, unknown>>(submitUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          team_id: teamId,
          model_agent_name: "optimized",
          model_agent_version: `${stratName}_v${attempt}`,
          transactions: allocs,
        }),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`   ❌ Failed: ${msg}`);
      const rejected = extractBadTicker(msg);
      if (rejected && attempt < 5) {
        console.log(`   🔄 Skipping rejected ticker "${rejected}" and retrying...`);
        badTickers.add(rejected);
        savePersistedBadTickers(badTickers);
        const cleaned = Object.values(db.prices)
          .filter(e => !badTickers.has(e.ticker))
          .sort((a, b) => b.returnPct - a.returnPct);
        if (cleaned.length < MIN_STOCKS) {
          console.error(`   ❌ Not enough valid tickers after removing ${rejected}`);
          return null;
        }
        const newAllocs = allocationsForStrategy(stratName, cleaned);
        const err = validateAllocations(newAllocs);
        if (err) { console.error(`   ❌ Rebuild failed: ${err}`); return null; }
        return trySubmit(newAllocs, stratName, attempt + 1);
      }
      const isNetworkError = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|abort/i.test(msg);
      if (isNetworkError && attempt < 4) {
        const backoff = attempt * 2000;
        console.log(`   ⚠️  Network error, retrying in ${backoff / 1000}s...`);
        await new Promise(r => setTimeout(r, backoff));
        return trySubmit(allocs, stratName, attempt + 1);
      }
      return null;
    }
  }

  const result = await trySubmit(bestStrategy.allocs, bestStrategy.name, 1);
  if (!result) {
    appendCalaRunLog(DATA_DIR, {
      phase: "optimize_submit_failed",
      team_id: teamId,
      best_strategy: bestStrategy.name,
      projected_value_usd: bestProjected,
      projected_return_pct: bestProjectedReturn,
      error_message: "submit returned null (HTTP error or exhausted retries)",
    });
    return;
  }

  const value = result.total_value as number;
  const invested = result.total_invested as number;
  const ret = ((value - invested) / invested) * 100;
  console.log(`   ✅ ACTUAL: $${value?.toLocaleString()} (${ret > 0 ? "+" : ""}${ret.toFixed(2)}%)`);
  appendCalaRunLog(
    DATA_DIR,
    {
      phase: "optimize_submit",
      team_id: teamId,
      best_strategy: bestStrategy.name,
      submit_return_pct: ret,
      projected_value_usd: bestProjected,
      projected_return_pct: bestProjectedReturn,
      actual_total_value_usd: value,
      actual_invested_usd: invested,
      price_db_count: entries.length,
    },
    {
      holdings: bestStrategy.allocs.map((a) => ({
        ticker: a.nasdaq_code,
        amount: a.amount,
      })),
    },
  );

  // Reconcile submit return vs leaderboard row (debug drift / timing)
  try {
    const board = await tryFetchCalaLeaderboardRows(FETCH_TIMEOUT_MS);
    if (!board) {
      console.log("   📋 Leaderboard reconcile: skipped (snapshot unavailable)");
      appendCalaRunLog(DATA_DIR, {
        phase: "optimize_submit_leaderboard_reconcile",
        team_id: teamId,
        submit_return_pct: ret,
        leaderboard_return_pct: null,
        drift_pp: null,
        leaderboard_url: null,
        note: "leaderboard unavailable",
      });
    } else {
      const mineRow = board.rows.find((r) => leaderboardRowTeamId(r) === teamId);
      const lbPct = mineRow ? leaderboardRowReturnPct(mineRow) : null;
      const drift = lbPct != null ? ret - lbPct : null;
      const benchSlug =
        process.env.CALA_BENCHMARK_TEAM_ID?.trim().toLowerCase() || "sourish";
      const summary = summarizeLeaderboardForTeam(board.rows, teamId, {
        benchmarkTeamId: benchSlug,
      });
      console.log(
        `   📋 Submit vs leaderboard: submit=${ret.toFixed(2)}% | row=${lbPct != null ? lbPct.toFixed(2) : "n/a"}% | drift=${drift != null ? `${drift >= 0 ? "+" : ""}${drift.toFixed(2)}` : "n/a"} pp`,
      );
      if (summary.ourRank != null && summary.topReturnPct != null) {
        console.log(
          `   📋 Board rank: ${summary.ourRank} / ${summary.enriched.length} | gap vs #1: ${summary.gapToFirstPp?.toFixed(2) ?? "n/a"} pp | vs ${benchSlug}: ${summary.gapToBenchmarkPp?.toFixed(2) ?? "n/a"} pp`,
        );
      }
      appendCalaRunLog(DATA_DIR, {
        phase: "optimize_submit_leaderboard_reconcile",
        team_id: teamId,
        submit_return_pct: ret,
        leaderboard_return_pct: lbPct,
        drift_pp: drift,
        leaderboard_url: board.url,
        rank: summary.ourRank,
        our_return_pct: summary.ourReturnPct,
        top_return_pct: summary.topReturnPct,
        gap_to_first_pp: summary.gapToFirstPp,
        benchmark_team_id: summary.benchmarkTeamId,
        benchmark_return_pct: summary.benchmarkReturnPct,
        gap_to_benchmark_pp: summary.gapToBenchmarkPp,
        leaderboard_rows: summary.enriched.length,
        leaderboard_row_snapshot: mineRow
          ? {
              return_pct: toNumOrNull(mineRow.return_pct),
              total_value: toNumOrNull(mineRow.total_value),
              total_invested: toNumOrNull(
                mineRow.total_invested ?? mineRow.totalInvested,
              ),
            }
          : null,
        team_found_on_board: Boolean(mineRow),
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`   ⚠️  Leaderboard reconcile failed: ${msg}`);
    appendCalaRunLog(DATA_DIR, {
      phase: "optimize_submit_leaderboard_reconcile",
      team_id: teamId,
      submit_return_pct: ret,
      error_message: msg,
    });
  }

  // Update prices from response
  const pp = (result.purchase_prices_apr15 ?? {}) as Record<string, number>;
  const ep = (result.eval_prices_today ?? {}) as Record<string, number>;
  for (const ticker of Object.keys(pp)) {
    if (pp[ticker] && ep[ticker]) {
      const r = ((ep[ticker] - pp[ticker]) / pp[ticker]) * 100;
      db.prices[ticker] = { ticker, purchasePrice: pp[ticker], evalPrice: ep[ticker], returnPct: r };
    }
  }
  savePriceDB(db);
  schedulePriceDbSupabaseSync(db);

  const runId = `${bestStrategy.name}_${Date.now()}`;
  syncPortfolioRunToOmnigraph(runId, bestStrategy.name, value, ret, bestStrategy.allocs, db);
}

function allocationsForStrategy(name: string, entries: PriceEntry[]): Allocation[] {
  switch (name) {
    case "max_concentrate":
      return buildMaxConcentration(entries);
    case "top_weighted":
      return buildTopWeighted(entries);
    case "return_proportional":
      return buildReturnProportional(entries);
    case "dual_concentrate":
      return buildDualConcentration(entries);
    case "triple_concentrate":
      return buildTripleConcentration(entries);
    default:
      return buildMaxConcentration(entries);
  }
}

async function autoLoop() {
  console.log("\n🔄 AUTO LOOP MODE — harvest → optimize → repeat\n");
  let round = 0;
  while (true) {
    round++;
    console.log(`\n${"═".repeat(70)}`);
    console.log(`  ROUND ${round}`);
    console.log(`${"═".repeat(70)}`);

    await harvest();
    const db = loadPriceDB();
    if (Object.keys(db.prices).length >= MIN_STOCKS) {
      await optimize(false);
    }

    const topScore = await fetchTopScore();
    const myBest = await fetchMyBest();
    if (topScore === null) {
      console.log(
        `\n📊 Leaderboard unavailable (tried: ${calaLeaderboardUrlCandidates().join(", ")}). Set CALA_LEADERBOARD_URL to a JSON array endpoint, or add fallbacks in CALA_LEADERBOARD_URLS. My best cached estimate: ${myBest?.toFixed(1) ?? "?"}%`,
      );
      console.log("   Stopping auto loop — cannot compare to #1.");
      break;
    }
    console.log(`\n📊 Leaderboard #1: ${topScore}% | My best: ${myBest}%`);

    if (myBest >= topScore) {
      console.log("🏆 WE'RE #1! Stopping auto loop.");
      break;
    }

    console.log(`   Gap to close: ${(topScore - myBest).toFixed(1)}%`);
    console.log("   Looping in 2s...\n");
    await new Promise(r => setTimeout(r, 2000));
  }
}

async function fetchTopScore(): Promise<number | null> {
  const got = await tryFetchCalaLeaderboardRows(FETCH_TIMEOUT_MS);
  if (!got) return null;
  let best: number | null = null;
  for (const row of got.rows) {
    const p = leaderboardRowReturnPct(row);
    if (p != null && (best === null || p > best)) best = p;
  }
  return best;
}

async function fetchMyBest(): Promise<number> {
  const teamId = process.env.CALA_TEAM_ID?.trim();
  if (!teamId) return 0;
  const got = await tryFetchCalaLeaderboardRows(FETCH_TIMEOUT_MS);
  if (!got) return 0;
  const mine = got.rows.find((e) => leaderboardRowTeamId(e) === teamId);
  if (!mine) return 0;
  return leaderboardRowReturnPct(mine) ?? 0;
}

async function printLeaderboardCli() {
  console.log(`Trying leaderboard URLs: ${calaLeaderboardUrlCandidates().join(" | ")}`);
  let data: Record<string, unknown>[];
  let usedUrl: string;
  try {
    const got = await fetchCalaLeaderboardRows(FETCH_TIMEOUT_MS);
    data = got.rows;
    usedUrl = got.url;
    console.log(`OK — JSON from ${usedUrl} (${data.length} row(s))`);
  } catch (error) {
    const hint = error instanceof Error ? error.message : String(error);
    console.error(hint);
    console.error(
      `  Set CALA_LEADERBOARD_URL to the operator’s JSON scoreboard URL (must return a non-empty array).`,
    );
    console.error(
      `  If you only have a dashboard page URL, set CALA_LEADERBOARD_URL to that origin — we also try /api/leaderboard on the same host. Add more bases via CALA_LEADERBOARD_URLS (comma-separated).`,
    );
    return;
  }
  const teamId = process.env.CALA_TEAM_ID?.trim();
  const benchSlug = process.env.CALA_BENCHMARK_TEAM_ID?.trim().toLowerCase() || "sourish";
  const summary = summarizeLeaderboardForTeam(data, teamId ?? null, {
    benchmarkTeamId: benchSlug,
  });
  const enriched = summary.enriched.map((x, i) => ({ row: x.row, i, pct: x.pct }));

  if (teamId) {
    if (summary.ourRank != null && summary.ourReturnPct != null) {
      const ours = summary.ourReturnPct;
      console.log(
        `\n  Your rank: ${summary.ourRank} / ${enriched.length}  |  return ${(ours >= 0 ? "+" : "") + ours.toFixed(2)}%  |  gap vs #1: ${(summary.gapToFirstPp ?? 0).toFixed(2)} pp`,
      );
    } else {
      console.log(`\n  CALA_TEAM_ID=${teamId} not found on this leaderboard snapshot (${enriched.length} row(s) with return %).`);
    }
  } else {
    console.log(`\n  Set CALA_TEAM_ID to see your rank and gap vs #1.`);
  }

  console.log(`\n${"═".repeat(72)}`);
  console.log(`  Rank  Return %   Team / id`);
  console.log(`${"─".repeat(72)}`);
  for (let r = 0; r < Math.min(20, enriched.length); r++) {
    const { row, pct } = enriched[r];
    const id = leaderboardRowTeamId(row) || "?";
    const name = String(row.team_name ?? row.name ?? "");
    const label = name ? `${name} (${id})` : id;
    const mine = teamId && id === teamId ? "  ← you" : "";
    console.log(`  ${String(r + 1).padStart(4)}  ${(pct >= 0 ? "+" : "") + pct.toFixed(2).padStart(9)}%   ${label}${mine}`);
  }
  console.log(`${"═".repeat(72)}\n`);

  appendCalaRunLog(DATA_DIR, {
    phase: "leaderboard",
    team_id: teamId ?? null,
    rank: summary.ourRank,
    our_return_pct: summary.ourReturnPct,
    top_return_pct: summary.topReturnPct,
    gap_to_first_pp: summary.gapToFirstPp,
    benchmark_team_id: summary.benchmarkTeamId,
    benchmark_return_pct: summary.benchmarkReturnPct,
    gap_to_benchmark_pp: summary.gapToBenchmarkPp,
    leaderboard_rows: enriched.length,
  });
  if (summary.benchmarkReturnPct != null && summary.ourReturnPct != null) {
    console.log(
      `  Benchmark "${benchSlug}": ${summary.benchmarkReturnPct >= 0 ? "+" : ""}${summary.benchmarkReturnPct.toFixed(2)}%  |  your gap vs ${benchSlug}: ${(summary.gapToBenchmarkPp ?? 0).toFixed(2)} pp`,
    );
  } else if (summary.benchmarkReturnPct != null && teamId && summary.ourReturnPct == null) {
    console.log(
      `  Benchmark "${benchSlug}": ${summary.benchmarkReturnPct >= 0 ? "+" : ""}${summary.benchmarkReturnPct.toFixed(2)}%  (set CALA_TEAM_ID to your team slug to compare)`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  if (args.includes("--retry-bad")) {
    const hoursArg = args.find(a => a.startsWith("--retry-bad-hours="));
    const hours = hoursArg ? Number(hoursArg.split("=")[1]) : 0;
    const retryable = retryableBadTickers(badTickerEntries, hours);
    if (retryable.length === 0) {
      console.log("No retryable bad tickers found.");
    } else {
      console.log(`♻️  Re-enabling ${retryable.length} bad ticker(s) for retry (failed >${hours}h ago):`);
      console.log(`   ${retryable.join(", ")}`);
      for (const t of retryable) badTickers.delete(t);
      badTickerEntries = badTickerEntries.filter((e) => !retryable.includes(e.ticker));
      serializeBadTickerFile(BAD_TICKERS_PATH, badTickerEntries);
    }
    if (!args.includes("--harvest")) return;
  }

  if (args.includes("--harvest")) {
    await harvest();
  } else if (args.includes("--optimize")) {
    await optimize(dryRun);
  } else if (args.includes("--show")) {
    const db = loadPriceDB();
    maybeWarnStalePriceDb(db);
    console.log(`Price DB: ${Object.keys(db.prices).length} tickers (updated ${db.lastUpdated})`);
    showRankings(db);
  } else if (args.includes("--auto")) {
    await autoLoop();
  } else if (args.includes("--leaderboard")) {
    await printLeaderboardCli();
  } else {
    console.log("Usage:");
    console.log("  --harvest    Collect prices by submitting test batches");
    console.log("  --optimize   Build & submit optimal portfolio from cached prices");
    console.log("  --dry-run    With --optimize: print best strategy, do not POST");
    console.log("  --show       Show cached rankings");
    console.log("  --leaderboard  Print live scoreboard (sorted by return)");
    console.log("  --auto       Continuous loop: harvest → optimize → repeat");
    console.log("  --retry-bad  Re-enable all bad tickers for retry (combine with --harvest)");
    console.log("  --retry-bad --retry-bad-hours=N  Only retry tickers that failed >N hours ago");
    console.log(
      "  Env: CALA_LEADERBOARD_URL, CALA_LEADERBOARD_URLS, CALA_SUBMIT_URL; CALA_ALLOW_SUBMIT=1 for live --optimize POST",
    );
    console.log(
      "  Harvest universe: CALA_EXTRA_TICKERS, CALA_HARVEST_CANDIDATE_FILES, CALA_MERGE_RESEARCH_CANDIDATES (≠0 merges data/research-harvest-candidates.json if present), CALA_HARVEST_MAX_BATCHES, CALA_PRICE_DB_WARN_STALE_HOURS",
    );
  }
}

export { harvest, optimize, autoLoop, loadPriceDB, showRankings };

const isCli =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].includes("price-harvester") || process.argv[1].includes("tsx"));

if (isCli) {
  main().catch(err => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
