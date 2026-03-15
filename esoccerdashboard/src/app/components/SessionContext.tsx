import { createContext, useContext, useState } from "react";
import type { ResultRow } from "./ResultsTable";
import type { ColumnDef } from "./ColumnConfigModal";

export interface AnalysisRecord {
  id: number;
  name: string;
  type: "Dale" | "Over/Under";
  date: string;
  duplas: number;
}

export interface PageState {
  files: File[];
  results: ResultRow[];
  cacheKey: string;
  totalJogosBrutos: number;
  totalJogosAposDedup: number;
  hasAnalyzed: boolean;
  selectedFiles: string[];
  minMatches: number;
  minPercentage: number;
  dateFrom: string;
  dateTo: string;
  playerSearch: string;
  selectedTournaments: string[];
  columnConfig: ColumnDef[];
  selectedHorarios: string[];
  availableHorarios: string[];
  selectedLinhas: string[];
}

export const defaultPageState: PageState = {
  files: [],
  results: [],
  cacheKey: "",
  totalJogosBrutos: 0,
  totalJogosAposDedup: 0,
  hasAnalyzed: false,
  selectedFiles: [],
  minMatches: 10,
  minPercentage: 50,
  dateFrom: "",
  dateTo: "",
  playerSearch: "",
  selectedTournaments: [],
  columnConfig: [],
  selectedHorarios: [],
  availableHorarios: [],
  selectedLinhas: [],
};

interface SessionState {
  analyses: AnalysisRecord[];
  addAnalysis: (record: Omit<AnalysisRecord, "id">) => void;
  dale: PageState;
  setDale: (updater: (prev: PageState) => PageState) => void;
  overUnder: PageState;
  setOverUnder: (updater: (prev: PageState) => PageState) => void;
}

const SessionContext = createContext<SessionState>({
  analyses: [],
  addAnalysis: () => {},
  dale: defaultPageState,
  setDale: () => {},
  overUnder: defaultPageState,
  setOverUnder: () => {},
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [analyses, setAnalyses] = useState<AnalysisRecord[]>([]);
  const [dale, setDale] = useState<PageState>(defaultPageState);
  const [overUnder, setOverUnder] = useState<PageState>(defaultPageState);

  const addAnalysis = (record: Omit<AnalysisRecord, "id">) => {
    setAnalyses((prev) => {
      const filtered = prev.filter((a) => !(a.name === record.name && a.type === record.type));
      return [{ ...record, id: Date.now() }, ...filtered];
    });
  };

  return (
    <SessionContext.Provider value={{ analyses, addAnalysis, dale, setDale, overUnder, setOverUnder }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
