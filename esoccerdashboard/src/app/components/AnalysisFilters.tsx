import { Search } from "lucide-react";

interface AnalysisFiltersProps {
  onAnalyze: () => void;
  isAnalyzing: boolean;
  hasFile: boolean;
  extraAction?: React.ReactNode;
}

export function AnalysisFilters({
  onAnalyze,
  isAnalyzing,
  hasFile,
  extraAction,
}: AnalysisFiltersProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 justify-end">
        {extraAction}
        <button
          onClick={onAnalyze}
          disabled={!hasFile || isAnalyzing}
          className="btn-layrinth flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ borderRadius: 10, padding: "9px 20px" }}
        >
          {isAnalyzing ? (
            <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          <span>{isAnalyzing ? "Analisando..." : "Analisar"}</span>
        </button>
      </div>
    </div>
  );
}
