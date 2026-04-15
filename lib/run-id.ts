/** Default DecisionStore run id (JSON under data/runs/). */
export function getDefaultRunId() {
  return process.env.NEXT_PUBLIC_LOBSTER_DEFAULT_RUN_ID ?? process.env.LOBSTER_DEFAULT_RUN_ID ?? "demo-v1";
}
