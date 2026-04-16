import { GraphDashboard } from "@/components/graph/graph-dashboard";

export const dynamic = "force-dynamic";

export default function GraphPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge Graph</h1>
        <p className="text-sm text-text-secondary">
          Team Nuke submissions — every model, run, and return tracked by Omnigraph.
        </p>
      </div>
      <GraphDashboard />
    </div>
  );
}
