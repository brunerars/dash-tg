import { Zap, TrendingUp, Clock, FileSpreadsheet, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router";
import { useTheme } from "./ThemeContext";
import { useSession } from "./SessionContext";

export function HomePage() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { analyses } = useSession();

  const totalDuplas = analyses.reduce((sum, a) => sum + a.duplas, 0);
  const lastDate = analyses[0]?.date ?? "—";

  const stats = [
    { label: "Total de Analises", value: String(analyses.length), icon: FileSpreadsheet },
    { label: "Duplas Analisadas", value: String(totalDuplas), icon: Zap },
    { label: "Ultimo Upload", value: lastDate, icon: Clock },
  ];

  const getBadgeStyle = (type: string): React.CSSProperties => {
    if (isDark) {
      return {
        fontSize: "0.78rem",
        backgroundColor: type === "Dale" ? "rgba(234,88,12,0.08)" : "rgba(249,115,22,0.12)",
        color: type === "Dale" ? "#ea580c" : "#f97316",
      };
    }
    return {
      fontSize: "0.78rem",
      backgroundColor: "rgba(0,0,0,0.06)",
      color: "#525252",
    };
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-foreground">Bem-vindo ao E-Soccer Analytics</h1>
        <p className="text-muted-foreground mt-1">
          Analise duplas de E-Soccer com dados de planilhas de forma rapida e visual
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-border bg-card p-5 flex items-start gap-4 hover:border-primary/30 transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <stat.icon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-muted-foreground" style={{ fontSize: "0.85rem" }}>
                {stat.label}
              </p>
              <p
                className="text-foreground mt-0.5 font-semibold"
                style={{ fontSize: "1.45rem", fontFamily: "'Oswald', sans-serif", letterSpacing: "0.01em" }}
              >
                {stat.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => navigate("/dale")}
          className="group rounded-xl border border-border bg-card p-6 text-left hover:border-primary/40 transition-all"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Zap className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="text-foreground">Analise Dale</h3>
                <p className="text-muted-foreground" style={{ fontSize: "0.85rem" }}>
                  Upload e analise de duplas no modo Dale
                </p>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
        </button>

        <button
          onClick={() => navigate("/over-under")}
          className="group rounded-xl border border-border bg-card p-6 text-left hover:border-primary/40 transition-all"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="text-foreground">Analise Over/Under</h3>
                <p className="text-muted-foreground" style={{ fontSize: "0.85rem" }}>
                  Upload e analise de duplas no modo Over/Under
                </p>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
        </button>
      </div>

      {/* Recent Analyses */}
      <div>
        <h2 className="text-foreground mb-4">Analises da Sessao</h2>
        {analyses.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center">
            <p className="text-muted-foreground" style={{ fontSize: "0.9rem" }}>
              Nenhuma analise realizada ainda. Faca o upload de uma planilha para comecar.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left text-muted-foreground font-medium text-xs uppercase tracking-widest">Arquivo</th>
                    <th className="px-4 py-3 text-left text-muted-foreground font-medium text-xs uppercase tracking-widest">Tipo</th>
                    <th className="px-4 py-3 text-left text-muted-foreground font-medium text-xs uppercase tracking-widest">Data</th>
                    <th className="px-4 py-3 text-left text-muted-foreground font-medium text-xs uppercase tracking-widest">Duplas</th>
                  </tr>
                </thead>
                <tbody>
                  {analyses.map((a, i) => (
                    <tr
                      key={a.id}
                      className={`border-b border-border/50 hover:bg-secondary/30 transition-colors ${i % 2 === 0 ? "" : "bg-secondary/10"}`}
                    >
                      <td className="px-4 py-3" style={{ fontSize: "0.9rem" }}>
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="w-4 h-4 text-primary shrink-0" />
                          <span className="text-foreground">{a.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3" style={{ fontSize: "0.9rem" }}>
                        <span className="px-2.5 py-1 rounded-md font-medium" style={getBadgeStyle(a.type)}>
                          {a.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground" style={{ fontSize: "0.9rem" }}>{a.date}</td>
                      <td className="px-4 py-3 text-foreground tabular-nums" style={{ fontSize: "0.9rem" }}>{a.duplas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
