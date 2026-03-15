import { useMemo, useState, useCallback } from "react";
import { TrendingUp, Download } from "lucide-react";
import { FileUploadCard } from "./FileUploadCard";
import { PeriodFilterCard } from "./PeriodFilterCard";
import { AnalysisFilters } from "./AnalysisFilters";
import { FilterBar } from "./FilterBar";
import { ResultsTable, type ResultRow } from "./ResultsTable";
import { PlayerComparisonCard } from "./PlayerComparisonCard";
import { analyzeFiles, exportFilteredResults, normalizeResult, extractHorariosFromFiles } from "../services/api";
import { useSession } from "./SessionContext";
import type { ColumnDef } from "./ColumnConfigModal";

const STRATEGY_ID = "Over/HT — Dupla + Linha";

const overUnderColumns = [
  { key: "dupla", label: "Dupla" },
  { key: "ligas", label: "Liga" },
  { key: "linha", label: "Linha" },
  { key: "partidas", label: "Partidas" },
  { key: "greens", label: "Greens" },
  { key: "porcentagem", label: "% Over" },
  { key: "pontuacao", label: "Pts" },
  { key: "ultimos_6", label: "Últimos 6" },
  { key: "pct_green_10", label: "% Últ.10" },
  { key: "reds", label: "Reds" },
  { key: "max_reds", label: "Max Reds" },
  { key: "reds_apos_red", label: "R.após Red" },
  { key: "sistema_red_pct", label: "Sis.Red %" },
  { key: "srpt", label: "SRPT" },
  { key: "sequencia_atual_g", label: "Seq.G" },
  { key: "max_greens", label: "Max Greens" },
  { key: "lucro_prej_total", label: "Lucro/Prej" },
];

function buildDefaultColumnConfig(cols: { key: string; label: string }[]): ColumnDef[] {
  return cols.map((c) => ({ key: c.key, label: c.label, visible: true }));
}

function getVisibleColumns(config: ColumnDef[], defaultCols: { key: string; label: string }[]): { key: string; label: string }[] {
  if (config.length === 0) return defaultCols;
  return config.filter((c) => c.visible).map((c) => ({ key: c.key, label: c.label }));
}

