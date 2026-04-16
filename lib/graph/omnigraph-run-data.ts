/**
 * Load portfolio run summaries and per-company committee views from Omnigraph,
 * shaped to match {@link PortfolioRunSummary} / {@link CompanyDecision} for the UI.
 */
import {
  getOmnigraphClient,
  type OmnigraphClient,
  type OmnigraphReadResult,
} from "@/lib/omnigraph";
import { probeOmnigraphHealth } from "@/lib/omnigraph/client";
import type {
  CompanyDecision,
  ConvictionBand,
  EvidenceRef,
  PortfolioRunSummary,
} from "@/lib/types";

const OG_PROBE = { timeoutMs: 2_000, retries: 0 as const };

function normalizeBand(v: unknown): ConvictionBand {
  const s = String(v ?? "C").toUpperCase();
  if (s === "A" || s === "B" || s === "C") return s;
  return "C";
}

function clampScore(n: number): number {
  if (Number.isNaN(n)) return 50;
  return Math.min(100, Math.max(0, n));
}

/** Prefer requested run id when it has holdings; otherwise latest run with holdings. */
export async function resolveEffectiveRunId(
  og: OmnigraphClient,
  preferredRunId: string,
): Promise<string | null> {
  const tryHoldings = async (runId: string) => {
    const h = await og.read<OmnigraphReadResult>("holdings_for_run", { run_id: runId });
    return h.row_count > 0 ? runId : null;
  };

  const primary = await tryHoldings(preferredRunId);
  if (primary) return primary;

  const latest = await og.read<OmnigraphReadResult>("latest_run");
  if (latest.row_count === 0) return null;
  const latestId = String(latest.rows[0].run_id);
  return tryHoldings(latestId);
}

export async function loadPortfolioRunSummaryFromOmnigraph(
  runId: string,
): Promise<PortfolioRunSummary | null> {
  const healthy = await probeOmnigraphHealth(OG_PROBE).catch(() => false);
  if (!healthy) return null;

  const og = getOmnigraphClient();
  const effective = await resolveEffectiveRunId(og, runId);
  if (!effective) return null;

  const [holdingsRes, runsRes] = await Promise.all([
    og.read<OmnigraphReadResult>("holdings_for_run", { run_id: effective }),
    og.read<OmnigraphReadResult>("all_runs"),
  ]);

  if (holdingsRes.row_count === 0) return null;

  const meta =
    runsRes.rows.find((r) => String(r.run_id) === effective) ?? runsRes.rows[0] ?? {};

  return {
    id: effective,
    branchLabel: String(meta.branch_label ?? "main"),
    benchmarkNote: "",
    portfolioValueUsd: Number(meta.portfolio_value_usd ?? 0),
    updatedAt: String(meta.updated_at ?? new Date().toISOString()),
    holdings: holdingsRes.rows.map((r) => ({
      ticker: String(r.ticker ?? "").toUpperCase(),
      name: String(r.name ?? r.ticker ?? ""),
      weightPct: Number(r.weight_pct ?? 0),
      convictionBand: normalizeBand(r.conviction_band),
    })),
  };
}

function defaultAnalyst(
  kind: "quality" | "growth" | "risk",
): CompanyDecision["quality"] | CompanyDecision["growth"] | CompanyDecision["risk"] {
  const base = {
    score: 50,
    summary: `No ${kind} analyst node linked in Omnigraph for this company.`,
    evidenceIds: [] as string[],
  };
  if (kind === "quality") {
    return { ...base, keyStrengths: [] as string[], keyConcerns: [] as string[] };
  }
  if (kind === "growth") {
    return { ...base, growthDrivers: [] as string[], headwinds: [] as string[] };
  }
  return { ...base, risks: [] as string[], mitigations: [] as string[] };
}

function analystRow(
  rows: Record<string, unknown>[],
  role: "quality" | "growth" | "risk",
): Record<string, unknown> | undefined {
  return rows.find((r) => String(r.role).toLowerCase() === role);
}

function buildThesisFromFindings(
  findings: Record<string, unknown>[],
  evidenceIds: string[],
): CompanyDecision["thesis"] {
  const byScore = [...findings].sort(
    (a, b) => Number(b.score ?? 0) - Number(a.score ?? 0),
  );
  const top = byScore[0];
  const growthish = byScore.filter((f) =>
    /growth|revenue|margin|sector|profit/i.test(String(f.finding_type ?? "")),
  );
  const bull = growthish[0] ?? top;
  const skeptic = byScore.find((f) => /margin|competition|pressure|headwind/i.test(String(f.finding_type ?? "")));
  const riskish = byScore.find((f) => /risk|debt|liquidity|downside/i.test(String(f.finding_type ?? "")));

  const pickIds = (n: number) =>
    evidenceIds.length > 0
      ? evidenceIds.slice(0, Math.min(n, evidenceIds.length))
      : [];

  return {
    bull: {
      narrative: bull
        ? String(bull.summary ?? "")
        : "Omnigraph has no research findings for this ticker yet.",
      evidenceIds: pickIds(3),
    },
    skeptic: {
      narrative: skeptic
        ? String(skeptic.summary ?? "")
        : "Add margin or competitive findings in Omnigraph to populate the skeptic view.",
      evidenceIds: pickIds(3),
    },
    risk: {
      narrative: riskish
        ? String(riskish.summary ?? "")
        : "Link risk-scored findings or a risk analyst report in Omnigraph.",
      evidenceIds: pickIds(3),
    },
  };
}

