import { Search, X } from "lucide-react";

interface PlayerSearchProps {
  value: string;
  onChange: (v: string) => void;
}

export function PlayerSearch({ value, onChange }: PlayerSearchProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Search className="w-4 h-4 text-primary" />
      </div>
      <label
        className="text-muted-foreground whitespace-nowrap"
        style={{ fontSize: "0.85rem" }}
      >
        Buscar jogador
      </label>
      <div className="flex-1 relative">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Buscar jogador..."
          className="w-full px-3 py-2 rounded-lg bg-input-background border border-border text-foreground focus:border-primary focus:ring-1 focus:ring-primary transition-colors pr-8"
          style={{ fontSize: "0.9rem" }}
        />
        {value && (
          <button
            onClick={() => onChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
