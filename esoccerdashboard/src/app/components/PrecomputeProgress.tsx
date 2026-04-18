import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { fetchJobsStatus, type JobStatus } from "../services/api";

interface PrecomputeProgressProps {
  jobIds: string[];
  primaryJobId: string;
  onPrimaryDone: (primaryJob: JobStatus) => void;
  pollInterval?: number;
}

export function PrecomputeProgress({
  jobIds,
  primaryJobId,
  onPrimaryDone,
  pollInterval = 3000,
}: PrecomputeProgressProps) {
  const [primaryStatus, setPrimaryStatus] = useState<string>("running");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const onPrimaryDoneRef = useRef(onPrimaryDone);
  onPrimaryDoneRef.current = onPrimaryDone;
  const doneCalledRef = useRef(false);
  const startTimeRef = useRef(Date.now());

  const poll = useCallback(async () => {
    if (jobIds.length === 0) return;
    try {
      const result = await fetchJobsStatus(jobIds);
      const primary = result.jobs.find((j) => j.job_id === primaryJobId);
      if (primary) {
        setPrimaryStatus(primary.status);
        if (!doneCalledRef.current && (primary.status === "completed" || primary.status === "failed")) {
          doneCalledRef.current = true;
          onPrimaryDoneRef.current(primary);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao buscar status");
    }
  }, [jobIds, primaryJobId]);

  useEffect(() => {
    if (jobIds.length === 0) return;
    doneCalledRef.current = false;
    setError(null);
    setPrimaryStatus("running");
    startTimeRef.current = Date.now();

    poll();
    const pollTimer = setInterval(() => {
      if (!doneCalledRef.current) poll();
    }, pollInterval);

    const clockTimer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    return () => { clearInterval(pollTimer); clearInterval(clockTimer); };
  }, [jobIds, pollInterval, poll]);

  if (jobIds.length === 0) return null;

  const done = primaryStatus === "completed";
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  const timeStr = min > 0 ? `${min}m ${sec}s` : `${sec}s`;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        {done ? (
          <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
        ) : (
          <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
        )}
        <div className="flex-1 flex items-center justify-between">
          <span className="text-foreground" style={{ fontSize: "0.9rem" }}>
            {done
              ? "Analise concluida"
              : "Processando analise..."}
          </span>
          <span className="text-muted-foreground tabular-nums" style={{ fontSize: "0.8rem" }}>
            {timeStr}
          </span>
        </div>
      </div>
      {!done && (
        <p className="mt-2 text-muted-foreground" style={{ fontSize: "0.8rem" }}>
          Calculando metricas para todas as duplas. Proximas analises serao instantaneas (cache).
        </p>
      )}
      {error && (
        <div className="flex items-center gap-2 text-red-400 mt-2" style={{ fontSize: "0.8rem" }}>
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
