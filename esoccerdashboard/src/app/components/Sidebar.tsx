import { NavLink } from "react-router";
import { Home, Zap, TrendingUp, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTheme } from "./ThemeContext";

const navItems = [
  { to: "/", icon: Home, label: "Inicio" },
  { to: "/dale", icon: Zap, label: "Dale" },
  { to: "/over-under", icon: TrendingUp, label: "Over/Under" },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const getActiveStyle = (): React.CSSProperties =>
    isDark
      ? {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgba(234, 88, 12, 0.1)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: "1px solid rgba(234, 88, 12, 0.2)",
        boxShadow: "inset 0 0 6px rgba(234, 88, 12, 0.08)",
        color: "#ea580c",
        textDecoration: "none",
        transition: "all 0.2s",
      }
      : {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        borderRadius: 10,
        background: "#171717",
        border: "1px solid transparent",
        color: "#ffffff",
        textDecoration: "none",
        transition: "all 0.2s",
      };

  const getInactiveStyle = (): React.CSSProperties =>
    isDark
      ? {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        borderRadius: 10,
        background: "transparent",
        border: "1px solid transparent",
        color: "#a1a1a1",
        textDecoration: "none",
        transition: "all 0.2s",
      }
      : {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        borderRadius: 10,
        background: "transparent",
        border: "1px solid transparent",
        color: "#525252",
        textDecoration: "none",
        transition: "all 0.2s",
      };

  return (
    <aside
      className={`h-full flex flex-col transition-all duration-300 ${collapsed ? "w-[72px]" : "w-[260px]"
        }`}
      style={{
        background: isDark ? "rgba(5, 5, 5, 0.85)" : "#d9d9d9",
        borderRight: isDark ? "1px solid rgba(255, 255, 255, 0.05)" : "1px solid #c9c9c9",
        backdropFilter: isDark ? "blur(20px) saturate(160%)" : "none",
        WebkitBackdropFilter: isDark ? "blur(20px) saturate(160%)" : "none",
        boxShadow: isDark
          ? "4px 0 24px rgba(0, 0, 0, 0.5)"
          : "2px 0 12px rgba(0, 0, 0, 0.06)",
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-3 px-5 h-16 shrink-0"
        style={{
          borderBottom: isDark ? "1px solid rgba(255, 255, 255, 0.05)" : "1px solid #c9c9c9",
        }}
      >
        {/* Design System three-bar logo mark */}
        <div className="flex gap-[5px] shrink-0 cursor-pointer group">
          <div
            className="w-[9px] rounded-full transition-all duration-300"
            style={{
              height: 28,
              background: isDark ? "#ea580c" : "#0a0a0a",
            }}
          />
          <div
            className="w-[9px] rounded-full transition-all duration-300 group-hover:h-[16px]"
            style={{
              height: 28,
              background: isDark ? "#ea580c" : "#0a0a0a",
            }}
          />
          <div
            className="w-[9px] rounded-full transition-all duration-300"
            style={{
              height: 28,
              background: isDark ? "#ea580c" : "#0a0a0a",
            }}
          />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <span
              className="block whitespace-nowrap font-semibold text-sm tracking-tight"
              style={{
                color: isDark ? "#ffffff" : "#0a0a0a",
                letterSpacing: "-0.02em",
              }}
            >
              E-Soccer
            </span>
            <span
              className="block whitespace-nowrap text-xs font-medium uppercase tracking-widest"
              style={{ color: isDark ? "#a1a1a1" : "#737373" }}
            >
              Analytics
            </span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 flex flex-col gap-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            style={({ isActive }) =>
              isActive ? getActiveStyle() : getInactiveStyle()
            }
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLAnchorElement;
              if (!el.getAttribute("aria-current")) {
                if (isDark) {
                  el.style.background = "rgba(234, 88, 12, 0.05)";
                  el.style.borderColor = "rgba(234, 88, 12, 0.1)";
                  el.style.color = "#ffffff";
                } else {
                  el.style.background = "rgba(0,0,0,0.07)";
                  el.style.borderColor = "transparent";
                  el.style.color = "#0a0a0a";
                }
              }
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLAnchorElement;
              if (!el.getAttribute("aria-current")) {
                el.style.background = "transparent";
                el.style.borderColor = "transparent";
                el.style.color = isDark ? "#a1a1a1" : "#525252";
              }
            }}
          >
            {({ isActive }) => (
              <>
                <item.icon
                  className="w-5 h-5 shrink-0"
                  style={{
                    color: isActive
                      ? isDark
                        ? "#ea580c"
                        : "#ffffff"
                      : "inherit",
                  }}
                />
                {!collapsed && (
                  <span
                    className="whitespace-nowrap text-sm font-medium"
                    style={{ letterSpacing: "-0.01em" }}
                  >
                    {item.label}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Collapse Toggle */}
      <div className="px-3 pb-4">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-sm font-medium transition-all duration-200"
          style={{
            background: "transparent",
            border: isDark ? "1px solid rgba(255, 255, 255, 0.05)" : "1px solid #c9c9c9",
            color: isDark ? "#737373" : "#737373",
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
            el.style.borderColor = isDark ? "rgba(255,255,255,0.05)" : "#c9c9c9";
            el.style.color = "#737373";
          }}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4" />
              <span>Recolher</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
