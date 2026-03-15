import { ArrowUpDown, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, FileText, Settings } from "lucide-react";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useTheme } from "./ThemeContext";
import { ColumnConfigModal, type ColumnDef } from "./ColumnConfigModal";

export interface ResultRow {
  id: number;
  dupla: string;
  ligas: string;
  linha: string;
  partidas: number;
  greens: number;
  porcentagem: number;
  pontuacao: number;
  ultimos_6: string;
  pct_green_10: number;
  reds: number;
  max_reds: number;
  reds_apos_red: number;
  sistema_red_pct: number;
  srpt: number;
  sequencia_atual_g: number;
  max_greens: number;
  lucro_prej_total: number;
  fontes: string[];
  [key: string]: string | number | string[];
}

interface ResultsTableProps {
  data: ResultRow[];
  columns: { key: string; label: string }[];
  allColumns?: { key: string; label: string }[];
  columnConfig?: ColumnDef[];
  onColumnConfigChange?: (config: ColumnDef[]) => void;
  emptyMessage?: string;
  cacheKey?: string;
}

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

function Sequencia({ value }: { value: string }) {
  if (!value) return null;
  const chars = value.split("-");
  return (
    <div className="flex items-center gap-0.5">
      {chars.map((c, i) => (
        <span
          key={i}
          className="inline-flex items-center justify-center rounded text-white font-bold"
          style={{
            fontSize: "0.65rem",
            width: 16,
            height: 16,
            background: c === "G" ? "#4db854" : c === "R" ? "#ef4444" : "#3a4a3a",
          }}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

const LIGA_COLORS = [
  { bg: "rgba(20,184,166,0.12)", text: "#14b8a6" },   // teal
  { bg: "rgba(59,130,246,0.12)", text: "#3b82f6" },   // blue
  { bg: "rgba(168,85,247,0.12)", text: "#a855f7" },   // purple
  { bg: "rgba(236,72,153,0.12)", text: "#ec4899" },   // pink
  { bg: "rgba(245,158,11,0.12)", text: "#f59e0b" },   // amber
  { bg: "rgba(16,185,129,0.12)", text: "#10b981" },   // emerald
  { bg: "rgba(6,182,212,0.12)", text: "#06b6d4" },    // cyan
  { bg: "rgba(244,63,94,0.12)", text: "#f43f5e" },    // rose
  { bg: "rgba(99,102,241,0.12)", text: "#6366f1" },   // indigo
  { bg: "rgba(132,204,22,0.12)", text: "#84cc16" },   // lime
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function LigaBadge({ value }: { value: string }) {
  if (!value) return null;
  const parts = value.split(" / ").map((s) => s.trim()).filter(Boolean);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {parts.map((liga) => {
        const color = LIGA_COLORS[hashString(liga) % LIGA_COLORS.length];
        return (
          <span
            key={liga}
            className="px-2 py-0.5 rounded-md text-xs font-medium"
            style={{ background: color.bg, color: color.text, whiteSpace: "nowrap" }}
          >
            {liga}
          </span>
        );
      })}
    </div>
  );
}

export function ResultsTable({ data, columns, allColumns, columnConfig, onColumnConfigChange, emptyMessage = "Nenhum resultado encontrado", cacheKey }: ResultsTableProps) {
  const [sortKey, setSortKey] = useState<string>("porcentagem");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [showColumnConfig, setShowColumnConfig] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [data, sortKey, sortDir]);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < max - 4);
    setScrollProgress(max > 0 ? el.scrollLeft / max : 0);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => ro.disconnect();
  }, [checkScroll, data, columns]);

  const scroll = (dir: "left" | "right") => {
    scrollRef.current?.scrollBy({ left: dir === "right" ? 320 : -320, behavior: "smooth" });
  };

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const openBlueprint = (row: ResultRow) => {
    if (!cacheKey) return;
    const params = new URLSearchParams();
    params.set("dupla", row.dupla);
    if (row.linha) params.set("linha", row.linha);
    window.open(`/blueprint/${cacheKey}?${params.toString()}`, "_blank");
  };

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <p className="text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  function renderCell(row: ResultRow, key: string) {
    if (key === "porcentagem" || key === "pct_green_10") {
      return <PctBar value={row[key] as number} />;
    }
    if (key === "ultimos_6") {
      return <Sequencia value={row.ultimos_6} />;
    }
    if (key === "ligas") {
      return <LigaBadge value={row.ligas} />;
    }
    if (key === "linha") {
      const v = row.linha;
      if (!v) return <span className="text-muted-foreground">&mdash;</span>;
      return (
        <span
          className="px-2 py-0.5 rounded-md text-xs font-medium"
          style={isDark
            ? { background: "rgba(234,88,12,0.08)", color: "#ea580c", whiteSpace: "nowrap" }
            : { background: "rgba(0,0,0,0.06)", color: "#525252", whiteSpace: "nowrap" }
          }
        >
          {v}
        </span>
      );
    }
    const v = row[key];
    const display = typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : v;
    return <span className="tabular-nums">{display}</span>;
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Column config modal */}
      {showColumnConfig && columnConfig && allColumns && onColumnConfigChange && (
        <ColumnConfigModal
          config={columnConfig}
          defaultColumns={allColumns}
          onApply={(cfg) => { onColumnConfigChange(cfg); setShowColumnConfig(false); }}
          onClose={() => setShowColumnConfig(false)}
        />
      )}

      {/* Header info bar */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground" style={{ fontSize: "0.85rem" }}>
            {data.length} dupla{data.length !== 1 ? "s" : ""} encontrada{data.length !== 1 ? "s" : ""}
          </span>
          {columnConfig && onColumnConfigChange && (
            <button
              onClick={() => setShowColumnConfig(true)}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-secondary/50"
              title="Configurar colunas"
              style={{ border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}` }}
            >
              <Settings className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
        {(canScrollLeft || canScrollRight) && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => scroll("left")}
              disabled={!canScrollLeft}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors disabled:opacity-25"
              style={isDark
                ? { background: canScrollLeft ? "rgba(234,88,12,0.1)" : "transparent", border: "1px solid rgba(234,88,12,0.2)" }
                : { background: canScrollLeft ? "rgba(0,0,0,0.06)" : "transparent", border: "1px solid rgba(0,0,0,0.12)" }
              }
            >
              <ChevronLeft className="w-4 h-4 text-primary" />
            </button>
            <button
              onClick={() => scroll("right")}
              disabled={!canScrollRight}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors disabled:opacity-25"
              style={isDark
                ? { background: canScrollRight ? "rgba(234,88,12,0.1)" : "transparent", border: "1px solid rgba(234,88,12,0.2)" }
                : { background: canScrollRight ? "rgba(0,0,0,0.06)" : "transparent", border: "1px solid rgba(0,0,0,0.12)" }
              }
            >
              <ChevronRight className="w-4 h-4 text-primary" />
            </button>
          </div>
        )}
      </div>

      {/* Scroll progress bar */}
      {(canScrollLeft || canScrollRight) && (
        <div className="h-0.5 bg-secondary/50 relative">
          <div
            className="absolute top-0 left-0 h-full rounded-full transition-all duration-100"
            style={{
              width: `${scrollProgress * 100}%`,
              background: "linear-gradient(to right, #ea580c, #fdba74)",
            }}
          />
        </div>
      )}

      {/* Table with scroll navigation */}
      <div className="relative">
        {/* Left scroll button */}
        {canScrollLeft && (
          <button
            onClick={() => scroll("left")}
            className="absolute left-0 top-0 bottom-0 z-10 flex items-center px-2 transition-opacity group/scroll"
            style={{
              background: isDark
                ? "linear-gradient(to right, rgba(5,0,10,0.92) 50%, transparent)"
                : "linear-gradient(to right, rgba(255,255,255,0.95) 40%, transparent)",
              width: 56,
            }}
          >
            <span
              className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
              style={isDark ? {
                background: "rgba(234,88,12,0.12)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                border: "1px solid rgba(234,88,12,0.4)",
                boxShadow: "0 0 12px rgba(234,88,12,0.2)",
              } : {
                background: "rgba(0,0,0,0.06)",
                border: "1px solid rgba(0,0,0,0.12)",
                boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
              }}
            >
              <ChevronLeft className="w-4 h-4" style={{ color: isDark ? "#ea580c" : "#525252" }} />
            </span>
          </button>
        )}

        {/* Right scroll button */}
        {canScrollRight && (
          <button
            onClick={() => scroll("right")}
            className="absolute right-0 top-0 bottom-0 z-10 flex items-center justify-end px-2 transition-opacity"
            style={{
              background: isDark
                ? "linear-gradient(to left, rgba(5,0,10,0.92) 50%, transparent)"
                : "linear-gradient(to left, rgba(255,255,255,0.95) 40%, transparent)",
              width: 56,
            }}
          >
            <span
              className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
              style={isDark ? {
                background: "rgba(234,88,12,0.12)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                border: "1px solid rgba(234,88,12,0.4)",
                boxShadow: "0 0 12px rgba(234,88,12,0.2)",
              } : {
                background: "rgba(0,0,0,0.06)",
                border: "1px solid rgba(0,0,0,0.12)",
                boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
              }}
            >
              <ChevronRight className="w-4 h-4" style={{ color: isDark ? "#ea580c" : "#525252" }} />
            </span>
          </button>
        )}

        <div ref={scrollRef} onScroll={checkScroll} className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className="px-4 py-3 text-left text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none whitespace-nowrap"
                    style={{ fontSize: "0.85rem" }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{col.label}</span>
                      {sortKey === col.key ? (
                        sortDir === "asc" ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )
                      ) : (
                        <ArrowUpDown className="w-3.5 h-3.5 opacity-30" />
                      )}
                    </div>
                  </th>
                ))}
                {cacheKey && (
                  <th className="px-4 py-3 text-left text-muted-foreground whitespace-nowrap" style={{ fontSize: "0.85rem" }}>
                    <span>Detalhe</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr
                  key={row.id}
                  className={`border-b border-border/50 transition-colors hover:bg-secondary/30 ${i % 2 === 0 ? "" : "bg-secondary/10"
                    }`}
                >
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3 text-foreground" style={{ fontSize: "0.9rem" }}>
                      {renderCell(row, col.key)}
                    </td>
                  ))}
                  {cacheKey && (
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openBlueprint(row)}
                        className="text-muted-foreground hover:text-primary transition-colors"
                        title="Ver jogos detalhados (nova aba)"
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