export function OverUnderPage() {
  const { addAnalysis, overUnder, setOverUnder } = useSession();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { files, results: allResults, cacheKey, hasAnalyzed, selectedBet, minMatches, minPercentage, dateFrom, dateTo } = overUnder;

  const set = <K extends keyof typeof overUnder>(key: K, value: typeof overUnder[K]) =>
    setOverUnder((prev) => ({ ...prev, [key]: value }));

  const columnConfig = overUnder.columnConfig.length > 0 ? overUnder.columnConfig : buildDefaultColumnConfig(overUnderColumns);
  const visibleColumns = getVisibleColumns(columnConfig, overUnderColumns);

  const handleFilesChange = useCallback((newFiles: File[]) => {
    setOverUnder((prev) => ({ ...prev, files: newFiles, availableHorarios: [], selectedHorarios: [] }));
    if (newFiles.length > 0) {
      extractHorariosFromFiles(newFiles).then((horarios) => {
        setOverUnder((prev) => ({ ...prev, availableHorarios: horarios }));
      });
    }
  }, [setOverUnder]);

  const filteredResults = useMemo(() => {
    let rows = allResults;
    if (selectedBet !== "all")
      rows = rows.filter((r) => r.fontes.includes(selectedBet));
    rows = rows.filter((r) => r.partidas >= minMatches && r.porcentagem >= minPercentage);
    if (overUnder.playerSearch.trim()) {
      const q = overUnder.playerSearch.trim().toLowerCase();
      rows = rows.filter((r) => r.dupla.toLowerCase().includes(q));
    }
    if (overUnder.selectedTournaments.length > 0)
      rows = rows.filter((r) => {
        const leagues = r.ligas.split(" / ").map((l) => l.trim());
        return overUnder.selectedTournaments.some((t) => leagues.includes(t));
      });
    if (overUnder.selectedLinhas.length > 0)
      rows = rows.filter((r) => overUnder.selectedLinhas.includes(r.linha));
    return rows;
  }, [allResults, selectedBet, minMatches, minPercentage, overUnder.playerSearch, overUnder.selectedTournaments, overUnder.selectedLinhas]);

  const handleAnalyze = async () => {
    if (files.length === 0) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      const data = await analyzeFiles(
        files, STRATEGY_ID,
        dateFrom || undefined, dateTo || undefined,
        overUnder.selectedHorarios.length > 0 ? overUnder.selectedHorarios : undefined
      );
      const rows: ResultRow[] = (data.results ?? []).map(normalizeResult);
      const now = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
      addAnalysis({ name: files.map((f) => f.name).join(", "), type: "Over/Under", date: now, duplas: rows.length });
      setOverUnder((prev) => ({
        ...prev,
        results: rows,
        cacheKey: data.cache_key,
        totalJogosBrutos: data.total_jogos_brutos,
        totalJogosAposDedup: data.total_jogos_apos_dedup,
        hasAnalyzed: true,
        // If backend returns horarios_unicos, use those (more accurate); otherwise keep frontend-extracted
        availableHorarios: data.horarios_unicos ?? prev.availableHorarios,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <TrendingUp className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-foreground">Analise Over/Under</h1>
          <p className="text-muted-foreground" style={{ fontSize: "0.9rem" }}>
            Upload da planilha e configuracao dos filtros de analise
          </p>
        </div>
      </div>

      {/* File Upload */}
      <FileUploadCard files={files} onFilesChange={handleFilesChange} />

      {/* Period Filter */}
      <PeriodFilterCard
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={(v) => set("dateFrom", v)}
        onDateToChange={(v) => set("dateTo", v)}
      />

      {/* Analyze + Export buttons */}
      <AnalysisFilters
        onAnalyze={handleAnalyze}
        isAnalyzing={isAnalyzing}
        hasFile={files.length > 0}
        extraAction={
          hasAnalyzed && filteredResults.length > 0 ? (
            <button
              onClick={() => exportFilteredResults(filteredResults, visibleColumns, "resultados_over_under")}
              className="btn-layrinth flex items-center gap-2"
              style={{ borderRadius: 10 }}
            >
              <Download className="w-4 h-4" />
              Exportar .xlsx
            </button>
          ) : null
        }
      />

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Post-analysis compact filter bar */}
      {hasAnalyzed && allResults.length > 0 && (
        <FilterBar
          results={allResults}
          playerSearch={overUnder.playerSearch}
          onPlayerSearchChange={(v) => set("playerSearch", v)}
          selectedBet={overUnder.selectedBet}
          onSelectedBetChange={(v) => set("selectedBet", v)}
          selectedTournaments={overUnder.selectedTournaments}
          onSelectedTournamentsChange={(v) => set("selectedTournaments", v)}
          minMatches={overUnder.minMatches}
          onMinMatchesChange={(v) => set("minMatches", v)}
          minPercentage={overUnder.minPercentage}
          onMinPercentageChange={(v) => set("minPercentage", v)}
          selectedLinhas={overUnder.selectedLinhas}
          onSelectedLinhasChange={(v) => set("selectedLinhas", v)}
          availableHorarios={overUnder.availableHorarios}
          selectedHorarios={overUnder.selectedHorarios}
          onSelectedHorariosChange={(v) => set("selectedHorarios", v)}
        />
      )}

      {/* Player Comparison Card */}
      <PlayerComparisonCard results={filteredResults} playerSearch={overUnder.playerSearch} />

      {/* Results */}
      {hasAnalyzed ? (
        <ResultsTable
          data={filteredResults}
          columns={visibleColumns}
          allColumns={overUnderColumns}
          columnConfig={columnConfig}
          onColumnConfigChange={(cfg) => set("columnConfig", cfg)}
          cacheKey={cacheKey}
          emptyMessage="Nenhuma dupla encontrada com os filtros selecionados. Tente ajustar os parametros."
        />
      ) : (
        <div className="rounded-xl border border-border bg-card p-16 text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <TrendingUp className="w-8 h-8 text-primary/50" />
          </div>
          <p className="text-muted-foreground">
            Faca o upload de um arquivo e clique em <strong className="text-foreground">Analisar</strong> para ver os resultados
          </p>
        </div>
      )}
    </div>
  );
}
