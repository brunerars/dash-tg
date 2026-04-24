import * as XLSX from "xlsx";
import type { ResultRow } from "../components/ResultsTable";

const BET_PATTERNS: [string, string][] = [
  ["BETANO", "Betano"],
  ["365", "365"],
  ["SUPER", "Super"],
];
export function detectBet(filename: string): string {
  const upper = filename.toUpperCase();
  for (const [pattern, label] of BET_PATTERNS) {
    if (upper.includes(pattern)) return label;
  }
  return filename.replace(/\.[^.]+$/, "");
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: "include",
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event("auth:unauthorized"));
  }
  return res;
}

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail ?? "Credenciais invalidas");
  }
}

export async function logout(): Promise<void> {
  await fetch(`${BASE_URL}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export interface Strategy {
  id: string;
  descricao: string;
  min_jogos: number;
  min_green_pct: number;
}

export interface AnalyzeResult {
  cache_key: string;
  cache_hit: boolean;
  strategy: string;
  total_jogos_brutos: number;
  total_jogos_apos_dedup: number;
  results: Record<string, unknown>[];
  horarios_unicos?: string[];
}

export async function fetchMe(): Promise<{ username: string }> {
  const res = await apiFetch("/auth/me");
  if (!res.ok) throw new Error(`Erro ao verificar sessão: ${res.status}`);
  return res.json();
}

export async function fetchStrategies(): Promise<Strategy[]> {
  const res = await apiFetch("/strategies");
  if (!res.ok) throw new Error(`Erro ao buscar estratégias: ${res.status}`);
  const data = await res.json();
  return data.strategies ?? data;
}

export async function analyzeFiles(
  files: File[],
  strategy: string,
  dateFrom?: string,
  dateTo?: string,
  horarios?: string[]
): Promise<AnalyzeResult> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  form.append("strategy", strategy);
  if (dateFrom) form.append("date_from", dateFrom);
  if (dateTo) form.append("date_to", dateTo);
  if (horarios && horarios.length > 0) form.append("horarios", horarios.join(","));

  const res = await apiFetch("/analyze", {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail ?? `Erro na análise: ${res.status}`);
  }

  const data = await res.json();

  // A API pode retornar o array de resultados com diferentes nomes de campo.
  // Tenta encontrar o array automaticamente.
  const candidates = [
    data.results,
    data.duplas,
    data.data,
    data.resultados,
    data.pairs,
    Array.isArray(data) ? data : null,
  ];

  const populatedCandidate = candidates.find((c) => Array.isArray(c) && c.length > 0);
  const anyCandidate = candidates.find((c) => Array.isArray(c));
  const fallback = Object.values(data).find((v) => Array.isArray(v) && (v as unknown[]).length > 0) as Record<string, unknown>[] | undefined;

  const resultsArray = populatedCandidate ?? fallback ?? anyCandidate ?? [];

  return {
    cache_key: data.cache_key ?? "",
    cache_hit: data.cache_hit ?? false,
    strategy: data.strategy ?? "",
    total_jogos_brutos: data.total_jogos_brutos ?? 0,
    total_jogos_apos_dedup: data.total_jogos_apos_dedup ?? 0,
    results: resultsArray,
    horarios_unicos: data.horarios_unicos ?? undefined,
  };
}

export function exportFilteredResults(
  rows: ResultRow[],
  columns: { key: string; label: string }[],
  filename = "resultados_filtrados"
): void {
  const data = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const col of columns) {
      const v = row[col.key as keyof ResultRow];
      obj[col.label] = typeof v === "number" && !Number.isInteger(v) ? parseFloat(v.toFixed(2)) : v;
    }
    return obj;
  });

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Resultados");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export async function exportResults(cacheKey: string): Promise<void> {
  const res = await apiFetch(`/export/${cacheKey}`);
  if (!res.ok) throw new Error(`Erro ao exportar: ${res.status}`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `resultados_${cacheKey}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function fetchCachedResult(cacheKey: string): Promise<AnalyzeResult> {
  const res = await apiFetch(`/results/${cacheKey}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail ?? `Erro ao buscar resultado: ${res.status}`);
  }
  const data = await res.json();
  const candidates = [data.results, data.duplas, data.data, data.resultados, data.pairs, Array.isArray(data) ? data : null];
  const resultsArray = candidates.find((c) => Array.isArray(c) && c.length > 0)
    ?? (Object.values(data).find((v) => Array.isArray(v) && (v as unknown[]).length > 0) as Record<string, unknown>[] | undefined)
    ?? candidates.find((c) => Array.isArray(c))
    ?? [];
  return {
    cache_key: data.cache_key ?? cacheKey,
    cache_hit: true,
    strategy: data.strategy ?? "",
    total_jogos_brutos: data.total_jogos_brutos ?? 0,
    total_jogos_apos_dedup: data.total_jogos_apos_dedup ?? 0,
    results: resultsArray,
    horarios_unicos: data.horarios_unicos ?? undefined,
  };
}

export async function fetchBlueprint(
  cacheKey: string,
  dupla: string,
  linha?: string
): Promise<{ dupla: string; linha: string | null; total_jogos: number; jogos: Record<string, unknown>[] }> {
  const params = new URLSearchParams({ dupla });
  if (linha) params.set("linha", linha);
  const res = await apiFetch(`/blueprint/${cacheKey}?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail ?? `Erro ao buscar blueprint: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Pre-computation
// ---------------------------------------------------------------------------

export interface ComboInfo {
  job_id: string;
  filenames: string[];
}

export interface PeriodComboInfo {
  job_id: string;
  filenames: string[];
  period_days: number;
}

export interface PrecomputeResult {
  job_ids: string[];
  primary_job_id: string;
  total_jobs: number;
  strategy: string;
  combos: ComboInfo[];
  period_combos: PeriodComboInfo[];
}

export interface JobStatus {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed" | "expired";
  cache_key?: string;
  error?: string;
}

export interface BulkJobStatus {
  jobs: JobStatus[];
  total: number;
  completed: number;
  failed: number;
  all_done: boolean;
}

export async function precompute(files: File[], strategy: string): Promise<PrecomputeResult> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  form.append("strategy", strategy);
  const res = await apiFetch("/precompute", { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail ?? `Erro no precompute: ${res.status}`);
  }
  return res.json();
}

export async function fetchJobsStatus(jobIds: string[]): Promise<BulkJobStatus> {
  const res = await apiFetch(`/jobs/status?ids=${jobIds.join(",")}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail ?? `Erro ao buscar status: ${res.status}`);
  }
  return res.json();
}

/**
 * Extrai valores únicos da coluna "Horário Jogo" dos arquivos Excel em um Web Worker
 * para não bloquear a UI.
 */
export async function extractHorariosFromFiles(files: File[]): Promise<string[]> {
  const buffers = await Promise.all(files.map((f) => f.arrayBuffer()));
  return new Promise((resolve) => {
    const worker = new Worker(
      new URL("./horarioWorker.ts", import.meta.url),
      { type: "module" }
    );
    worker.onmessage = (e: MessageEvent<string[]>) => {
      resolve(e.data);
      worker.terminate();
    };
    worker.onerror = () => {
      resolve([]);
      worker.terminate();
    };
    worker.postMessage(buffers, buffers as unknown as Transferable[]);
  });
}

// Remove o formato de tupla Python: "('Nome vs Outro',)" → "Nome vs Outro"
function cleanDupla(raw: unknown): string {
  return String(raw ?? "")
    .replace(/^\('|',\)$/g, "")
    .trim();
}

// Normaliza um item da resposta da API para o formato de ResultRow.
export function normalizeResult(item: Record<string, unknown>, index: number) {
  return {
    id: index + 1,
    dupla: cleanDupla(item.dupla ?? item.pair ?? item.jogadores ?? item.players ?? item.confronto ?? item.nome ?? ""),
    ligas: (item.ligas ?? item.liga ?? item.league ?? "") as string,
    linha: (item.linha ?? item.line ?? item.mercado ?? "") as string,
    partidas: (item.quantidade_entradas ?? item.jogos ?? item.partidas ?? item.total_jogos ?? item.games ?? item.matches ?? item.total ?? 0) as number,
    greens: (item.quantidade_greens ?? item.greens ?? 0) as number,
    porcentagem: (item.percentual_green ?? item.green_pct ?? item.porcentagem ?? item.pct ?? item.taxa ?? item.rate ?? item.percentual ?? 0) as number,
    pontuacao: (item.pontuacao ?? item.score ?? item.points ?? 0) as number,
    ultimos_6: (item.ultimos_6 ?? item.last_6 ?? "") as string,
    pct_green_10: (item.pct_green_10 ?? item.last_10_pct ?? 0) as number,
    reds: (item.quantidade_reds ?? item.reds ?? 0) as number,
    max_reds: (item.max_reds ?? 0) as number,
    reds_apos_red: (item.reds_apos_red ?? 0) as number,
    sistema_red_pct: (item.sistema_red_pct ?? 0) as number,
    srpt: (item.srpt ?? 0) as number,
    sequencia_atual_g: (item.sequencia_atual_g ?? 0) as number,
    max_greens: (item.max_greens ?? 0) as number,
    lucro_prej_total: (item.lucro_prej_total ?? 0) as number,
    fontes: (item.fontes ?? []) as string[],
  };
}
