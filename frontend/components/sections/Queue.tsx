"use client";
import { ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { ago, type IncidentSummary } from "@/lib/api";
import { useApi, useStore } from "@/lib/store";
import { Empty, ErrorNote, Severity, StationHeader, StatusPill } from "../ui";

const FILTERS = [
  { key: "", label: "All" },
  { key: "open", label: "Open" },
  { key: "awaiting_approval", label: "Waiting for approval" },
  { key: "needs_human", label: "Handed to a human" },
  { key: "resolved", label: "Resolved" },
];

export function Queue() {
  const { select, selected } = useStore();
  const { data, error } = useApi<IncidentSummary[]>("/api/incidents", { poll: 8000 });
  const [filter, setFilter] = useState("");
  const [q, setQ] = useState("");

  const rows = useMemo(() => (data ?? []).filter((i) =>
    (!filter || i.status === filter) &&
    (!q || `${i.id} ${i.title} ${i.service}`.toLowerCase().includes(q.toLowerCase()))), [data, filter, q]);
  const count = (k: string) => (data ?? []).filter((i) => !k || i.status === k).length;

  function open(id: string) {
    select(id);
    requestAnimationFrame(() => document.getElementById("triage")?.scrollIntoView({ behavior: "smooth" }));
  }

  return (
    <>
      <StationHeader n={1} title="Incident queue">
        Sixty synthetic incidents across eight services. Pick one to send it down the triage line.
      </StationHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
            className={`rounded-full border px-3.5 py-1.5 text-[0.875rem] font-semibold transition-colors ${filter === f.key ? "border-ink bg-ink text-white" : "border-rule bg-paper hover:border-ink"}`}>
            {f.label} <span className="ml-1 opacity-60">{count(f.key)}</span>
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search id, title or service"
          className="ml-auto w-full rounded-lg border border-rule bg-paper px-3 py-2 text-[0.9375rem] outline-none focus:border-enamel sm:w-72" />
      </div>

      {error && <ErrorNote text={error} />}
      {data && rows.length === 0 && <Empty title="No incidents match">Clear the filter or search to see the full queue.</Empty>}

      {rows.length > 0 && (
        <div className="scroll-thin max-h-[62vh] overflow-auto rounded-2xl border border-rule bg-paper">
          <table className="w-full min-w-[760px] text-left text-[0.9375rem]">
            <thead className="sticky top-0 z-10 bg-paper text-[0.8125rem] text-mute">
              <tr className="border-b border-rule">
                <th className="px-4 py-3 font-semibold">Incident</th>
                <th className="px-3 py-3 font-semibold">Service</th>
                <th className="px-3 py-3 font-semibold">Severity</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Detected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} onClick={() => open(i.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && open(i.id)}
                  className={`cursor-pointer border-b border-rule/70 transition-colors last:border-0 hover:bg-enamel-soft/40 ${selected === i.id ? "bg-enamel-soft/70" : ""}`}>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[0.8125rem] text-mute">{i.id}</span>
                    <span className="ml-2 font-semibold">{i.title}</span>
                    {i.adversarial && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[0.8125rem] font-semibold text-danger-ink" title="Logs contain a prompt-injection attempt">
                        <ShieldAlert size={14} /> injection test
                      </span>
                    )}
                    <span className="ml-2 text-[0.8125rem] text-mute">{i.difficulty}</span>
                  </td>
                  <td className="px-3 py-3 font-mono text-[0.8125rem]">{i.service}</td>
                  <td className="px-3 py-3"><Severity sev={i.severity} /></td>
                  <td className="px-3 py-3"><StatusPill status={i.status} /></td>
                  <td className="px-3 py-3 text-mute">{ago(i.detected_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
