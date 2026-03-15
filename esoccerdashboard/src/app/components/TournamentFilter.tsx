import { useMemo, useState, useRef, useEffect } from "react";
import { MapPin, ChevronDown, X } from "lucide-react";
import type { ResultRow } from "./ResultsTable";

interface TournamentFilterProps {
  results: ResultRow[];
  selectedTournaments: string[];
  onChange: (v: string[]) => void;
}

export function TournamentFilter({ results, selectedTournaments, onChange }: TournamentFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (allLeagues.length === 0) return null;

  const toggle = (league: string) => {
    if (selectedTournaments.includes(league)) {
      onChange(selectedTournaments.filter((t) => t !== league));
    } else {
      onChange([...selectedTournaments, league]);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <MapPin className="w-4 h-4 text-primary" />
      </div>
      <label className="text-muted-foreground whitespace-nowrap" style={{ fontSize: "0.85rem" }}>
        Torneio
      </label>
      <div className="flex-1 relative" ref={ref}>
        <button
          onClick={() => setOpen(!open)}
          className="w-full px-3 py-2 rounded-lg bg-input-background border border-border text-foreground focus:border-primary focus:ring-1 focus:ring-primary transition-colors cursor-pointer flex items-center justify-between"
          style={{ fontSize: "0.9rem" }}
        >
          <span className="truncate">
            {selectedTournaments.length === 0
              ? "Todos os torneios"
              : `${selectedTournaments.length} selecionado${selectedTournaments.length > 1 ? "s" : ""}`}
          </span>
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>
        {selectedTournaments.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onChange([]); }}
            className="absolute right-8 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        {open && (
          <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
            {allLeagues.map((league) => (
              <label
                key={league}
                className="flex items-center gap-2 px-3 py-2 hover:bg-secondary/30 cursor-pointer transition-colors"
                style={{ fontSize: "0.85rem" }}
              >
                <input
                  type="checkbox"
                  checked={selectedTournaments.includes(league)}
                  onChange={() => toggle(league)}
                  className="rounded border-border"
                />
                <span className="text-foreground truncate">{league}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
