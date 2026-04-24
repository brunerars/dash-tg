import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { TrendingUp, Download, Loader2 } from "lucide-react";
import { FileUploadCard } from "./FileUploadCard";
import { PeriodFilterCard } from "./PeriodFilterCard";
import { AnalysisFilters } from "./AnalysisFilters";
import { FilterBar } from "./FilterBar";
import { ResultsTable, type ResultRow } from "./ResultsTable";
import { PlayerComparisonCard } from "./PlayerComparisonCard";
import { PrecomputeProgress } from "./PrecomputeProgress";
import {
  analyzeFiles,
  fetchCachedResult,
  fetchJobsStatus,
  exportFilteredResults,
  normalizeResult,
  extractHorariosFromFiles,
  precompute,
  type JobStatus,
  type ComboInfo,
} from "../services/api";
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

  // Pre-computation state
  const [precomputeJobIds, setPrecomputeJobIds] = useState<string[]>([]);
  const [primaryJobId, setPrimaryJobId] = useState<string>("");
  const [isPrecomputing, setIsPrecomputing] = useState(false);
  const [isParsing, setIsParsing] = useState(false);

  // Combo map: filenames[] → cache_key for instant file switching
  const [comboMap, setComboMap] = useState<ComboInfo[]>([]);
  const [comboCacheKeys, setComboCacheKeys] = useState<Record<string, string>>({});
  const comboCacheKeysRef = useRef(comboCacheKeys);
  comboCacheKeysRef.current = comboCacheKeys;

  const { files, results: allResults, cacheKey, hasAnalyzed, selectedFiles, minMatches, minPercentage, dateFrom, dateTo } = overUnder;

  const set = <K extends keyof typeof overUnder>(key: K, value: typeof overUnder[K]) =>
    setOverUnder((prev) => ({ ...prev, [key]: value }));

  const columnConfig = overUnder.columnConfig.length > 0 ? overUnder.columnConfig : buildDefaultColumnConfig(overUnderColumns);
  const visibleColumns = getVisibleColumns(columnConfig, overUnderColumns);

  const allFileNames = useMemo(() => files.map((f) => f.name), [files]);

  const filteredFiles = useMemo(() => {
    if (selectedFiles.length === 0) return files;
    return files.filter((f) => selectedFiles.includes(f.name));
  }, [files, selectedFiles]);

  const handleFilesChange = useCallback((newFiles: File[]) => {
    setOverUnder((prev) => ({ ...prev, files: newFiles, availableHorarios: [], selectedHorarios: [] }));
    setPrecomputeJobIds([]);
    setPrimaryJobId("");
    setIsPrecomputing(false);

    if (newFiles.length > 0) {
      // Extract horarios in parallel with precompute dispatch
      extractHorariosFromFiles(newFiles).then((horarios) => {
        setOverUnder((prev) => ({ ...prev, availableHorarios: horarios }));
      });

      // Dispatch precompute — server pre-parses files first, then computes all combos
      setIsPrecomputing(true);
      setIsParsing(true);
      setComboMap([]);
      setComboCacheKeys({});
      precompute(newFiles, STRATEGY_ID)
        .then((result) => {
          setIsParsing(false);
          setPrecomputeJobIds([result.primary_job_id]);
          setPrimaryJobId(result.primary_job_id);
          setComboMap(result.combos);

          // Start background polling for ALL jobs to build combo→cache_key map
          _pollComboJobs(result.combos);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Erro ao iniciar pre-computacao");
          setIsPrecomputing(false);
          setIsParsing(false);
        });
    }
  }, [setOverUnder]);

  // Background polling: build combo→cache_key map as jobs complete
  const _pollComboJobs = useCallback((combos: ComboInfo[]) => {
    const allIds = combos.map((c) => c.job_id);
    const interval = setInterval(async () => {
      try {
        const status = await fetchJobsStatus(allIds);
        const newKeys: Record<string, string> = {};
        let allDone = true;
        for (const job of status.jobs) {
          if (job.status === "completed" && job.cache_key) {
            const combo = combos.find((c) => c.job_id === job.job_id);
            if (combo) {
              const key = [...combo.filenames].sort().join("||");
              newKeys[key] = job.cache_key;
            }
          } else if (job.status !== "failed" && job.status !== "expired") {
            allDone = false;
          }
        }
        setComboCacheKeys((prev) => ({ ...prev, ...newKeys }));
        if (allDone) clearInterval(interval);
      } catch {
        // Silently retry on next interval
      }
    }, 5000);
    // Cleanup after 10 min max
    setTimeout(() => clearInterval(interval), 600_000);
  }, []);

  // Load results from a cache_key (instant, no file re-upload)
  const _loadFromCache = useCallback(async (cacheKey: string) => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const data = await fetchCachedResult(cacheKey);
      const rows: ResultRow[] = (data.results ?? []).map(normalizeResult);
      const now = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
      addAnalysis({ name: "cache hit", type: "Over/Under", date: now, duplas: rows.length });
      setOverUnder((prev) => ({
        ...prev,
        results: rows,
        cacheKey: data.cache_key,
        totalJogosBrutos: data.total_jogos_brutos,
        totalJogosAposDedup: data.total_jogos_apos_dedup,
        hasAnalyzed: true,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar resultados");
    } finally {
      setIsAnalyzing(false);
    }
  }, [addAnalysis, setOverUnder]);

  // When the PRIMARY job completes, load results from cache (no re-upload)
  const handlePrimaryDone = useCallback(async (primaryJob: JobStatus) => {
    setIsPrecomputing(false);

    if (primaryJob.status === "failed") {
      setError(primaryJob.error ?? "Erro na pre-computacao");
      return;
    }

    if (!primaryJob.cache_key) {
      setError("Resultado nao encontrado.");
      return;
    }

    // Store in combo map for instant switching later
    const key = files.map((f) => f.name).sort().join("||");
    setComboCacheKeys((prev) => ({ ...prev, [key]: primaryJob.cache_key! }));

    // Load from cache — instant, no file re-upload
    await _loadFromCache(primaryJob.cache_key);
  }, [files, _loadFromCache]);

  const filteredResults = useMemo(() => {
    let rows = allResults;
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
  }, [allResults, minMatches, minPercentage, overUnder.playerSearch, overUnder.selectedTournaments, overUnder.selectedLinhas]);

  // Ref always pointing to latest state (avoids stale closures in setTimeout)
  const ouRef = useRef(overUnder);
  ouRef.current = overUnder;

  const hasAnalyzedRef = useRef(false);
  useEffect(() => { hasAnalyzedRef.current = hasAnalyzed; }, [hasAnalyzed]);

  const prevFiles = useRef(selectedFiles);
  const prevHorarios = useRef(overUnder.selectedHorarios);
  const prevDateFrom = useRef(dateFrom);
  const prevDateTo = useRef(dateTo);

  useEffect(() => {
    const filesChanged = prevFiles.current !== selectedFiles;
    const horariosChanged = prevHorarios.current !== overUnder.selectedHorarios;
    const dateChanged = prevDateFrom.current !== dateFrom || prevDateTo.current !== dateTo;
    prevFiles.current = selectedFiles;
    prevHorarios.current = overUnder.selectedHorarios;
    prevDateFrom.current = dateFrom;
    prevDateTo.current = dateTo;

    if (!hasAnalyzedRef.current || files.length === 0) return;
    if (!filesChanged && !horariosChanged && !dateChanged) return;
    if ((dateFrom && !dateTo) || (!dateFrom && dateTo)) return;

    // When file selection changes, try combo cache first (instant)
    if (filesChanged) {
      const sel = selectedFiles.length > 0 ? selectedFiles : files.map((f) => f.name);
      const comboKey = [...sel].sort().join("||");
      const cachedKey = comboCacheKeysRef.current[comboKey];
      if (cachedKey) {
        _loadFromCache(cachedKey);
        return;
      }
      // Not cached yet — fall through to handleAnalyze
    }

    // Fallback: re-analyze with file upload (for date/horario changes or uncached combos)
    const timer = setTimeout(() => {
      handleAnalyze();
    }, 300);
    return () => clearTimeout(timer);
  }, [selectedFiles, overUnder.selectedHorarios, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnalyze = async () => {
    const current = ouRef.current;
    const sel = current.selectedFiles;
    const allFiles = current.files;
    const toSend = sel.length > 0
      ? allFiles.filter((f) => sel.includes(f.name))
      : allFiles;
    if (toSend.length === 0) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      const data = await analyzeFiles(
        toSend, STRATEGY_ID,
        current.dateFrom || undefined, current.dateTo || undefined,
        current.selectedHorarios.length > 0 ? current.selectedHorarios : undefined
      );
      const rows: ResultRow[] = (data.results ?? []).map(normalizeResult);
      const now = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
      addAnalysis({ name: files.map((f) => f.name).join(", "), type: "Over/Under", date: now, duplas: rows.length });
      // Fallback: if Worker didn't extract horarios, parse from backend response
      let horariosFromBackend: string[] | undefined;
      if (data.horarios_unicos && data.horarios_unicos.length > 0) {
        const mins = new Set(data.horarios_unicos.map((h: string) => String(parseInt(h.split(":")[0], 10))));
        horariosFromBackend = [...mins].filter((m) => !isNaN(Number(m))).sort((a, b) => Number(a) - Number(b));
      }

      setOverUnder((prev) => ({
        ...prev,
        results: rows,
        cacheKey: data.cache_key,
        totalJogosBrutos: data.total_jogos_brutos,
        totalJogosAposDedup: data.total_jogos_apos_dedup,
        hasAnalyzed: true,
        // Worker values take priority; backend fallback if Worker didn't run
        availableHorarios: prev.availableHorarios.length > 0
          ? prev.availableHorarios
          : (horariosFromBackend ?? []),
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

      {/* Parsing indicator — shows while server pre-parses xlsx files */}
      {isParsing && (
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
          <span className="text-foreground" style={{ fontSize: "0.9rem" }}>
            Lendo planilhas... isso pode levar alguns minutos para arquivos grandes
          </span>
        </div>
      )}

      {/* Pre-compute progress — shows after files are parsed and jobs are dispatched */}
      {isPrecomputing && !isParsing && precomputeJobIds.length > 0 && (
        <PrecomputeProgress
          jobIds={precomputeJobIds}
          primaryJobId={primaryJobId}
          onPrimaryDone={handlePrimaryDone}
        />
      )}

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
          allFileNames={allFileNames}
          selectedFiles={overUnder.selectedFiles}
          onSelectedFilesChange={(v) => set("selectedFiles", v)}
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
          strategy="OverUnder"
          emptyMessage="Nenhuma dupla encontrada com os filtros selecionados. Tente ajustar os parametros."
        />
      ) : (
        !isPrecomputing && (
          <div className="rounded-xl border border-border bg-card p-16 text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
              <TrendingUp className="w-8 h-8 text-primary/50" />
            </div>
            <p className="text-muted-foreground">
              Faca o upload dos arquivos — as combinacoes serao processadas automaticamente
            </p>
          </div>
        )
      )}
    </div>
  );
}
