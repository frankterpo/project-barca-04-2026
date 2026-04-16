import { NextResponse } from "next/server";

import { getOmnigraphClient } from "@/lib/omnigraph/client";
import type { OmnigraphReadResult } from "@/lib/omnigraph/client";
import type { JudgeAnswer } from "@/lib/types";
import { JUDGE_PRESETS } from "@/lib/judge-presets";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker");
  const presetRaw = url.searchParams.get("presetId");
  if (!ticker || !presetRaw) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_QUERY", message: "ticker and presetId are required" } },
      { status: 400 },
    );
  }
  const presetId = Number(presetRaw);
  if (!Number.isFinite(presetId)) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_QUERY", message: "presetId must be a number" } },
      { status: 400 },
    );
  }

  const og = getOmnigraphClient();

  try {
    const cached = await og.read<OmnigraphReadResult>("judge_answer_single", {
      ticker: ticker.toUpperCase(),
      preset_id: presetId,
    });
    if (cached.row_count > 0) {
      const row = cached.rows[0];
      const answer: JudgeAnswer = {
        presetId: Number(row.preset_id ?? presetId),
        answer: String(row.answer ?? ""),
        evidenceIds: [],
        dissent: row.dissent ? String(row.dissent) : undefined,
      };
      return NextResponse.json({ ok: true, answer });
    }
  } catch {
    // Omnigraph unreachable or query failed — fall through to synthesis
  }

  const answer = await synthesizeFromProfile(og, ticker.toUpperCase(), presetId);
  return NextResponse.json({ ok: true, answer });
}

async function synthesizeFromProfile(
  og: ReturnType<typeof getOmnigraphClient>,
  ticker: string,
  presetId: number,
): Promise<JudgeAnswer | null> {
  const preset = JUDGE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;

  try {
    const [profileRes, verdictRes, analystsRes, evidenceRes, findingsRes] = await Promise.allSettled([
      og.read<OmnigraphReadResult>("company_full_profile", { ticker }),
      og.read<OmnigraphReadResult>("company_verdict", { ticker }),
      og.read<OmnigraphReadResult>("company_analysts", { ticker }),
      og.read<OmnigraphReadResult>("company_evidence", { ticker }),
      og.read<OmnigraphReadResult>("company_findings", { ticker }),
    ]);

    const profile = profileRes.status === "fulfilled" ? profileRes.value.rows : [];
    const verdict = verdictRes.status === "fulfilled" ? verdictRes.value.rows[0] : null;
    const analysts = analystsRes.status === "fulfilled" ? analystsRes.value.rows : [];
    const evidence = evidenceRes.status === "fulfilled" ? evidenceRes.value.rows : [];
    const findings = findingsRes.status === "fulfilled" ? findingsRes.value.rows : [];

    if (profile.length === 0 && !verdict && analysts.length === 0) {
      return null;
    }

    const answerText = buildAnswer(preset.id, preset.label, {
      profile: profile[0] ?? {},
      verdict,
      analysts,
      evidence,
      findings,
    });

    const evidenceIds = evidence.slice(0, 3).map((e) => String(e.evidence_id ?? ""));

    const answer: JudgeAnswer = {
      presetId,
      answer: answerText,
      evidenceIds,
      dissent: verdict?.dissent ? String(verdict.dissent) : undefined,
    };

    persistToOmnigraph(og, ticker, presetId, answer).catch(() => {});

    return answer;
  } catch {
    return null;
  }
}

function buildAnswer(
  presetId: number,
  _question: string,
  ctx: {
    profile: Record<string, unknown>;
    verdict: Record<string, unknown> | null;
    analysts: Record<string, unknown>[];
    evidence: Record<string, unknown>[];
    findings: Record<string, unknown>[];
  },
): string {
  const co = ctx.profile;
  const name = co.name ?? co.ticker ?? "Company";
  const sector = co.sector ?? "N/A";
  const v = ctx.verdict;
  const confidence = v ? Number(v.confidence ?? 0) : 0;
  const verdictLabel = v?.verdict ?? "neutral";
  const rationale = v?.allocation_rationale ?? "";
  const dissent = v?.dissent ?? "";

  const qualityAnalyst = ctx.analysts.find((a) => a.role === "quality");
  const growthAnalyst = ctx.analysts.find((a) => a.role === "growth");
  const riskAnalyst = ctx.analysts.find((a) => a.role === "risk");

  const topEvidence = ctx.evidence.slice(0, 3).map((e) => `- ${e.title ?? e.excerpt ?? "Evidence"}`).join("\n");
  const topFindings = ctx.findings.slice(0, 3).map((f) => `- [${f.finding_type}] ${f.summary}`).join("\n");

  switch (presetId) {
    case 1:
      return `**${name}** (${sector}) — ${rationale || `Conviction: ${verdictLabel} at ${(confidence * 100).toFixed(0)}% confidence.`}${growthAnalyst ? ` Growth score: ${Number(growthAnalyst.score).toFixed(1)}/10.` : ""}`;

    case 2: {
      const riskSummary = riskAnalyst?.summary ?? "No risk analysis available.";
      return `Falsification triggers for **${name}**:\n\n${riskSummary}${topFindings ? `\n\nKey findings:\n${topFindings}` : ""}`;
    }

    case 3: {
      const qualSummary = qualityAnalyst?.summary ?? "No competitive analysis available.";
      return `Competitive landscape for **${name}**:\n\n${qualSummary}${topEvidence ? `\n\nSupporting evidence:\n${topEvidence}` : ""}`;
    }

    case 4: {
      const growthSummary = growthAnalyst?.summary ?? "No growth estimates available.";
      const riskSummary = riskAnalyst?.summary ?? "";
      return `Estimate risk for **${name}**:\n\n**Upside scenario:** ${growthSummary}\n\n**Downside scenario:** ${riskSummary || "Not assessed."}`;
    }

    case 5: {
      const riskSummary = riskAnalyst?.summary ?? "No regulatory/macro analysis available.";
      return `Regulatory & macro risk for **${name}** (${sector}):\n\n${riskSummary}`;
    }

    case 6: {
      const qualSummary = qualityAnalyst?.summary ?? "No capital allocation analysis available.";
      return `Capital allocation for **${name}**:\n\n${qualSummary}${qualityAnalyst ? `\n\nQuality score: ${Number(qualityAnalyst.score).toFixed(1)}/10` : ""}`;
    }

    case 7:
      return `Bear case for **${name}**:\n\n${dissent || "No dissenting view recorded."}${riskAnalyst ? `\n\nRisk analyst: ${riskAnalyst.summary}` : ""}`;

    case 8: {
      const growthSummary = growthAnalyst?.summary ?? "";
      return `Timing thesis for **${name}**:\n\n${rationale || "No timing rationale recorded."}${growthSummary ? `\n\nGrowth context: ${growthSummary}` : ""}`;
    }

    default:
      return `No synthesized answer available for preset ${presetId}.`;
  }
}

async function persistToOmnigraph(
  og: ReturnType<typeof getOmnigraphClient>,
  ticker: string,
  presetId: number,
  answer: JudgeAnswer,
): Promise<void> {
  const answerId = `${ticker}:judge:${presetId}`;
  await og.change("upsert_judge_answer", {
    answer_id: answerId,
    preset_id: presetId,
    answer: answer.answer,
    dissent: answer.dissent ?? "",
  });
  await og.change("link_judge_answer", {
    ticker,
    answer_id: answerId,
  });
}
