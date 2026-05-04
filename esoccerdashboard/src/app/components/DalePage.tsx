import { useMemo, useEffect, useRef } from "react";
import { Zap, Download } from "lucide-react";
import { FileUploadCard } from "./FileUploadCard";
import { PeriodFilterCard } from "./PeriodFilterCard";
import { AnalysisFilters } from "./AnalysisFilters";
import { FilterBar } from "./FilterBar";
import { ResultsTable, type ResultRow } from "./ResultsTable";
import { PlayerComparisonCard } from "./PlayerComparisonCard";
import { analyzeFiles, exportFilteredResults, normalizeResult } from "../services/api";
import { useSession } from "./SessionContext";
import { useState } from "react";
import type { ColumnDef } from "./ColumnConfigModal";

const STRATEGY_ID = "eSoccer — Dupla";
const STRATEGY_FLAG = "Dale";

const daleColumns = [
  { key: "dupla", label: "Dupla" },
  { key: "ligas", label: "Liga" },
  { key: "partidas", label: "Partidas" },
  { key: "greens", label: "Greens" },
  { key: "porcentagem", label: "% Dale" },
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

export function DalePage() {
  const { addAnalysis, dale, setDale } = useSession();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { files, results: allResults, cacheKey, hasAnalyzed, selectedFiles, minMatches, minPercentage, dateFrom, dateTo } = dale;

  const set = <K extends keyof typeof dale>(key: K, value: typeof dale[K]) =>
    setDale((prev) => ({ ...prev, [key]: value }));

  const columnConfig = dale.columnConfig.length > 0 ? dale.columnConfig : buildDefaultColumnConfig(daleColumns);
  const visibleColumns = getVisibleColumns(columnConfig, daleColumns);

  const allFileNames = useMemo(() => files.map((f) => f.name), [files]);

  const filteredFiles = useMemo(() => {
    if (selectedFiles.length === 0) return files;
    return files.filter((f) => selectedFiles.includes(f.name));
  }, [files, selectedFiles]);

  const filteredResults = useMemo(() => {
    let rows = allResults;
    rows = rows.filter((r) => r.partidas >= minMatches && r.porcentagem >= minPercentage);
    const q1 = dale.playerSearch.trim().toLowerCase();
    const q2 = dale.playerSearch2.trim().toLowerCase();
    if (q1 && q2) {
      rows = rows.filter((r) => {
        const d = r.dupla.toLowerCase();
        return d.includes(q1) && d.includes(q2);
      });
    } else if (q1) {
      rows = rows.filter((r) => r.dupla.toLowerCase().includes(q1));
    } else if (q2) {
      rows = rows.filter((r) => r.dupla.toLowerCase().includes(q2));
    }
    if (dale.selectedTournaments.length > 0)
      rows = rows.filter((r) => {
        const leagues = r.ligas.split(" / ").map((l) => l.trim());
        return dale.selectedTournaments.some((t) => leagues.includes(t));
      });
    return rows;
  }, [allResults, minMatches, minPercentage, dale.playerSearch, dale.playerSearch2, dale.selectedTournaments]);

  // Ref always pointing to latest dale state (avoids stale closures in setTimeout)
  const daleRef = useRef(dale);
  daleRef.current = dale;

  const hasAnalyzedRef = useRef(false);
  useEffect(() => { hasAnalyzedRef.current = hasAnalyzed; }, [hasAnalyzed]);

  const prevFiles = useRef(selectedFiles);
  const prevDateFrom = useRef(dateFrom);
  const prevDateTo = useRef(dateTo);

  useEffect(() => {
    const filesChanged = prevFiles.current !== selectedFiles;
    const dateChanged = prevDateFrom.current !== dateFrom || prevDateTo.current !== dateTo;
    prevFiles.current = selectedFiles;
    prevDateFrom.current = dateFrom;
    prevDateTo.current = dateTo;

    if (!hasAnalyzedRef.current || files.length === 0) return;
    if (!filesChanged && !dateChanged) return;
    if ((dateFrom && !dateTo) || (!dateFrom && dateTo)) return;

    const timer = setTimeout(() => { handleAnalyze(); }, 300);
    return () => clearTimeout(timer);
  }, [selectedFiles, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnalyze = async () => {
    const current = daleRef.current;
    const sel = current.selectedFiles;
    const allFiles = current.files;
    const toSend = sel.length > 0
      ? allFiles.filter((f) => sel.includes(f.name))
      : allFiles;
    if (toSend.length === 0) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      const data = await analyzeFiles(toSend, STRATEGY_ID, current.dateFrom || undefined, current.dateTo || undefined);
      const rows: ResultRow[] = (data.results ?? []).map(normalizeResult);
      const now = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
      addAnalysis({ name: files.map((f) => f.name).join(", "), type: "Dale", date: now, duplas: rows.length });
      setDale((prev) => ({
        ...prev,
        results: rows,
        cacheKey: data.cache_key,
        totalJogosBrutos: data.total_jogos_brutos,
        totalJogosAposDedup: data.total_jogos_apos_dedup,
        hasAnalyzed: true,
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
          <Zap className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-foreground">Analise Dale</h1>
          <p className="text-muted-foreground" style={{ fontSize: "0.9rem" }}>
            Upload da planilha e configuracao dos filtros de analise
          </p>
        </div>
      </div>

      {/* File Upload */}
      <FileUploadCard files={files} onFilesChange={(f) => set("files", f)} />

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
              onClick={() => exportFilteredResults(filteredResults, visibleColumns, "resultados_dale")}
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
          playerSearch={dale.playerSearch}
          onPlayerSearchChange={(v) => set("playerSearch", v)}
          playerSearch2={dale.playerSearch2}
          onPlayerSearch2Change={(v) => set("playerSearch2", v)}
          allFileNames={allFileNames}
          selectedFiles={dale.selectedFiles}
          onSelectedFilesChange={(v) => set("selectedFiles", v)}
          selectedTournaments={dale.selectedTournaments}
          onSelectedTournamentsChange={(v) => set("selectedTournaments", v)}
          minMatches={dale.minMatches}
          onMinMatchesChange={(v) => set("minMatches", v)}
          minPercentage={dale.minPercentage}
          onMinPercentageChange={(v) => set("minPercentage", v)}
        />
      )}

      {/* Player Comparison Card */}
      <PlayerComparisonCard results={filteredResults} playerSearch={dale.playerSearch} />

      {/* Results */}
      {hasAnalyzed ? (
        <ResultsTable
          data={filteredResults}
          columns={visibleColumns}
          allColumns={daleColumns}
          columnConfig={columnConfig}
          onColumnConfigChange={(cfg) => set("columnConfig", cfg)}
          cacheKey={cacheKey}
          strategy={STRATEGY_FLAG}
          emptyMessage="Nenhuma dupla encontrada com os filtros selecionados. Tente ajustar os parametros."
        />
      ) : (
        <div className="rounded-xl border border-border bg-card p-16 text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Zap className="w-8 h-8 text-primary/50" />
          </div>
          <p className="text-muted-foreground">
            Faca o upload de um arquivo e clique em <strong className="text-foreground">Analisar</strong> para ver os resultados
          </p>
        </div>
      )}
    </div>
  );
}
