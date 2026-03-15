import { Trophy } from "lucide-react";
import type { ResultRow } from "./ResultsTable";

function PctBar({ value }: { value: number }) {
  const color = value >= 70 ? "#4db854" : value >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden" style={{ minWidth: 60, maxWidth: 100 }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(value, 100)}%`, background: color }} />
      </div>
      <span className="tabular-nums" style={{ minWidth: "3.2rem", color }}>{value.toFixed(1)}%</span>
    </div>
  );
}

interface PlayerComparisonCardProps {
  results: ResultRow[];
  playerSearch: string;
}

export function PlayerComparisonCard({ results, playerSearch }: PlayerComparisonCardProps) {
  if (!playerSearch.trim() || results.length === 0) return null;

  const best = results.reduce((a, b) => (a.porcentagem > b.porcentagem ? a : b));

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Trophy className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-foreground font-medium" style={{ fontSize: "0.9rem" }}>
            {results.length} dupla{results.length !== 1 ? "s" : ""} encontrada{results.length !== 1 ? "s" : ""}
          </p>
          <p className="text-muted-foreground" style={{ fontSize: "0.8rem" }}>
            Resultados para &quot;{playerSearch.trim()}&quot;
          </p>
        </div>
      </div>

      <div className="rounded-lg bg-secondary/20 p-3 space-y-1">
        <p className="text-muted-foreground" style={{ fontSize: "0.8rem" }}>Melhor dupla</p>
        <p className="text-foreground font-medium" style={{ fontSize: "0.9rem" }}>{best.dupla}</p>
        <div className="flex items-center gap-4">
          <PctBar value={best.porcentagem} />
          <span className="text-muted-foreground tabular-nums" style={{ fontSize: "0.8rem" }}>
            {best.partidas} partidas
          </span>
        </div>
      </div>
    </div>
  );
}
