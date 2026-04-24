import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createFlag,
  deleteFlag,
  fetchFlags,
  refreshFlagSnapshot,
  type Flag,
} from "../services/api";

// dupla_normalizada + strategy identifica unicamente um flag.
function flagKey(dupla: string, strategy: string): string {
  return `${dupla.toLowerCase()}::${strategy}`;
}

interface FlagsContextValue {
  flags: Flag[];
  loading: boolean;
  error: string | null;
  isFlagged: (dupla: string, strategy: string) => Flag | null;
  isStale: (dupla: string, strategy: string, currentCacheKey: string | undefined) => boolean;
  toggle: (
    dupla: string,
    strategy: string,
    snapshot: Record<string, unknown>,
    cacheKey?: string,
  ) => Promise<{ added?: number; removed?: boolean }>;
  refreshSnapshot: (
    dupla: string,
    strategy: string,
    snapshot: Record<string, unknown>,
    cacheKey?: string,
  ) => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<FlagsContextValue | null>(null);

export function FlagsProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFlags();
      setFlags(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar flags");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const byKey = useMemo(() => {
    const m = new Map<string, Flag>();
    for (const f of flags) m.set(flagKey(f.dupla_display, f.strategy), f);
    return m;
  }, [flags]);

  const isFlagged = useCallback(
    (dupla: string, strategy: string): Flag | null => {
      // normaliza o nome exibido da dupla — base names lowercase, sem parens
      // fazer lookup "inteligente": o backend guarda como "p1 vs p2" (bases lowercase sorted).
      // aqui vamos checar tanto a dupla crua quanto a versao limpa:
      const direct = byKey.get(flagKey(dupla, strategy));
      if (direct) return direct;
      // derive base pair do nome da tabela e tenta match
      const cleaned = cleanDuplaForMatch(dupla);
      if (cleaned && byKey.has(flagKey(cleaned, strategy))) {
        return byKey.get(flagKey(cleaned, strategy))!;
      }
      return null;
    },
    [byKey],
  );

  const isStale = useCallback(
    (dupla: string, strategy: string, currentCacheKey: string | undefined): boolean => {
      const f = isFlagged(dupla, strategy);
      if (!f || !currentCacheKey) return false;
      return f.snapshot_cache_key != null && f.snapshot_cache_key !== currentCacheKey;
    },
    [isFlagged],
  );

  const toggle = useCallback(
    async (
      dupla: string,
      strategy: string,
      snapshot: Record<string, unknown>,
      cacheKey?: string,
    ): Promise<{ added?: number; removed?: boolean }> => {
      const existing = isFlagged(dupla, strategy);
      if (existing) {
        await deleteFlag(existing.id);
        setFlags((prev) => prev.filter((f) => f.id !== existing.id));
        return { removed: true };
      }
      const created = await createFlag(dupla, strategy, snapshot, cacheKey);
      setFlags((prev) => [
        {
          id: created.id,
          p1: created.p1,
          p2: created.p2,
          dupla_display: created.dupla_display,
          strategy: created.strategy,
          flagged_at: created.flagged_at,
          snapshot_cache_key: created.snapshot_cache_key,
          snapshot,
        },
        ...prev,
      ]);
      return { added: created.games_added };
    },
    [isFlagged],
  );

  const refreshSnapshot = useCallback(
    async (
      dupla: string,
      strategy: string,
      snapshot: Record<string, unknown>,
      cacheKey?: string,
    ) => {
      const existing = isFlagged(dupla, strategy);
      if (!existing) return;
      await refreshFlagSnapshot(existing.id, snapshot, cacheKey);
      setFlags((prev) =>
        prev.map((f) =>
          f.id === existing.id
            ? { ...f, snapshot, snapshot_cache_key: cacheKey ?? null }
            : f,
        ),
      );
    },
    [isFlagged],
  );

  return (
    <Ctx.Provider value={{ flags, loading, error, isFlagged, isStale, toggle, refreshSnapshot, reload }}>
      {children}
    </Ctx.Provider>
  );
}

export function useFlags(): FlagsContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFlags fora de FlagsProvider");
  return v;
}

// Extrai "p1 vs p2" base names (replica simplificada do backend normalizer).
function cleanDuplaForMatch(dupla: string): string | null {
  const parts = dupla.split(/\s+vs\s+/i);
  if (parts.length !== 2) return null;
  const stripParens = (s: string) => s.replace(/\([^)]*\)/g, "").trim().toLowerCase();
  const left = stripParens(parts[0]);
  const right = stripParens(parts[1]);
  if (!left || !right || left === right) return null;
  const [a, b] = [left, right].sort();
  return `${a} vs ${b}`;
}
