import { useMemo, useState, useRef, useEffect } from "react";
import { Search, Filter, MapPin, ChevronDown, X, GitBranch, Clock } from "lucide-react";
import type { ResultRow } from "./ResultsTable";
import { useTheme } from "./ThemeContext";

interface FilterBarProps {
  results: ResultRow[];
  playerSearch: string;
  onPlayerSearchChange: (v: string) => void;
  selectedBets: string[];
  onSelectedBetsChange: (v: string[]) => void;
  selectedTournaments: string[];
  onSelectedTournamentsChange: (v: string[]) => void;
  minMatches: number;
  onMinMatchesChange: (v: number) => void;
  minPercentage: number;
  onMinPercentageChange: (v: number) => void;
  // Optional Linha filter (only for Over/Under)
  selectedLinhas?: string[];
  onSelectedLinhasChange?: (v: string[]) => void;
  // Optional Horário Jogo filter (only for Over/Under)
  availableHorarios?: string[];
  selectedHorarios?: string[];
  onSelectedHorariosChange?: (v: string[]) => void;
}

export function FilterBar({
  results,
  playerSearch,
  onPlayerSearchChange,
  selectedBets,
  onSelectedBetsChange,
  selectedTournaments,
  onSelectedTournamentsChange,
  minMatches,
  onMinMatchesChange,
  minPercentage,
  onMinPercentageChange,
  selectedLinhas,
  onSelectedLinhasChange,
  availableHorarios,
  selectedHorarios,
  onSelectedHorariosChange,
}: FilterBarProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [tournamentOpen, setTournamentOpen] = useState(false);
  const [betOpen, setBetOpen] = useState(false);
  const [linhaOpen, setLinhaOpen] = useState(false);
  const [horarioOpen, setHorarioOpen] = useState(false);
  const tournamentRef = useRef<HTMLDivElement>(null);
  const betRef = useRef<HTMLDivElement>(null);
  const linhaRef = useRef<HTMLDivElement>(null);
  const horarioRef = useRef<HTMLDivElement>(null);

  const sliderFillColor = isDark ? "#ea580c" : "#171717";
  const sliderEmptyColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.1)";

  const allBets = useMemo(() => {
    const set = new Set<string>();
    for (const r of results) {
      if (r.fontes) for (const f of r.fontes) set.add(f);
    }
    return Array.from(set).sort();
  }, [results]);

  const allLeagues = useMemo(() => {
    const set = new Set<string>();
    for (const r of results) {
      if (r.ligas) {
        r.ligas.split(" / ").forEach((l) => {
          const trimmed = l.trim();
          if (trimmed) set.add(trimmed);
        });
      }
    }
    return Array.from(set).sort();
  }, [results]);

  const allLinhas = useMemo(() => {
    const set = new Set<string>();
    for (const r of results) {
      if (r.linha) set.add(r.linha);
    }
    return Array.from(set).sort();
  }, [results]);

  const hasLinhaFilter = selectedLinhas !== undefined && onSelectedLinhasChange !== undefined && allLinhas.length > 0;
  const hasHorarioFilter = availableHorarios !== undefined && availableHorarios.length > 0 && selectedHorarios !== undefined && onSelectedHorariosChange !== undefined;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tournamentRef.current && !tournamentRef.current.contains(e.target as Node)) setTournamentOpen(false);
      if (betRef.current && !betRef.current.contains(e.target as Node)) setBetOpen(false);
      if (linhaRef.current && !linhaRef.current.contains(e.target as Node)) setLinhaOpen(false);
      if (horarioRef.current && !horarioRef.current.contains(e.target as Node)) setHorarioOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggleBet = (bet: string) => {
    if (selectedBets.includes(bet)) {
      onSelectedBetsChange(selectedBets.filter((b) => b !== bet));
    } else {
      onSelectedBetsChange([...selectedBets, bet]);
    }
  };

  const toggleTournament = (league: string) => {
    if (selectedTournaments.includes(league)) {
      onSelectedTournamentsChange(selectedTournaments.filter((t) => t !== league));
    } else {
      onSelectedTournamentsChange([...selectedTournaments, league]);
    }
  };

  const toggleLinha = (linha: string) => {
    if (!selectedLinhas || !onSelectedLinhasChange) return;
    if (selectedLinhas.includes(linha)) {
      onSelectedLinhasChange(selectedLinhas.filter((l) => l !== linha));
    } else {
      onSelectedLinhasChange([...selectedLinhas, linha]);
    }
  };

  const toggleHorario = (h: string) => {
    if (!selectedHorarios || !onSelectedHorariosChange) return;
    if (selectedHorarios.includes(h)) {
      onSelectedHorariosChange(selectedHorarios.filter((x) => x !== h));
    } else {
      onSelectedHorariosChange([...selectedHorarios, h]);
    }
  };

  // Dark-mode aware styling
  const inputBg = isDark ? "rgba(255,255,255,0.06)" : "#ffffff";
  const inputBorder = isDark ? "rgba(255,255,255,0.12)" : "#d4d4d4";
  const inputColor = isDark ? "#e5e5e5" : "#171717";
  const labelColor = isDark ? "#a1a1a1" : "#737373";
  const hoverBg = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";

  const inputStyle: React.CSSProperties = {
    fontSize: "0.85rem",
    background: inputBg,
    border: `1px solid ${inputBorder}`,
    color: inputColor,
    borderRadius: 8,
    padding: "6px 10px",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "0.8rem",
    color: labelColor,
    whiteSpace: "nowrap",
  };

  const dropdownStyle: React.CSSProperties = {
    position: "absolute",
    zIndex: 50,
    marginTop: 4,
    width: "100%",
    maxHeight: 240,
    overflowY: "auto",
    borderRadius: 8,
    border: `1px solid ${inputBorder}`,
    background: isDark ? "#1a1a1a" : "#ffffff",
    boxShadow: isDark ? "0 8px 24px rgba(0,0,0,0.6)" : "0 4px 16px rgba(0,0,0,0.12)",
  };

  const gridCols = hasLinhaFilter ? "1fr 1fr 1fr 1fr" : "1fr 1fr 1fr";

  // Row 2 columns: Min.Part + (Horário Jogo if available) + Green%
  const row2GreenSpan = hasLinhaFilter
    ? (hasHorarioFilter ? 2 : 3)
    : (hasHorarioFilter ? 1 : 2);

  return (
    <div className="rounded-xl border border-border bg-card p-4" style={{ overflow: "visible", position: "relative", zIndex: 20 }}>
      <div className="grid gap-x-4 gap-y-3" style={{ gridTemplateColumns: gridCols, overflow: "visible" }}>

        {/* Row 1, Col 1: Player Search */}
        <div className="flex items-center gap-2">
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: "#ea580c" }} />
          <div className="flex-1 relative">
            <input
              type="text"
              value={playerSearch}
              onChange={(e) => onPlayerSearchChange(e.target.value)}
              placeholder="Buscar jogador..."
              style={{ ...inputStyle, width: "100%", paddingRight: 28 }}
            />
            {playerSearch && (
              <button onClick={() => onPlayerSearchChange("")} className="absolute right-2 top-1/2 -translate-y-1/2 transition-colors" style={{ color: labelColor }}>
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Row 1, Col 2: Bet */}
        <CheckboxDropdown
          icon={<Filter className="w-3.5 h-3.5 shrink-0" style={{ color: "#ea580c" }} />}
          label="Bet"
          labelStyle={labelStyle}
          inputStyle={inputStyle}
          dropdownStyle={dropdownStyle}
          hoverBg={hoverBg}
          inputColor={inputColor}
          labelColor={labelColor}
          isOpen={betOpen}
          setIsOpen={setBetOpen}
          containerRef={betRef}
          items={allBets}
          selected={selectedBets}
          onToggle={toggleBet}
          onClear={() => onSelectedBetsChange([])}
          emptyLabel="Todas"
        />

        {/* Row 1, Col 3: Tournament */}
        <CheckboxDropdown
          icon={<MapPin className="w-3.5 h-3.5 shrink-0" style={{ color: "#ea580c" }} />}
          label="Torneio"
          labelStyle={labelStyle}
          inputStyle={inputStyle}
          dropdownStyle={dropdownStyle}
          hoverBg={hoverBg}
          inputColor={inputColor}
          labelColor={labelColor}
          isOpen={tournamentOpen}
          setIsOpen={setTournamentOpen}
          containerRef={tournamentRef}
          items={allLeagues}
          selected={selectedTournaments}
          onToggle={toggleTournament}
          onClear={() => onSelectedTournamentsChange([])}
          emptyLabel="Todos"
        />

        {/* Row 1, Col 4 (only Over/Under): Linha */}
        {hasLinhaFilter && (
          <CheckboxDropdown
            icon={<GitBranch className="w-3.5 h-3.5 shrink-0" style={{ color: "#ea580c" }} />}
            label="Linha"
            labelStyle={labelStyle}
            inputStyle={inputStyle}
            dropdownStyle={dropdownStyle}
            hoverBg={hoverBg}
            inputColor={inputColor}
            labelColor={labelColor}
            isOpen={linhaOpen}
            setIsOpen={setLinhaOpen}
            containerRef={linhaRef}
            items={allLinhas}
            selected={selectedLinhas!}
            onToggle={toggleLinha}
            onClear={() => onSelectedLinhasChange!([])}
            emptyLabel="Todas"
          />
        )}

        {/* Row 2, Col 1: Min Matches */}
        <div className="flex items-center gap-2">
          <span style={labelStyle}>Min.Part</span>
          <input
            type="number"
            min={1}
            max={100}
            value={minMatches}
            onChange={(e) => onMinMatchesChange(Number(e.target.value))}
            style={{ ...inputStyle, width: 80 }}
          />
        </div>

        {/* Row 2, Col 2 (only Over/Under with horarios): Horário Jogo */}
        {hasHorarioFilter && (
          <CheckboxDropdown
            icon={<Clock className="w-3.5 h-3.5 shrink-0" style={{ color: "#ea580c" }} />}
            label="Hr.Jogo"
            labelStyle={labelStyle}
            inputStyle={inputStyle}
            dropdownStyle={dropdownStyle}
            hoverBg={hoverBg}
            inputColor={inputColor}
            labelColor={labelColor}
            isOpen={horarioOpen}
            setIsOpen={setHorarioOpen}
            containerRef={horarioRef}
            items={availableHorarios!}
            selected={selectedHorarios!}
            onToggle={toggleHorario}
            onClear={() => onSelectedHorariosChange!([])}
            emptyLabel="Todos"
          />
        )}

        {/* Row 2, remaining: Green % */}
        <div className="flex flex-col gap-1" style={{ gridColumn: `span ${row2GreenSpan}` }}>
          <span style={{ fontSize: "0.8rem", color: labelColor }}>
            Porcentagem Green mínima: <span style={{ color: "#ea580c", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{minPercentage}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={minPercentage}
            onChange={(e) => onMinPercentageChange(Number(e.target.value))}
            className="w-full h-2 rounded-full appearance-none cursor-pointer"
            style={{ background: `linear-gradient(to right, ${sliderFillColor} ${minPercentage}%, ${sliderEmptyColor} ${minPercentage}%)` }}
          />
        </div>
      </div>
    </div>
  );
}

/* ── Reusable dropdown components ─────────────────────────────── */

function CheckboxDropdown({ icon, label, labelStyle, inputStyle, dropdownStyle, hoverBg, inputColor, labelColor, isOpen, setIsOpen, containerRef, items, selected, onToggle, onClear, emptyLabel }: {
  icon: React.ReactNode;
  label: string;
  labelStyle: React.CSSProperties;
  inputStyle: React.CSSProperties;
  dropdownStyle: React.CSSProperties;
  hoverBg: string;
  inputColor: string;
  labelColor: string;
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  items: string[];
  selected: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
  emptyLabel: string;
}) {
  return (
    <div className="flex items-center gap-2" style={{ position: "relative", overflow: "visible" }} ref={containerRef}>
      {icon}
      <span style={labelStyle}>{label}</span>
      <div style={{ flex: 1, position: "relative" }}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{ ...inputStyle, width: "100%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {selected.length === 0 ? emptyLabel : `${selected.length} selecionado${selected.length > 1 ? "s" : ""}`}
          </span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: labelColor }} />
        </button>
        {selected.length > 0 && (
          <button onClick={(e) => { e.stopPropagation(); onClear(); }} className="absolute top-1/2 -translate-y-1/2 transition-colors" style={{ right: 28, color: labelColor }}>
            <X className="w-3 h-3" />
          </button>
        )}
        {isOpen && items.length > 0 && (
          <div style={dropdownStyle}>
            {items.map((item) => (
              <label
                key={item}
                className="flex items-center gap-2 cursor-pointer"
                style={{ padding: "6px 12px", fontSize: "0.8rem", color: inputColor }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = hoverBg; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <input type="checkbox" checked={selected.includes(item)} onChange={() => onToggle(item)} style={{ accentColor: "#ea580c" }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MultiSelectDropdown({ icon, label, labelStyle, inputStyle, dropdownStyle, isOpen, setIsOpen, containerRef, displayValue, showClear, onClear, labelColor, children }: {
  icon: React.ReactNode;
  label: string;
  labelStyle: React.CSSProperties;
  inputStyle: React.CSSProperties;
  dropdownStyle: React.CSSProperties;
  hoverBg: string;
  inputColor: string;
  labelColor: string;
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  mode: "single";
  displayValue: string;
  showClear: boolean;
  onClear: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2" style={{ position: "relative", overflow: "visible" }} ref={containerRef}>
      {icon}
      <span style={labelStyle}>{label}</span>
      <div style={{ flex: 1, position: "relative" }}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{ ...inputStyle, width: "100%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayValue}</span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: labelColor }} />
        </button>
        {showClear && (
          <button onClick={(e) => { e.stopPropagation(); onClear(); }} className="absolute top-1/2 -translate-y-1/2 transition-colors" style={{ right: 28, color: labelColor }}>
            <X className="w-3 h-3" />
          </button>
        )}
        {isOpen && <div style={dropdownStyle}>{children}</div>}
      </div>
    </div>
  );
}

function DropdownItem({ label, selected, hoverBg, color, onClick }: {
  label: string; selected: boolean; hoverBg: string; color: string; onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="cursor-pointer"
      style={{ padding: "6px 12px", fontSize: "0.8rem", color, background: selected ? hoverBg : "transparent", fontWeight: selected ? 600 : 400 }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = hoverBg; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = selected ? hoverBg : "transparent"; }}
    >
      {label}
    </div>
  );
}
