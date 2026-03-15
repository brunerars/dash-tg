import { useState, useRef, useEffect } from "react";
import { Clock, ChevronDown, X } from "lucide-react";
import { useTheme } from "./ThemeContext";

interface TimeFilterProps {
  availableHorarios: string[];
  selectedHorarios: string[];
  onSelectedHorariosChange: (v: string[]) => void;
}

/** Formata horário para exibição legível */
function formatHorario(h: string): string {
  return h;
}

export function TimeFilter({ availableHorarios, selectedHorarios, onSelectedHorariosChange }: TimeFilterProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (h: string) => {
    if (selectedHorarios.includes(h)) {
      onSelectedHorariosChange(selectedHorarios.filter((x) => x !== h));
    } else {
      onSelectedHorariosChange([...selectedHorarios, h]);
    }
  };

  const inputBg = isDark ? "rgba(255,255,255,0.06)" : "#ffffff";
  const inputBorder = isDark ? "rgba(255,255,255,0.12)" : "#d4d4d4";
  const inputColor = isDark ? "#e5e5e5" : "#171717";
  const labelColor = isDark ? "#a1a1a1" : "#737373";
  const hoverBg = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";

  if (availableHorarios.length === 0) return null;

  const label = selectedHorarios.length === 0
    ? "Todos"
    : selectedHorarios.map(formatHorario).join(", ");

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Clock className="w-4 h-4 text-primary" />
      </div>
      <label className="text-muted-foreground whitespace-nowrap" style={{ fontSize: "0.85rem" }}>
        Horário Jogo
      </label>
      <div style={{ flex: 1, position: "relative" }} ref={ref}>
        <button
          onClick={() => setOpen(!open)}
          style={{
            fontSize: "0.85rem",
            background: inputBg,
            border: `1px solid ${inputBorder}`,
            color: inputColor,
            borderRadius: 8,
            padding: "6px 10px",
            outline: "none",
            width: "100%",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {label}
          </span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: labelColor }} />
        </button>
        {selectedHorarios.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onSelectedHorariosChange([]); }}
            className="absolute top-1/2 -translate-y-1/2 transition-colors"
            style={{ right: 28, color: labelColor }}
          >
            <X className="w-3 h-3" />
          </button>
        )}
        {open && (
          <div
            style={{
              position: "absolute",
              zIndex: 50,
              marginTop: 4,
              width: "100%",
              maxHeight: 240,
              overflowY: "auto",
              borderRadius: 8,
              border: `1px solid ${inputBorder}`,
              background: isDark ? "#1a1a1a" : "#ffffff",
              boxShadow: isDark
                ? "0 8px 24px rgba(0,0,0,0.6)"
                : "0 4px 16px rgba(0,0,0,0.12)",
            }}
          >
            {availableHorarios.map((h) => (
              <label
                key={h}
                className="flex items-center gap-2 cursor-pointer"
                style={{
                  padding: "6px 12px",
                  fontSize: "0.8rem",
                  color: inputColor,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = hoverBg;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedHorarios.includes(h)}
                  onChange={() => toggle(h)}
                  style={{ accentColor: "#ea580c" }}
                />
                <span>{formatHorario(h)}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
