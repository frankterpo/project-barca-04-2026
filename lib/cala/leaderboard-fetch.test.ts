import { describe, expect, it } from "vitest";
import { extractLeaderboardRowsFromJson, leaderboardRowReturnPct } from "./leaderboard-fetch";

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
