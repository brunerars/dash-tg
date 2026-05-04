import { Calendar } from "lucide-react";
import { useState } from "react";
import { useTheme } from "./ThemeContext";

export type PeriodType = "all" | "15d" | "30d" | "60d" | "90d" | "custom";

interface PeriodFilterCardProps {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onPeriodTypeChange?: (type: PeriodType) => void;
}

export function PeriodFilterCard({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onPeriodTypeChange,
}: PeriodFilterCardProps) {
  type PeriodType = "all" | "15d" | "30d" | "60d" | "90d" | "custom";
  const [periodType, setPeriodType] = useState<PeriodType>("all");
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const handlePeriodType = (type: PeriodType) => {
    setPeriodType(type);
    onPeriodTypeChange?.(type);
    if (type === "all") {
      onDateFromChange("");
      onDateToChange("");
    } else if (type !== "custom") {
      const days = parseInt(type);
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - days);
      onDateFromChange(from.toISOString().slice(0, 10));
      onDateToChange(to.toISOString().slice(0, 10));
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Calendar className="w-4 h-4 text-primary" />
      </div>
      <span className="text-muted-foreground whitespace-nowrap" style={{ fontSize: "0.85rem" }}>
        Filtrar por Período
      </span>

      <div className="flex gap-1 flex-wrap">
        {(["all", "15d", "30d", "60d", "90d", "custom"] as const).map((type) => {
          const label = type === "all" ? "Todos" : type === "custom" ? "Personalizado" : type;
          return (
            <button
              key={type}
              onClick={() => handlePeriodType(type)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                periodType === type
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {periodType === "custom" && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-muted-foreground" style={{ fontSize: "0.8rem" }}>De</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-input-background border border-border text-foreground focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
            style={{ fontSize: "0.85rem", colorScheme: isDark ? "dark" : "light" }}
          />
          <span className="text-muted-foreground" style={{ fontSize: "0.8rem" }}>Até</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-input-background border border-border text-foreground focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
            style={{ fontSize: "0.85rem", colorScheme: isDark ? "dark" : "light" }}
          />
        </div>
      )}
    </div>
  );
}
