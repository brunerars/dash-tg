import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Star, X, Calendar, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { useFlags } from "./FlagsContext";
import { useTheme } from "./ThemeContext";
import { syncGrade, type Flag } from "../services/api";

type StatusKind = "com_jogos" | "sem_jogos_futuros" | "sem_jogos";

function statusOf(f: Flag): StatusKind {
  const up = f.upcoming_count ?? 0;
  const past = f.past_count ?? 0;
  if (up > 0) return "com_jogos";
  if (past > 0) return "sem_jogos_futuros";
  return "sem_jogos";
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `ha ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `ha ${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `ha ${days}d`;
  return d.toLocaleDateString("pt-BR");
}

function absDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FavoritosPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();
  const flags = useFlags();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"todos" | StatusKind>("todos");
  const [strategyFilter, setStrategyFilter] = useState<string>("todas");
  const [syncing, setSyncing] = useState(false);

  const strategies = useMemo(() => {
    const s = new Set(flags.flags.map((f) => f.strategy));
    return Array.from(s).sort();
  }, [flags.flags]);

  const filtered = useMemo(() => {
    return flags.flags.filter((f) => {
      if (filter !== "todos" && statusOf(f) !== filter) return false;
      if (strategyFilter !== "todas" && f.strategy !== strategyFilter) return false;
      return true;
    });
  }, [flags.flags, filter, strategyFilter]);

  const counts = useMemo(() => {
    const c = { com_jogos: 0, sem_jogos_futuros: 0, sem_jogos: 0, total: flags.flags.length };
    for (const f of flags.flags) c[statusOf(f)]++;
    return c;
  }, [flags.flags]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleRemove = async (f: Flag) => {
    if (!confirm(`Remover "${f.dupla_display}" dos favoritos? Os jogos dela saem da grade.`)) return;
    await flags.toggle(f.dupla_display, f.strategy, {}, undefined);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncGrade();
      await flags.reload();
    } finally {
      setSyncing(false);
    }
  };

  const statusBadge = (kind: StatusKind, f: Flag) => {
    if (kind === "com_jogos") {
      return (
        <span
          className="px-2 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap"
          style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}
        >
          {f.upcoming_count} jogo{f.upcoming_count !== 1 ? "s" : ""} {f.next_game_at && `· proximo ${absDateTime(f.next_game_at)}`}
        </span>
      );
    }
    if (kind === "sem_jogos_futuros") {
      return (
        <span
          className="px-2 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap"
          style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}
        >
          Sem jogos futuros {f.last_game_at && `· ultimo ${absDateTime(f.last_game_at)}`}
        </span>
      );
    }
    return (
      <span
        className="px-2 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap"
        style={{ background: "rgba(163,163,163,0.12)", color: isDark ? "#a3a3a3" : "#737373" }}
      >
        Sem jogos no scraper
      </span>
    );
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground flex items-center gap-3">
            <Star className="w-6 h-6 text-primary" fill="#ea580c" />
            Favoritos
          </h1>
          <p className="text-muted-foreground mt-1" style={{ fontSize: "0.9rem" }}>
            Duplas flagadas e status dos jogos no scraper.
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-widest transition-all disabled:opacity-40"
          style={{
            border: isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid #d4d4d4",
            background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)",
            color: isDark ? "#a1a1a1" : "#737373",
          }}
          title="Forcar sync com scraper"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
          <span>{syncing ? "Sincronizando..." : "Sincronizar"}</span>
        </button>
      </div>

      {/* Stats quick */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatPill label="Total" value={counts.total} color={isDark ? "#ea580c" : "#0a0a0a"} isDark={isDark} />
        <StatPill label="Com jogos" value={counts.com_jogos} color="#22c55e" isDark={isDark} />
        <StatPill label="Sem futuros" value={counts.sem_jogos_futuros} color="#f59e0b" isDark={isDark} />
        <StatPill label="Sem dados" value={counts.sem_jogos} color={isDark ? "#737373" : "#a3a3a3"} isDark={isDark} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-muted-foreground text-xs uppercase tracking-widest mr-2">Status:</span>
        {(["todos", "com_jogos", "sem_jogos_futuros", "sem_jogos"] as const).map((k) => (
          <FilterChip key={k} active={filter === k} onClick={() => setFilter(k)} isDark={isDark}>
            {k === "todos" ? "Todos"
              : k === "com_jogos" ? "Com jogos"
              : k === "sem_jogos_futuros" ? "Sem futuros"
              : "Sem dados"}
          </FilterChip>
        ))}
        {strategies.length > 1 && (
          <>
            <span className="text-muted-foreground text-xs uppercase tracking-widest mx-2">Estrategia:</span>
            <FilterChip active={strategyFilter === "todas"} onClick={() => setStrategyFilter("todas")} isDark={isDark}>
              Todas
            </FilterChip>
            {strategies.map((s) => (
              <FilterChip key={s} active={strategyFilter === s} onClick={() => setStrategyFilter(s)} isDark={isDark}>
                {s}
              </FilterChip>
            ))}
          </>
        )}
      </div>

      {/* Lista */}
      {flags.loading && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      )}
      {!flags.loading && flags.flags.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-12 text-center space-y-3">
          <Star className="w-10 h-10 text-muted-foreground mx-auto opacity-50" />
          <p className="text-foreground">Nenhuma dupla favoritada.</p>
          <p className="text-muted-foreground" style={{ fontSize: "0.9rem" }}>
            Nas analises, clique na estrela ao lado da dupla para adicionar aqui.
          </p>
        </div>
      )}
      {!flags.loading && flags.flags.length > 0 && filtered.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <p className="text-muted-foreground">Nenhum favorito com esses filtros.</p>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((f) => {
          const kind = statusOf(f);
          const isOpen = expanded.has(f.id);
          return (
            <div
              key={f.id}
              className="rounded-xl border border-border bg-card overflow-hidden"
            >
              <div className="px-4 py-3 flex items-center gap-3">
                <Star className="w-4 h-4 shrink-0" fill="#ea580c" color="#ea580c" />
                <div className="flex-1 min-w-0">
                  <div className="text-foreground font-medium">{f.dupla_display}</div>
                  <div className="text-muted-foreground text-xs flex items-center gap-2 mt-0.5">
                    <span
                      className="px-1.5 py-0.5 rounded"
                      style={isDark
                        ? { background: "rgba(234,88,12,0.08)", color: "#ea580c" }
                        : { background: "rgba(0,0,0,0.06)", color: "#525252" }
                      }
                    >
                      {f.strategy}
                    </span>
                    <span>flagada {relativeTime(f.flagged_at)}</span>
                  </div>
                </div>
                <div className="hidden md:block">{statusBadge(kind, f)}</div>
                <button
                  onClick={() => toggleExpand(f.id)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Ver snapshot"
                >
                  {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => navigate("/grade")}
                  className="text-muted-foreground hover:text-primary transition-colors"
                  title="Ver na grade"
                  disabled={kind !== "com_jogos"}
                  style={{ opacity: kind === "com_jogos" ? 1 : 0.3 }}
                >
                  <Calendar className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleRemove(f)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  title="Remover favorito"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {/* Badge mobile */}
              <div className="md:hidden px-4 pb-3">{statusBadge(kind, f)}</div>

              {/* Snapshot drawer inline */}
              {isOpen && <SnapshotPanel flag={f} isDark={isDark} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatPill({ label, value, color, isDark }: { label: string; value: number; color: string; isDark: boolean }) {
  return (
    <div
      className="rounded-xl border border-border p-4"
      style={{
        background: isDark ? "rgba(255,255,255,0.02)" : "#ffffff",
      }}
    >
      <div className="text-muted-foreground text-xs uppercase tracking-widest">{label}</div>
      <div className="text-foreground font-semibold mt-1" style={{ fontSize: "1.6rem", color }}>
        {value}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  isDark,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  isDark: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
      style={{
        background: active
          ? (isDark ? "rgba(234,88,12,0.15)" : "#171717")
          : (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)"),
        color: active
          ? (isDark ? "#ea580c" : "#ffffff")
          : (isDark ? "#a1a1a1" : "#525252"),
        border: active
          ? (isDark ? "1px solid rgba(234,88,12,0.3)" : "1px solid #0a0a0a")
          : (isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid #d4d4d4"),
      }}
    >
      {children}
    </button>
  );
}

function SnapshotPanel({ flag, isDark }: { flag: Flag; isDark: boolean }) {
  const snap = (flag.snapshot ?? {}) as Record<string, unknown>;
  const entries = Object.entries(snap)
    .filter(([k]) => !["id", "fontes"].includes(k))
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div
      className="border-t border-border px-4 py-4 space-y-3"
      style={{ background: isDark ? "rgba(255,255,255,0.015)" : "rgba(0,0,0,0.015)" }}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-muted-foreground text-xs">Flagada em</div>
          <div className="text-foreground">{absDateTime(flag.flagged_at)}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Proximo jogo</div>
          <div className="text-foreground">{absDateTime(flag.next_game_at)}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Ultimo jogo</div>
          <div className="text-foreground">{absDateTime(flag.last_game_at)}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Cache da analise</div>
          <div className="text-foreground" style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
            {flag.snapshot_cache_key ?? "—"}
          </div>
        </div>
      </div>
      {entries.length > 0 && (
        <div>
          <div className="text-muted-foreground text-xs uppercase tracking-widest mb-2">Snapshot da analise</div>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full">
              <tbody>
                {entries.map(([k, v]) => (
                  <tr key={k} className="border-b border-border/40 last:border-0">
                    <td className="px-3 py-1.5 text-muted-foreground" style={{ fontSize: "0.8rem" }}>{k}</td>
                    <td className="px-3 py-1.5 text-foreground tabular-nums text-right" style={{ fontSize: "0.85rem" }}>
                      {typeof v === "number"
                        ? (Number.isInteger(v) ? v : v.toFixed(2))
                        : Array.isArray(v) ? v.join(" / ")
                        : String(v ?? "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
