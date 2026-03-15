import { useMemo } from "react";
import { Filter } from "lucide-react";
import type { ResultRow } from "./ResultsTable";

interface BetFilterProps {
  results: ResultRow[];
  selectedBet: string;
  onSelectedBetChange: (bet: string) => void;
}

export function BetFilterDropdown({
  results,
  selectedBet,
  onSelectedBetChange,
}: BetFilterProps) {
  const allBets = useMemo(() => {
    const set = new Set<string>();
    for (const r of results) {
      if (r.fontes) {
        for (const f of r.fontes) set.add(f);
      }
    }
    return Array.from(set).sort();
  }, [results]);

  if (allBets.length < 2) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Filter className="w-4 h-4 text-primary" />
      </div>
      <label
        className="text-muted-foreground whitespace-nowrap"
        style={{ fontSize: "0.85rem" }}
      >
        Filtrar por Bet
      </label>
      <select
        value={selectedBet}
        onChange={(e) => onSelectedBetChange(e.target.value)}
        className="flex-1 px-3 py-2 rounded-lg bg-input-background border border-border text-foreground focus:border-primary focus:ring-1 focus:ring-primary transition-colors cursor-pointer"
        style={{ fontSize: "0.9rem" }}
      >
        <option value="all">Todas</option>
        {allBets.map((bet) => (
          <option key={bet} value={bet}>{bet}</option>
        ))}
      </select>
    </div>
  );
}
