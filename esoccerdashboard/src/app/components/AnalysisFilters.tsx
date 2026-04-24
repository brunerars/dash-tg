import { Search, RefreshCw } from "lucide-react";

interface AnalysisFiltersProps {
  onAnalyze: () => void;
  isAnalyzing: boolean;
  hasFile: boolean;
  extraAction?: React.ReactNode;
  needsRecompute?: boolean;
}

export function AnalysisFilters({
  onAnalyze,
  isAnalyzing,
  hasFile,
  extraAction,
  needsRecompute,
}: AnalysisFiltersProps) {
  return (
    <div className={`rounded-xl border bg-card p-4 transition-colors ${needsRecompute ? "border-primary/50" : "border-border"}`}>
      <div className="flex items-center gap-2 justify-end">
        {needsRecompute && (
          <span className="text-primary mr-auto" style={{ fontSize: "0.8rem" }}>
            Filtros alterados — clique em Analisar para recalcular
          </span>
        )}
        {extraAction}
        <button
          onClick={onAnalyze}
          disabled={!hasFile || isAnalyzing}
          className={`btn-layrinth flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${needsRecompute ? "animate-pulse" : ""}`}
          style={{ borderRadius: 10, padding: "9px 20px" }}
        >
          {isAnalyzing ? (
            <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
          ) : needsRecompute ? (
            <RefreshCw className="w-4 h-4" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          <span>{isAnalyzing ? "Analisando..." : needsRecompute ? "Recalcular" : "Analisar"}</span>
        </button>
      </div>
    </div>
  );
}
