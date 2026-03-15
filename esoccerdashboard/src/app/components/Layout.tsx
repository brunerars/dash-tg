import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar";
import { useTheme } from "./ThemeContext";
import { Moon, Sun } from "lucide-react";

export function Layout() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Ambient blobs — dark mode only */}
      {isDark && (
        <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
          <div
            className="liquid-blob"
            style={{ background: "#1a1a1a", width: 700, height: 700, top: -180, left: -150, opacity: 0.5, animationDuration: "16s" }}
          />
          <div
            className="liquid-blob"
            style={{ background: "#0a0a0a", width: 550, height: 550, bottom: -120, right: 100, opacity: 0.6, animationDuration: "22s", animationDelay: "-7s" }}
          />
          <div
            className="liquid-blob"
            style={{ background: "#7c2d12", width: 380, height: 380, top: "38%", left: "52%", opacity: 0.15, animationDuration: "18s", animationDelay: "-3s" }}
          />
        </div>
      )}

      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden" style={{ position: "relative", zIndex: 1 }}>
        {/* Top header bar */}
        <header
          className="shrink-0 h-14 flex items-center justify-end px-6"
          style={{
            background: isDark ? "rgba(5,5,5,0.92)" : "rgba(230,230,230,0.95)",
            borderBottom: isDark ? "1px solid rgba(255,255,255,0.05)" : "1px solid #d4d4d4",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          <button
            onClick={toggleTheme}
            title={isDark ? "Modo claro" : "Modo escuro"}
            className="flex items-center gap-2 rounded-full text-xs font-semibold uppercase tracking-widest transition-all duration-200"
            style={{
              padding: "7px 16px",
              border: isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid #d4d4d4",
              background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)",
              color: isDark ? "#a1a1a1" : "#737373",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              if (isDark) {
                el.style.borderColor = "#ea580c";
                el.style.color = "#ea580c";
              } else {
                el.style.borderColor = "#0a0a0a";
                el.style.color = "#0a0a0a";
              }
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget;
              el.style.borderColor = isDark ? "rgba(255,255,255,0.1)" : "#d4d4d4";
              el.style.color = isDark ? "#a1a1a1" : "#737373";
            }}
          >
            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span>{isDark ? "Claro" : "Escuro"}</span>
          </button>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
