import { Timer } from "lucide-react";

const GAME_TYPE_RULES: Record<string, { label: string; match: (f: string[]) => boolean }> = {
  "8min": {
    label: "8 min (365 / Super)",
    match: (f) => f.some((x) => x === "365" || x === "Super"),
  },
  "10-12min": {
    label: "10-12 min (Betano)",
    match: (f) => f.some((x) => x === "Betano"),
  },
};

export function getGameType(fontes: string[]): string {
  for (const [type, rule] of Object.entries(GAME_TYPE_RULES)) {
    if (rule.match(fontes)) return type;
  }
  return "unknown";
}

interface GameTypeFilterProps {
  selectedGameType: string;
  onChange: (v: string) => void;
}

export function GameTypeFilter({ selectedGameType, onChange }: GameTypeFilterProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Timer className="w-4 h-4 text-primary" />
      </div>
      <label className="text-muted-foreground whitespace-nowrap" style={{ fontSize: "0.85rem" }}>
        Tipo de jogo
      </label>
      <select
        value={selectedGameType}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 px-3 py-2 rounded-lg bg-input-background border border-border text-foreground focus:border-primary focus:ring-1 focus:ring-primary transition-colors cursor-pointer"
        style={{ fontSize: "0.9rem" }}
      >
        <option value="all">Todos</option>
        {Object.entries(GAME_TYPE_RULES).map(([key, rule]) => (
          <option key={key} value={key}>{rule.label}</option>
        ))}
      </select>
    </div>
  );
}
