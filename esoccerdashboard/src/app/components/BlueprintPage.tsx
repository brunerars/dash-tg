import { useState, useEffect } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router";
import { Loader2, ArrowLeft, Download } from "lucide-react";
import { fetchBlueprint } from "../services/api";
import { useTheme } from "./ThemeContext";
import * as XLSX from "xlsx";

interface BlueprintData {
  dupla: string;
  linha: string | null;
  total_jogos: number;
  total_records?: number;
  jogos: Record<string, unknown>[];
}

const COLUMN_LABELS: Record<string, string> = {
  "__bet": "Fonte",
  "Lucro/Prej.": "Lucro/Prej.",
  "Horario Jogo": "Hr. Jogo",
};

export function BlueprintPage() {
  const { cacheKey } = useParams<{ cacheKey: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const dupla = searchParams.get("dupla") ?? "";
  const linha = searchParams.get("linha") ?? undefined;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BlueprintData | null>(null);

  useEffect(() => {
    if (!cacheKey || !dupla) {
      setError("Parâmetros inválidos. cacheKey e dupla são obrigatórios.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchBlueprint(cacheKey, dupla, linha)
      .then((res) => setData(res))
      .catch((err) => setError(err instanceof Error ? err.message : "Erro desconhecido"))
      .finally(() => setLoading(false));
  }, [cacheKey, dupla, linha]);

  // Derive columns from actual data
  const columns = data && data.jogos.length > 0
    ? Object.keys(data.jogos[0])
    : [];

  const handleExport = () => {
    if (!data || data.jogos.length === 0) return;
    const rows = data.jogos.map((jogo) => {
      const obj: Record<string, unknown> = {};
      for (const col of columns) {
        obj[COLUMN_LABELS[col] ?? col] = jogo[col] ?? "";
      }
      return obj;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Blueprint");
    XLSX.writeFile(wb, `blueprint_${dupla.replace(/\s+/g, "_")}.xlsx`);
  };

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-secondary/50"
            style={{ border: isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid #d4d4d4" }}
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <div>
            <h1 className="text-foreground font-semibold" style={{ fontSize: "1.1rem" }}>
              Blueprint: {dupla}
            </h1>
            <div className="flex items-center gap-3">
              {linha && (
                <span className="text-muted-foreground" style={{ fontSize: "0.8rem" }}>
                  Linha: {linha}
                </span>
              )}
              {data && (
                <span className="text-muted-foreground" style={{ fontSize: "0.8rem" }}>
                  {data.total_jogos} jogo{data.total_jogos !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>
        </div>
        {data && data.jogos.length > 0 && (
          <button
            onClick={handleExport}
            className="btn-layrinth flex items-center gap-2"
            style={{ borderRadius: 10 }}
          >
            <Download className="w-4 h-4" />
            Exportar .xlsx
          </button>
        )}
      </div>

      {/* Content */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-7 h-7 text-primary animate-spin" />
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-400 space-y-1">
          <p>{error}</p>
          <p style={{ fontSize: "0.75rem", opacity: 0.7 }}>
            cache_key: {cacheKey ?? "N/A"} | dupla: {dupla || "N/A"} | linha: {linha ?? "N/A"}
          </p>
        </div>
      )}

      {data && !loading && data.jogos.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-8 text-center space-y-2">
          <p className="text-muted-foreground">Nenhum jogo encontrado para esta dupla.</p>
          <p className="text-muted-foreground" style={{ fontSize: "0.75rem" }}>
            Dupla buscada: &quot;{dupla}&quot;{linha ? ` | Linha: "${linha}"` : ""}
            {data.total_records != null && ` | Total registros no cache: ${data.total_records}`}
          </p>
        </div>
      )}

      {data && !loading && data.jogos.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {columns.map((col) => (
                    <th
                      key={col}
                      className="px-4 py-3 text-left text-muted-foreground whitespace-nowrap"
                      style={{ fontSize: "0.85rem" }}
                    >
                      {COLUMN_LABELS[col] ?? col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.jogos.map((jogo, i) => (
                  <tr
                    key={i}
                    className={`border-b border-border/50 ${i % 2 === 0 ? "" : "bg-secondary/10"}`}
                  >
                    {columns.map((col) => {
                      const val = jogo[col];
                      const isResultado = col === "Resultado";
                      const isGreen = isResultado && String(val).toUpperCase() === "GREEN";
                      const isRed = isResultado && String(val).toUpperCase() === "RED";
                      // Format Data column to BR format (DD/MM/YYYY)
                      let display = val != null ? String(val) : "\u2014";
                      if (col === "Data" && typeof val === "string") {
                        const iso = val.includes("T") ? val.split("T")[0] : val;
                        const parts = iso.split("-");
                        if (parts.length === 3) {
                          display = `${parts[2]}/${parts[1]}/${parts[0]}`;
                        }
                      }
                      return (
                        <td
                          key={col}
                          className="px-4 py-3 whitespace-nowrap"
                          style={{
                            fontSize: "0.9rem",
                            color: isGreen
                              ? "#4db854"
                              : isRed
                                ? "#ef4444"
                                : isDark
                                  ? "#e5e5e5"
                                  : "#1a1a1a",
                            fontWeight: isResultado ? 600 : 400,
                          }}
                        >
                          {display}
                        </td>
                      );
                    })}
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
