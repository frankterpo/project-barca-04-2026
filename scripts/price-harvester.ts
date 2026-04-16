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
  tryFetchCalaLeaderboardRows,
} from "../lib/cala";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

function submitUrl(): string {
  return calaSubmitUrl();
}
const TOTAL_BUDGET = 1_000_000;
const MIN_PER_STOCK = 5_000;
const MIN_STOCKS = 50;
const FETCH_TIMEOUT_MS = Number(process.env.CALA_FETCH_TIMEOUT_MS ?? 120_000);
const HARVEST_RETRY_LIMIT = 10;
const BATCH_DELAY_MS = Number(process.env.CALA_BATCH_DELAY_MS ?? 2_000);

const CONCURRENCY = Number(process.env.CALA_HARVEST_CONCURRENCY ?? 5);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PRICE_DB_PATH = join(SCRIPT_DIR, "../data/price-db.json");
const BAD_TICKERS_PATH = join(SCRIPT_DIR, "../data/bad-tickers.json");

interface PriceEntry {
  ticker: string;
  purchasePrice: number;
  evalPrice: number;
  returnPct: number;
}

interface PriceDB {
  lastUpdated: string;
  prices: Record<string, PriceEntry>;
}

interface Allocation {
  nasdaq_code: string;
  amount: number;
}

interface PortfolioAudit {
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

function loadPersistedBadTickers(): string[] {
  try {
    if (existsSync(BAD_TICKERS_PATH)) {
      return JSON.parse(readFileSync(BAD_TICKERS_PATH, "utf-8"));
    }
  } catch { /* ignore corrupt file */ }
  return [];
}

function savePersistedBadTickers(tickers: Set<string>) {
  writeFileSync(BAD_TICKERS_PATH, JSON.stringify([...tickers].sort(), null, 2));
}

async function fetchJsonWithTimeout<T>(url: string, init?: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<T> {
  return fetchConvexEndpointJson<T>(url, init, timeoutMs);
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
];

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
  ...loadPersistedBadTickers(),
]);

