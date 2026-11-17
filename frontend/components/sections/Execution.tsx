"use client";
import type { ActionItem } from "@/lib/api";
import { stamp } from "@/lib/api";
import { useApi } from "@/lib/store";
import { Empty, ErrorNote, Lamp, StationHeader } from "../ui";
import { ExecutionView } from "./StageDetail";

export function Execution() {
  const { data, error } = useApi<ActionItem[]>("/api/actions", { poll: 5000 });
  const runs = (data ?? []).filter((a) => ["executing", "succeeded", "rolled_back"].includes(a.status));
  const ok = runs.filter((a) => a.status === "succeeded").length;
  const back = runs.filter((a) => a.status === "rolled_back").length;

  return (
    <>
      <StationHeader n={4} title="Execution and rollback">
        Changes run against a simulated environment: snapshot first, apply, run health checks, keep or roll back automatically.
      </StationHeader>
      {error && <ErrorNote text={error} />}
      {runs.length > 0 && (
        <p className="mb-5 flex flex-wrap gap-5 text-[0.9375rem]">
          <span className="flex items-center gap-2"><Lamp tone="clear" />{ok} resolved the incident</span>
          <span className="flex items-center gap-2"><Lamp tone="caution" />{back} failed checks and were rolled back</span>
        </p>
      )}
      {data && runs.length === 0 && (
        <Empty title="No change has run yet">Approve a fix at the gate, then press Execute change. Its steps, health checks and any rollback show up here.</Empty>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {runs.slice(0, 10).map((a) => (
          <article key={a.id} className={`rounded-2xl border bg-sheet p-5 ${a.status === "rolled_back" ? "border-caution/60" : "border-rule"}`}>
            <p className="mb-2 text-[0.8125rem] text-mute">{a.incident_id}, {stamp(a.executed_at)}</p>
            <ExecutionView a={a} />
          </article>
        ))}
      </div>
    </>
  );
}
