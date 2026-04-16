import { describe, expect, it } from "vitest";
import {
  extractLeaderboardRowsFromJson,
  leaderboardRowReturnPct,
  leaderboardRowTeamId,
  summarizeLeaderboardForTeam,
} from "./leaderboard-fetch";

describe("leaderboardRowReturnPct", () => {
  it("uses return_pct when present", () => {
    expect(leaderboardRowReturnPct({ return_pct: 12.5 })).toBe(12.5);
  });

  it("derives from total_value and default 1M invested when no invested field", () => {
    // (1_100_000 - 1_000_000) / 1_000_000 * 100 = 10
    expect(leaderboardRowReturnPct({ total_value: 1_100_000 })).toBeCloseTo(10, 5);
  });

  it("derives from total_value and total_invested when present", () => {
    // (120 - 100) / 100 * 100 = 20
    expect(leaderboardRowReturnPct({ total_value: 120, total_invested: 100 })).toBeCloseTo(20, 5);
  });

  it("accepts camelCase totalInvested", () => {
    expect(leaderboardRowReturnPct({ total_value: 150, totalInvested: 100 })).toBeCloseTo(50, 5);
  });

  it("returns null when total_value missing and no return_pct", () => {
    expect(leaderboardRowReturnPct({ team_id: "x" })).toBeNull();
  });

  it("returns null when invested baseline is zero", () => {
    expect(leaderboardRowReturnPct({ total_value: 100, total_invested: 0 })).toBeNull();
  });
});

describe("leaderboardRowTeamId", () => {
  it("prefers team_id string", () => {
    expect(leaderboardRowTeamId({ team_id: "alpha", team: "beta" })).toBe("alpha");
  });

  it("coerces numeric team_id for CALA_TEAM_ID comparison", () => {
    expect(leaderboardRowTeamId({ team_id: 42 })).toBe("42");
  });

  it("falls back to team", () => {
    expect(leaderboardRowTeamId({ team: "gamma" })).toBe("gamma");
  });

  it("empty when missing", () => {
    expect(leaderboardRowTeamId({})).toBe("");
  });
});

describe("extractLeaderboardRowsFromJson", () => {
  it("unwraps { value: [...] }", () => {
    const rows = extractLeaderboardRowsFromJson({ value: [{ team_id: "a", return_pct: 1 }] });
    expect(rows).toHaveLength(1);
    expect(rows![0]!.team_id).toBe("a");
  });

  it("unwraps { page: [...] }", () => {
    const rows = extractLeaderboardRowsFromJson({ page: [{ team_id: "b", total_value: 1 }] });
    expect(rows).toHaveLength(1);
  });

  it("unwraps { rows: [...] }", () => {
    const rows = extractLeaderboardRowsFromJson({ ok: true, rows: [{ team_id: "c", return_pct: 0 }] });
    expect(rows).toHaveLength(1);
  });

  it("returns raw leaderboard array", () => {
    const rows = extractLeaderboardRowsFromJson([{ team_id: "d", return_pct: 2 }]);
    expect(rows).toHaveLength(1);
  });

  it("returns null for empty / unknown shapes", () => {
    expect(extractLeaderboardRowsFromJson(null)).toBeNull();
    expect(extractLeaderboardRowsFromJson({})).toBeNull();
    expect(extractLeaderboardRowsFromJson([{ not_a_row: true }])).toBeNull();
  });
});

describe("summarizeLeaderboardForTeam", () => {
  const rows = [
    { team_id: "alpha", return_pct: 100 },
    { team_id: "sourish", return_pct: 50 },
    { team_id: "us", return_pct: 10 },
  ];

  it("ranks by return and computes gaps vs #1 and default benchmark", () => {
    const s = summarizeLeaderboardForTeam(rows, "us");
    expect(s.ourRank).toBe(3);
    expect(s.ourReturnPct).toBe(10);
    expect(s.topReturnPct).toBe(100);
    expect(s.gapToFirstPp).toBeCloseTo(90, 5);
    expect(s.benchmarkReturnPct).toBe(50);
    expect(s.gapToBenchmarkPp).toBeCloseTo(40, 5);
    expect(s.enriched).toHaveLength(3);
  });

  it("respects CALA-style benchmark override", () => {
    const s = summarizeLeaderboardForTeam(rows, "us", { benchmarkTeamId: "alpha" });
    expect(s.benchmarkReturnPct).toBe(100);
    expect(s.gapToBenchmarkPp).toBeCloseTo(90, 5);
  });

  it("handles missing team id", () => {
    const s = summarizeLeaderboardForTeam(rows, null);
    expect(s.ourRank).toBeNull();
    expect(s.ourReturnPct).toBeNull();
    expect(s.gapToFirstPp).toBeNull();
  });
});