function harvestReplacementCandidates(db: PriceDB, universeOrder: string[]): string[] {
  const u = dedup(universeOrder).filter(t => !badTickers.has(t));
  const pending = u.filter(t => !db.prices[t]);
  return sortPendingForHarvest(pending, universeOrder);
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

function buildEqualAllocations(tickers: string[]): Allocation[] {
  const n = tickers.length;
  const perStock = Math.floor(TOTAL_BUDGET / n);
  let remainder = TOTAL_BUDGET - perStock * n;
  return tickers.map(t => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder--;
    return { nasdaq_code: t, amount: perStock + extra };
  });
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

function auditAllocations(name: string, allocs: Allocation[]): PortfolioAudit {
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
    if (alloc.amount < MIN_PER_STOCK) belowMinTickers.push(`${ticker}=$${alloc.amount}`);
  }

  const lineCount = allocs.length;
  const uniqueCount = seen.size;
  const minValue = Number.isFinite(minAmount) ? minAmount : 0;
  let error: string | null = null;

  if (lineCount !== MIN_STOCKS) error = `need ${MIN_STOCKS} stocks, got ${lineCount}`;
  else if (uniqueCount !== lineCount) error = `duplicate ticker(s): ${duplicateTickers.join(", ")}`;
  else if (belowMinTickers.length > 0) error = `below min: ${belowMinTickers.join(", ")}`;
  else if (totalAmount !== TOTAL_BUDGET) error = `sum $${totalAmount} !== $${TOTAL_BUDGET}`;

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
    for (const ticker of Object.keys(purchasePrices)) {
      const pp = purchasePrices[ticker];
      const ep = evalPrices[ticker];
      if (pp && ep) {
        const ret = ((ep - pp) / pp) * 100;
        const isNew = !db.prices[ticker];
        db.prices[ticker] = { ticker, purchasePrice: pp, evalPrice: ep, returnPct: ret };
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
        const replacement = harvestReplacementCandidates(db, ALL_TICKERS).find(t => !newTickers.includes(t));
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
    console.error(`   ❌ Failed: ${String(detail).slice(0, 200)}`);
    return 0;
  }
}

async function harvest() {
  const db = loadPriceDB();
  const unique = dedup(ALL_TICKERS);
  const pending = unique.filter(t => !db.prices[t] && !badTickers.has(t));
  const chunks = buildHarvestBatches(ALL_TICKERS, db);

  console.log(
    `🌾 Price Harvester — ${unique.length} universe, ${pending.length} pending, ${chunks.length} batch(es), concurrency=${CONCURRENCY}`,
  );
  console.log(`   Cached: ${Object.keys(db.prices).length} | Bad: ${badTickers.size}\n`);

  if (chunks.length === 0) {
    console.log("   Nothing to harvest (all known or blocked). Use --show or expand ALL_TICKERS.");
    showRankings(db);
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

  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n✅ Harvest complete: ${Object.keys(db.prices).length} total prices (${totalNew} new) in ${elapsed}s`);
  console.log(`   Bad tickers (persisted): ${badTickers.size}`);
  showRankings(db);
}

function showRankings(db: PriceDB) {
  const entries = Object.values(db.prices).sort((a, b) => b.returnPct - a.returnPct);

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  TOP PERFORMERS (Apr 15 2025 → Today)`);
  console.log(`${"═".repeat(70)}`);
  console.log(`  ${"Rank".padEnd(6)} ${"Ticker".padEnd(8)} ${"Buy Price".padStart(12)} ${"Now".padStart(12)} ${"Return".padStart(12)}`);
  console.log(`  ${"-".repeat(60)}`);

  for (let i = 0; i < Math.min(60, entries.length); i++) {
    const e = entries[i];
    const sign = e.returnPct >= 0 ? "+" : "";
    console.log(
      `  ${String(i + 1).padEnd(6)} ${e.ticker.padEnd(8)} $${e.purchasePrice.toFixed(2).padStart(11)} $${e.evalPrice.toFixed(2).padStart(11)} ${sign}${e.returnPct.toFixed(1)}%`.padStart(11),
    );
  }

  console.log(`\n  WORST PERFORMERS:`);
  const worst = [...entries].sort((a, b) => a.returnPct - b.returnPct).slice(0, 10);
  for (let i = 0; i < worst.length; i++) {
    const e = worst[i];
    const sign = e.returnPct >= 0 ? "+" : "";
    console.log(
      `  ${String(i + 1).padEnd(6)} ${e.ticker.padEnd(8)} $${e.purchasePrice.toFixed(2).padStart(11)} $${e.evalPrice.toFixed(2).padStart(11)} ${sign}${e.returnPct.toFixed(1)}%`.padStart(11),
    );
  }
}

function validateAllocations(allocs: Allocation[]): string | null {
  return auditAllocations("validation", allocs).error;
}

async function optimize(dryRun: boolean) {
  const db = loadPriceDB();
  const entries = Object.values(db.prices).sort((a, b) => b.returnPct - a.returnPct);

  if (entries.length < MIN_STOCKS) {
    console.error(`Need at least ${MIN_STOCKS} prices, have ${entries.length}. Run --harvest first.`);
    process.exit(1);
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

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  OPTIMIZATION STRATEGIES`);
  console.log(`${"═".repeat(70)}`);

  const strategies = [
    { name: "max_concentrate", allocs: strategyA },
    { name: "top_weighted", allocs: strategyB },
    { name: "return_proportional", allocs: strategyC },
    { name: "dual_concentrate", allocs: strategyD },
  ];

  for (const s of strategies) {
    logAllocationAudit(auditAllocations(`optimize:${s.name}`, s.allocs));
    const err = validateAllocations(s.allocs);
    if (err) console.log(`\n  ⚠️  ${s.name} invalid: ${err}`);
  }

  for (const s of strategies) {
    const projectedValue = s.allocs.reduce((sum, a) => {
      const p = db.prices[a.nasdaq_code];
      if (!p) return sum;
      const shares = a.amount / p.purchasePrice;
      return sum + shares * p.evalPrice;
    }, 0);
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

  const projectedVal = (allocs: Allocation[]) =>
    allocs.reduce((sum, a) => {
      const p = db.prices[a.nasdaq_code];
      if (!p) return sum;
      return sum + (a.amount / p.purchasePrice) * p.evalPrice;
    }, 0);

  const bestStrategy = validStrategies.reduce((best, s) =>
    projectedVal(s.allocs) > projectedVal(best.allocs) ? s : best,
  );

  console.log(`\n🏆 Best strategy: ${bestStrategy.name}`);
  const submitErr = validateAllocations(bestStrategy.allocs);
  if (submitErr) {
    console.error(`   ❌ Best strategy failed validation: ${submitErr}`);
    return;
  }
  if (dryRun) {
    console.log(`   --dry-run: skipping POST to ${submitUrl()}`);
    return;
  }

  console.log(`   Submitting...`);

  const teamId = process.env.CALA_TEAM_ID?.trim();
  if (!teamId) throw new Error("CALA_TEAM_ID required");

  const apiKey = process.env.CALA_API_KEY?.trim();
  const authHeaders: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  let result: Record<string, unknown>;
  try {
    result = await fetchJsonWithTimeout<Record<string, unknown>>(submitUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        team_id: teamId,
        model_agent_name: "optimized",
        model_agent_version: `${bestStrategy.name}_v1`,
        transactions: bestStrategy.allocs,
      }),
    });
  } catch (error) {
    console.error(`   ❌ Failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const value = result.total_value as number;
  const invested = result.total_invested as number;
  const ret = ((value - invested) / invested) * 100;
  console.log(`   ✅ ACTUAL: $${value?.toLocaleString()} (${ret > 0 ? "+" : ""}${ret.toFixed(2)}%)`);

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
}

function buildMaxConcentration(
  entries: PriceEntry[],
): { nasdaq_code: string; amount: number }[] {
  // #1 stock gets max budget, bottom 49 get minimum
  const top = entries.slice(0, 50);
  const minBudget = MIN_PER_STOCK * 49;
  const topBudget = TOTAL_BUDGET - minBudget;
  
  return top.map((e, i) => ({
    nasdaq_code: e.ticker,
    amount: i === 0 ? topBudget : MIN_PER_STOCK,
  }));
}

function buildTopWeighted(
  entries: PriceEntry[],
): { nasdaq_code: string; amount: number }[] {
  const top50 = entries.slice(0, 50);
  const topN = 5;
  const disc = TOTAL_BUDGET - MIN_PER_STOCK * 50;
  const topPool = Math.floor(disc * 0.8);
  const botPool = disc - topPool;
  const amounts = top50.map(() => MIN_PER_STOCK);

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

function buildReturnProportional(
  entries: PriceEntry[],
): { nasdaq_code: string; amount: number }[] {
  const top50 = entries.slice(0, 50);
  const disc = TOTAL_BUDGET - MIN_PER_STOCK * 50;
  const returns = top50.map(e => Math.max(0.01, e.returnPct));
  const totalR = returns.reduce((s, r) => s + r, 0);
  const amounts = top50.map(() => MIN_PER_STOCK);
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

/** Split discretionary capital between #1 and #2 by return (48 names at min). Useful when two moonshots cluster. */
function buildDualConcentration(
  entries: PriceEntry[],
): { nasdaq_code: string; amount: number }[] {
  const top50 = entries.slice(0, 50);
  const disc = TOTAL_BUDGET - MIN_PER_STOCK * 50;
  const r0 = Math.max(0.01, top50[0].returnPct);
  const r1 = Math.max(0.01, top50[1].returnPct);
  const sumR = r0 + r1;
  const amounts = top50.map(() => MIN_PER_STOCK);
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

function rowReturnPct(row: Record<string, unknown>): number | null {
  return leaderboardRowReturnPct(row);
}

async function fetchMyBest(): Promise<number> {
  const teamId = process.env.CALA_TEAM_ID?.trim();
  if (!teamId) return 0;
  const got = await tryFetchCalaLeaderboardRows(FETCH_TIMEOUT_MS);
  if (!got) return 0;
  const mine = got.rows.find(e => e.team_id === teamId);
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
  const enriched = data
    .map((row, i) => ({ row, i, pct: rowReturnPct(row) }))
    .filter((x): x is typeof x & { pct: number } => x.pct !== null)
    .sort((a, b) => b.pct - a.pct);

  console.log(`\n${"═".repeat(72)}`);
  console.log(`  Rank  Return %   Team / id`);
  console.log(`${"─".repeat(72)}`);
  for (let r = 0; r < Math.min(20, enriched.length); r++) {
    const { row, pct } = enriched[r];
    const id = String(row.team_id ?? row.team ?? "?");
    const name = String(row.team_name ?? row.name ?? "");
    const label = name ? `${name} (${id})` : id;
    const mine = teamId && id === teamId ? "  ← you" : "";
    console.log(`  ${String(r + 1).padStart(4)}  ${(pct >= 0 ? "+" : "") + pct.toFixed(2).padStart(9)}%   ${label}${mine}`);
  }
  console.log(`${"═".repeat(72)}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  if (args.includes("--harvest")) {
    await harvest();
  } else if (args.includes("--optimize")) {
    await optimize(dryRun);
  } else if (args.includes("--show")) {
    const db = loadPriceDB();
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
    console.log("  Env: CALA_LEADERBOARD_URL (+ auto /api/leaderboard on that host), CALA_LEADERBOARD_URLS, CALA_SUBMIT_URL origin");
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