export async function loadCompanyDecisionFromOmnigraph(
  runId: string,
  ticker: string,
): Promise<CompanyDecision | null> {
  const healthy = await probeOmnigraphHealth(OG_PROBE).catch(() => false);
  if (!healthy) return null;

  const og = getOmnigraphClient();
  const upper = ticker.toUpperCase();
  const effectiveRun = await resolveEffectiveRunId(og, runId);
  if (!effectiveRun) return null;

  const holdings = await og.read<OmnigraphReadResult>("holdings_for_run", {
    run_id: effectiveRun,
  });
  const inPortfolio = holdings.rows.some((r) => String(r.ticker).toUpperCase() === upper);

  const [
    evidenceRes,
    calaEvRes,
    analystsRes,
    verdictRes,
    findingsRes,
    judgesRes,
    companiesRes,
  ] = await Promise.all([
    og.read<OmnigraphReadResult>("company_evidence", { ticker: upper }),
    og.read<OmnigraphReadResult>("company_cala_evidence", { ticker: upper }),
    og.read<OmnigraphReadResult>("company_analysts", { ticker: upper }),
    og.read<OmnigraphReadResult>("company_verdict", { ticker: upper }),
    og.read<OmnigraphReadResult>("company_findings", { ticker: upper }),
    og.read<OmnigraphReadResult>("judge_answers_for_company", { ticker: upper }),
    og.read<OmnigraphReadResult>("all_companies"),
  ]);

  const companyRow = companiesRes.rows.find((r) => String(r.ticker).toUpperCase() === upper);
  const hasAnySignal =
    companyRow != null ||
    inPortfolio ||
    evidenceRes.row_count > 0 ||
    calaEvRes.row_count > 0 ||
    findingsRes.row_count > 0 ||
    analystsRes.row_count > 0 ||
    verdictRes.row_count > 0 ||
    judgesRes.row_count > 0;
  if (!hasAnySignal) return null;

  const evidence: EvidenceRef[] = [
    ...evidenceRes.rows.map((r) => ({
      id: String(r.evidence_id ?? r.title ?? "evidence"),
      title: String(r.title ?? r.evidence_id ?? "Evidence"),
      source: r.source ? String(r.source) : undefined,
      excerpt: r.excerpt ? String(r.excerpt) : undefined,
    })),
    ...calaEvRes.rows.map((r) => ({
      id: String(r.evidence_id ?? "cala-evidence"),
      title: `Cala ${String(r.source_api ?? "api")}`,
      source: String(r.source_api ?? "cala"),
      excerpt: String(r.raw_excerpt ?? ""),
    })),
  ];

  const evIds = evidence.map((e) => e.id);
  const analysts = analystsRes.rows;
  const qRow = analystRow(analysts, "quality");
  const gRow = analystRow(analysts, "growth");
  const rRow = analystRow(analysts, "risk");

  const quality = qRow
    ? {
        score: clampScore(Number(qRow.score)),
        summary: String(qRow.summary ?? ""),
        keyStrengths: [] as string[],
        keyConcerns: [] as string[],
        evidenceIds: evIds.slice(0, 5),
      }
    : (defaultAnalyst("quality") as CompanyDecision["quality"]);

  const growth = gRow
    ? {
        score: clampScore(Number(gRow.score)),
        summary: String(gRow.summary ?? ""),
        growthDrivers: [] as string[],
        headwinds: [] as string[],
        evidenceIds: evIds.slice(0, 5),
      }
    : (defaultAnalyst("growth") as CompanyDecision["growth"]);

  const risk = rRow
    ? {
        score: clampScore(Number(rRow.score)),
        summary: String(rRow.summary ?? ""),
        risks: [] as string[],
        mitigations: [] as string[],
        evidenceIds: evIds.slice(0, 5),
      }
    : (defaultAnalyst("risk") as CompanyDecision["risk"]);

  const vRow = verdictRes.rows[0];
  const verdictStr = String(vRow?.verdict ?? "neutral").toLowerCase();
  const chairVerdict =
    verdictStr === "overweight" || verdictStr === "underweight" || verdictStr === "neutral"
      ? verdictStr
      : "neutral";

  const chair = vRow
    ? {
        confidence: clampScore(Number(vRow.confidence ?? 50)),
        allocationRationale: String(vRow.allocation_rationale ?? ""),
        dissent: vRow.dissent ? String(vRow.dissent) : undefined,
        verdict: chairVerdict as CompanyDecision["chair"]["verdict"],
      }
    : {
        confidence: 50,
        allocationRationale: inPortfolio
          ? "Holding present in Omnigraph portfolio run; no ChairVerdict node linked yet."
          : "Company exists in Omnigraph; not in the active run holdings list.",
        verdict: "neutral" as const,
      };

  const findings = findingsRes.rows;
  const thesis = buildThesisFromFindings(findings, evIds.length > 0 ? evIds : ["graph-placeholder"]);

  const judgeAnswers: CompanyDecision["judgeAnswers"] = {};
  for (const row of judgesRes.rows) {
    const pid = Number(row.preset_id);
    if (!Number.isFinite(pid)) continue;
    judgeAnswers[String(pid)] = {
      presetId: pid,
      answer: String(row.answer ?? ""),
      evidenceIds: [],
      dissent: row.dissent ? String(row.dissent) : undefined,
    };
  }

  return {
    ticker: upper,
    name: String(companyRow?.name ?? holdings.rows.find((h) => String(h.ticker).toUpperCase() === upper)?.name ?? upper),
    evidence,
    thesis,
    quality,
    growth,
    risk,
    chair,
    judgeAnswers,
  };
}
