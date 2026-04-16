/**
 * Cala API: every authenticated request body must include `team_id`.
 * Set `CALA_TEAM_ID` in `.env` (never hardcode in source).
 */

export function getCalaTeamId(): string | undefined {
  const id = process.env.CALA_TEAM_ID?.trim();
  return id || undefined;
}

export function requireCalaTeamId(): string {
  const id = getCalaTeamId();
  if (!id) {
    throw new Error(
      "CALA_TEAM_ID is required for Cala API requests. Set it in .env (maps to JSON field team_id).",
    );
  }
  return id;
}

/** Merge Cala's required `team_id` into a request body (use from server code only). */
export function withCalaTeamId<T extends Record<string, unknown>>(
  body: T,
): T & { team_id: string } {
  return { ...body, team_id: requireCalaTeamId() };
}
