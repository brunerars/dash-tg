import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, RefreshCw, Star, X, AlertTriangle } from "lucide-react";
import { fetchGrade, syncGrade, type GridItem } from "../services/api";
import { useFlags } from "./FlagsContext";
import { useTheme } from "./ThemeContext";

type FilterKey = "hoje" | "amanha" | "semana" | "todos";

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Transforma "DD/MM/YY" ou "YYYY-MM-DD" num label de dia legivel.
function dateLabel(s: string | null): string {
  if (!s) return "Sem data";
  let d: Date | null = null;
  if (s.includes("/")) {
    const [dd, mm, yy] = s.split("/");
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    d = new Date(year, Number(mm) - 1, Number(dd));
  } else if (s.includes("-")) {
    const [yy, mm, dd] = s.split("-");
    d = new Date(Number(yy), Number(mm) - 1, Number(dd));
  }
  if (!d) return s;
  const dias = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];
  return `${dias[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// Compara 2 datas em varios formatos "DD/MM/YY" | "YYYY-MM-DD" -> YMD.
function normalizeDate(s: string | null): string {
  if (!s) return "";
  if (s.includes("-")) return s;
  if (s.includes("/")) {
    const [dd, mm, yy] = s.split("/");
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    return `${year}-${String(Number(mm)).padStart(2, "0")}-${String(Number(dd)).padStart(2, "0")}`;
  }
  return s;
}

const LIGA_LABEL: Record<string, string> = {
  adriatic: "Adriatic",
  gtleague: "GT League",
  ebattle: "eBattle",
};

export function GradePage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const flags = useFlags();
  const [items, setItems] = useState<GridItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("todos");
  const [syncing, setSyncing] = useState(false);
  const [detail, setDetail] = useState<GridItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const today = toYMD(new Date());
      let from: string | undefined = undefined;
      let to: string | undefined = undefined;
      if (filter === "hoje") { from = today; to = today; }
      else if (filter === "amanha") {
        const t = new Date(); t.setDate(t.getDate() + 1);
        from = toYMD(t); to = toYMD(t);
      }
      else if (filter === "semana") {
        from = today;
        const t = new Date(); t.setDate(t.getDate() + 7);
        to = toYMD(t);
      }
      // Obs: backend compara string; se armazenado DD/MM/YY ele nao vai bater com YYYY-MM-DD.
      // Estrategia: nao manda from/to no backend quando formato eh incerto, filtra no frontend.
      const data = await fetchGrade();
      setItems(data.items);
      // filtragem client-side (robusta a formato de data)
      if (from && to) {
        setItems(data.items.filter((i) => {
          const d = normalizeDate(i.event_date);
          return d >= from! && d <= to!;
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar grade");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
    const int = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(int);
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, GridItem[]>();
    for (const it of items) {
      const key = normalizeDate(it.event_date) || "sem-data";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncGrade();
      await load();
    } finally { setSyncing(false); }
  };

  const handleRemoveFavorite = async (favoriteId: string) => {
    const fav = flags.flags.find((f) => f.id === favoriteId);
    if (!fav) return;
    if (!confirm(`Remover "${fav.dupla_display}" da grade?`)) return;
    await flags.toggle(fav.dupla_display, fav.strategy, {}, undefined);
    await load();
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground flex items-center gap-3">
            <Calendar className="w-6 h-6 text-primary" />
            Grade do Dia
          </h1>
          <p className="text-muted-foreground mt-1" style={{ fontSize: "0.9rem" }}>
            Duplas flagadas e seus jogos futuros nos scrapers.
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

      {/* Filter */}
      <div className="flex gap-2">
        {(["hoje", "amanha", "semana", "todos"] as FilterKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: filter === k
                ? (isDark ? "rgba(234,88,12,0.15)" : "#171717")
                : (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)"),
              color: filter === k
                ? (isDark ? "#ea580c" : "#ffffff")
                : (isDark ? "#a1a1a1" : "#525252"),
              border: filter === k
                ? (isDark ? "1px solid rgba(234,88,12,0.3)" : "1px solid #0a0a0a")
                : (isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid #d4d4d4"),
              textTransform: "capitalize",
            }}
          >
            {k === "amanha" ? "Amanha" : k}
          </button>
        ))}
      </div>

      {/* Empty states */}
      {loading && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      )}
      {error && !loading && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-center">
          <p className="text-destructive">{error}</p>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-12 text-center space-y-3">
          <Star className="w-10 h-10 text-muted-foreground mx-auto opacity-50" />
          <p className="text-foreground">Nenhuma dupla flagada ainda.</p>
          <p className="text-muted-foreground" style={{ fontSize: "0.9rem" }}>
            Volte para as analises e clique na estrela ao lado de uma dupla para adicionar aqui.
          </p>
        </div>
      )}

      {/* Groups */}
      {!loading && !error && grouped.map(([day, list]) => (
        <div key={day} className="rounded-xl border border-border bg-card overflow-hidden">
          <div
            className="px-4 py-3 border-b border-border font-semibold"
            style={{
              background: isDark ? "rgba(234,88,12,0.06)" : "rgba(0,0,0,0.03)",
              color: isDark ? "#ea580c" : "#0a0a0a",
              fontSize: "0.9rem",
              letterSpacing: "0.02em",
            }}
          >
            {dateLabel(day)} <span className="text-muted-foreground font-normal">• {list.length} jogo{list.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="divide-y divide-border/40">
            {list.map((it) => {
              const snap = (it.snapshot ?? {}) as Record<string, unknown>;
              const pct = typeof snap.porcentagem === "number" ? snap.porcentagem.toFixed(1) : "—";
              const srpt = typeof snap.srpt === "number" ? snap.srpt.toFixed(2) : "—";
              const ult = typeof snap.ultimos_6 === "string" ? snap.ultimos_6 : "—";
              const partidas = typeof snap.partidas === "number" ? snap.partidas : "—";
              const flag = flags.flags.find((f) => f.id === it.favorite_id);
              const stale = false; // flag stale pertence a ResultsTable; aqui mostra apenas o snapshot
              return (
                <div
                  key={it.match_id}
                  className="px-4 py-3 flex items-center gap-3 hover:bg-secondary/30 transition-colors cursor-pointer"
                  onClick={() => setDetail(it)}
                >
                  <div style={{ minWidth: 60 }} className="text-foreground tabular-nums font-semibold">
                    {it.event_time ?? "—"}
                  </div>
                  <div style={{ minWidth: 90 }}>
                    <span
                      className="px-2 py-0.5 rounded-md text-xs font-medium"
                      style={isDark
                        ? { background: "rgba(234,88,12,0.1)", color: "#ea580c" }
                        : { background: "rgba(0,0,0,0.06)", color: "#525252" }
                      }
                    >
                      {LIGA_LABEL[it.liga] ?? it.liga}
                    </span>
                  </div>
                  <div className="flex-1 text-foreground font-medium">
                    {it.dupla_display}
                    <span className="text-muted-foreground ml-2" style={{ fontSize: "0.8rem" }}>
                      ({it.strategy})
                    </span>
                  </div>
                  <div className="hidden md:flex items-center gap-4 text-xs tabular-nums text-muted-foreground">
                    <span title="Partidas analisadas">N={partidas}</span>
                    <span title="% Green">{pct}%</span>
                    <span title="SRPT">SRPT {srpt}</span>
                    <span title="Ultimos 6" className="font-mono">{ult}</span>
                  </div>
                  {stale && <AlertTriangle className="w-4 h-4 text-yellow-500" />}
                  <button
                    onClick={(e) => { e.stopPropagation(); if (flag) void handleRemoveFavorite(flag.id); }}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    title="Remover da grade"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Drawer de detalhes */}
      {detail && <DetailDrawer item={detail} onClose={() => setDetail(null)} isDark={isDark} />}
    </div>
  );
}

function DetailDrawer({ item, onClose, isDark }: { item: GridItem; onClose: () => void; isDark: boolean }) {
  const snap = (item.snapshot ?? {}) as Record<string, unknown>;
  const entries = Object.entries(snap)
    .filter(([k]) => !["id", "fontes"].includes(k))
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-md overflow-y-auto"
        style={{
          background: isDark ? "rgb(10,10,10)" : "#ffffff",
          borderLeft: isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid #d4d4d4",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-foreground font-semibold">Detalhes da dupla</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4" style={{ fontSize: "0.9rem" }}>
          <div>
            <div className="text-muted-foreground text-xs uppercase tracking-widest mb-1">Dupla</div>
            <div className="text-foreground font-semibold text-lg">{item.dupla_display}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-muted-foreground text-xs">Liga</div>
              <div className="text-foreground">{LIGA_LABEL[item.liga] ?? item.liga}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Data</div>
              <div className="text-foreground">{item.event_date} {item.event_time}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Estrategia</div>
              <div className="text-foreground">{item.strategy}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Flagado em</div>
              <div className="text-foreground">
                {item.flagged_at ? new Date(item.flagged_at).toLocaleString("pt-BR") : "—"}
              </div>
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs uppercase tracking-widest mb-2">Jogo</div>
            <div className="text-foreground">
              <div>{item.home_team} <span className="text-muted-foreground">({item.home_player})</span></div>
              <div className="text-muted-foreground my-1">vs</div>
              <div>{item.away_team} <span className="text-muted-foreground">({item.away_player})</span></div>
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs uppercase tracking-widest mb-2">Snapshot da analise</div>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full">
                <tbody>
                  {entries.map(([k, v]) => (
                    <tr key={k} className="border-b border-border/40 last:border-0">
                      <td className="px-3 py-2 text-muted-foreground" style={{ fontSize: "0.8rem" }}>{k}</td>
                      <td className="px-3 py-2 text-foreground tabular-nums text-right" style={{ fontSize: "0.85rem" }}>
                        {typeof v === "number"
                          ? (Number.isInteger(v) ? v : v.toFixed(2))
                          : String(v ?? "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {item.snapshot_cache_key && (
              <div className="text-muted-foreground text-xs mt-2" style={{ fontFamily: "monospace" }}>
                cache_key: {item.snapshot_cache_key}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
