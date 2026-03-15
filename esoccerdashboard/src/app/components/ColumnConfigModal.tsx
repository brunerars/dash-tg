import { useState } from "react";
import { createPortal } from "react-dom";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import { useTheme } from "./ThemeContext";

export interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

interface ColumnConfigModalProps {
  config: ColumnDef[];
  defaultColumns: { key: string; label: string }[];
  onApply: (config: ColumnDef[]) => void;
  onClose: () => void;
}

export function ColumnConfigModal({ config, defaultColumns, onApply, onClose }: ColumnConfigModalProps) {
  const [draft, setDraft] = useState<ColumnDef[]>(() => JSON.parse(JSON.stringify(config)));
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const bg = isDark ? "#1a1a1a" : "#ffffff";
  const borderColor = isDark ? "rgba(255,255,255,0.12)" : "#d4d4d4";
  const textColor = isDark ? "#e5e5e5" : "#171717";
  const mutedColor = isDark ? "#a1a1a1" : "#737373";
  const inputBg = isDark ? "rgba(255,255,255,0.06)" : "#ffffff";
  const rowHover = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)";

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[index], next[target]] = [next[target], next[index]];
    setDraft(next);
  };

  const toggleVisible = (index: number) => {
    const next = [...draft];
    next[index] = { ...next[index], visible: !next[index].visible };
    setDraft(next);
  };

  const setLabel = (index: number, label: string) => {
    const next = [...draft];
    next[index] = { ...next[index], label };
    setDraft(next);
  };

  const reset = () => {
    setDraft(defaultColumns.map((c) => ({ key: c.key, label: c.label, visible: true })));
  };

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: bg,
          border: `1px solid ${borderColor}`,
          borderRadius: 12,
          width: 420,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: isDark
            ? "0 16px 48px rgba(0,0,0,0.7)"
            : "0 8px 32px rgba(0,0,0,0.15)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${borderColor}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: "0.95rem", fontWeight: 600, color: textColor }}>
            Configurar Colunas
          </span>
          <button
            onClick={onClose}
            className="transition-colors"
            style={{ color: mutedColor }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", flex: 1, padding: "8px 0" }}>
          {draft.map((col, i) => (
            <div
              key={col.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 20px",
                fontSize: "0.85rem",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = rowHover; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <input
                type="checkbox"
                checked={col.visible}
                onChange={() => toggleVisible(i)}
                style={{ accentColor: "#ea580c", cursor: "pointer" }}
              />
              <input
                type="text"
                value={col.label}
                onChange={(e) => setLabel(i, e.target.value)}
                style={{
                  flex: 1,
                  fontSize: "0.85rem",
                  background: inputBg,
                  border: `1px solid ${borderColor}`,
                  color: textColor,
                  borderRadius: 6,
                  padding: "4px 8px",
                  outline: "none",
                  opacity: col.visible ? 1 : 0.4,
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="transition-colors disabled:opacity-20"
                  style={{ color: mutedColor, padding: 0, lineHeight: 0 }}
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === draft.length - 1}
                  className="transition-colors disabled:opacity-20"
                  style={{ color: mutedColor, padding: 0, lineHeight: 0 }}
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: `1px solid ${borderColor}`,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <button
            onClick={reset}
            style={{
              fontSize: "0.8rem",
              color: mutedColor,
              background: "transparent",
              border: `1px solid ${borderColor}`,
              borderRadius: 8,
              padding: "6px 14px",
              cursor: "pointer",
            }}
          >
            Resetar
          </button>
          <button
            onClick={() => onApply(draft)}
            className="btn-layrinth"
            style={{
              fontSize: "0.8rem",
              borderRadius: 8,
              padding: "6px 20px",
              cursor: "pointer",
            }}
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
