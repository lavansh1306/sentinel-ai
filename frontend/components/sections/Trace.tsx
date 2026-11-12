"use client";
import { ShieldCheck, ShieldX } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi, useStore } from "@/lib/store";
import { Button, Empty, ErrorNote, Lamp, StationHeader, type Tone } from "../ui";

interface AuditRow {
  id: number; ts: string; actor: string; event: string; incident_id: string | null; action_id: number | null;
  payload: Record<string, any>; prev_hash: string; hash: string;
}

function toneFor(e: string): Tone {
  if (/blocked|failed|denied|duplicate|rejected|killswitch\.on|aborted/.test(e)) return "danger";
  if (/rollback|approval_recorded|reset/.test(e)) return "caution";
  if (/succeeded|resolved|approved|completed/.test(e)) return "clear";
  if (/proposed|started/.test(e)) return "enamel";
  return "idle";
}

export function Trace() {
  const { selected } = useStore();
  const [mine, setMine] = useState(false);
  const path = `/api/audit?limit=150${mine && selected ? `&incident_id=${selected}` : ""}`;
  const { data, error } = useApi<AuditRow[]>(path, { poll: 6000 });
  const [check, setCheck] = useState<{ ok: boolean; checked: number; broken_at?: number; reason?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  async function verify() {
    setBusy(true);
    try { setCheck(await api("/api/audit/verify")); } finally { setBusy(false); }
  }

  return (
    <>
      <StationHeader n={5} title="Trace log">
        Every proposal, vote, block and change is appended here. Each entry carries the hash of the one before it, so editing
        or deleting any row breaks the chain.
      </StationHeader>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={verify} busy={busy}>Verify chain</Button>
        {selected && (
          <label className="flex cursor-pointer items-center gap-2 text-[0.9375rem]">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="accent-[#2445a8]" />
            Only {selected}
          </label>
        )}
        {check && (
          <span className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[0.9375rem] font-semibold ${check.ok ? "bg-clear-soft text-clear-ink" : "bg-danger-soft text-danger-ink"}`}>
            {check.ok ? <ShieldCheck size={18} /> : <ShieldX size={18} />}
            {check.ok ? `Chain intact: ${check.checked} events verified` : `Chain broken at event #${check.broken_at} (${check.reason})`}
          </span>
        )}
      </div>

      {error && <ErrorNote text={error} />}
      {data && data.length === 0 && <Empty title="Nothing logged yet" />}
      {data && data.length > 0 && (
        <ol className="scroll-thin max-h-[62vh] overflow-auto rounded-2xl border border-rule bg-paper">
          {data.map((r) => (
            <li key={r.id} className="border-b border-rule/70 last:border-0">
              <button onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}
                className="grid w-full grid-cols-[auto_1fr] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 text-left hover:bg-sheet sm:grid-cols-[3.5rem_auto_1fr_auto_auto]">
                <span className="hidden font-mono text-[0.8125rem] text-mute sm:block">#{r.id}</span>
                <Lamp tone={toneFor(r.event)} size={9} />
                <span className="min-w-0 truncate"><span className="font-mono text-[0.875rem] font-semibold">{r.event}</span>
                  <span className="text-[0.875rem] text-mute"> by {r.actor}{r.incident_id ? `, ${r.incident_id}` : ""}{r.action_id ? `, action ${r.action_id}` : ""}</span></span>
                <span className="col-start-2 font-mono text-[0.75rem] text-mute sm:col-start-auto">{r.hash.slice(0, 10)} ← {r.prev_hash.slice(0, 6)}</span>
                <span className="col-start-2 text-[0.8125rem] text-mute sm:col-start-auto">{new Date(r.ts).toLocaleTimeString()}</span>
              </button>
              {open === r.id && (
                <pre className="mx-4 mb-3 overflow-auto rounded-lg bg-board p-3 font-mono text-[0.75rem] text-board-text">
                  {JSON.stringify(r.payload, null, 2)}{"\n\n"}hash      {r.hash}{"\n"}prev_hash {r.prev_hash}
                </pre>
              )}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
