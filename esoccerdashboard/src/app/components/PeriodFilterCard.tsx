import { Calendar } from "lucide-react";
import { useState } from "react";
import { useTheme } from "./ThemeContext";

interface PeriodFilterCardProps {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
}

export function PeriodFilterCard({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}: PeriodFilterCardProps) {
  const [periodType, setPeriodType] = useState<"all" | "custom">("all");
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const handlePeriodType = (type: "all" | "custom") => {
    setPeriodType(type);
    if (type === "all") {
      onDateFromChange("");
      onDateToChange("");
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

      <div className="flex gap-1">
        <button
          onClick={() => handlePeriodType("all")}
          className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
            periodType === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
          }`}
        >
          Todos
        </button>
        <button
          onClick={() => handlePeriodType("custom")}
          className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
            periodType === "custom"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
          }`}
        >
          Personalizado
        </button>
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
