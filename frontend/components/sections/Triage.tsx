"use client";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Eye, EyeOff, Play, RotateCcw } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { api, stamp, streamTriage, type ActionItem, type IncidentDetail, type StageEvent } from "@/lib/api";
import { useApi, useStore } from "@/lib/store";
import { Button, Empty, ErrorNote, Lamp, Severity, Sparkline, StationHeader, StatusPill, type Tone } from "../ui";
import { StageDetail } from "./StageDetail";

const LINE = [
  { id: "ingest", label: "Ingest" },
  { id: "sanitize", label: "Sanitize" },
  { id: "signals", label: "Signals" },
  { id: "retrieve", label: "Runbooks" },
  { id: "reason", label: "Qwen" },
  { id: "rank", label: "Rank" },
  { id: "plan", label: "Plan" },
  { id: "policy", label: "Policy" },
  { id: "gate", label: "Human gate" },
  { id: "execute", label: "Execute" },
  { id: "verify", label: "Verify" },
  { id: "outcome", label: "Outcome" },
];

type StationState = { tone: Tone; pulse?: boolean; note?: string };

const EV_TONE: Record<string, StationState> = {
  running: { tone: "run", pulse: true }, done: { tone: "clear" }, warn: { tone: "caution" },
  degraded: { tone: "caution", note: "fallback" }, skipped: { tone: "idle", note: "off" },
  waiting: { tone: "caution", pulse: true }, failed: { tone: "danger" },
};

function postGate(fix: ActionItem | undefined, actions: ActionItem[]): Record<string, StationState & { ev?: StageEvent }> {
  const out: Record<string, StationState & { ev?: StageEvent }> = {};
  if (!fix) return out;
  const gate: StationState = fix.status === "pending_approval" ? { tone: "caution", pulse: true, note: `${fix.approvals.filter(a => a.decision === "approve").length}/${fix.required_approvals}` }
    : fix.status === "blocked" ? { tone: "danger", note: "blocked" }
    : fix.status === "rejected" ? { tone: "danger", note: "rejected" }
    : fix.status === "superseded" ? { tone: "idle" } : { tone: "clear", note: "approved" };
  out.gate = { ...gate, ev: { stage: "gate", title: "Human approval gate", status: "done", ms: null, data: { actions } } };
  const exe = fix.execution;
  if (fix.status === "executing") out.execute = { tone: "run", pulse: true };
  if (exe && (fix.status === "succeeded" || fix.status === "rolled_back")) {
    const failedMid = exe.outcome === "execution_failed" || exe.outcome === "executor_error";
    const ev = { stage: "execute", title: "Execution", status: "done", ms: null, data: { action: fix } } as StageEvent;
    out.execute = { tone: failedMid ? "danger" : "clear", ev };
    out.verify = failedMid ? { tone: "idle", ev } : { tone: fix.status === "succeeded" ? "clear" : "danger", ev };
    out.outcome = { tone: fix.status === "succeeded" ? "clear" : "caution", note: fix.status === "succeeded" ? "resolved" : "rolled back", ev };
  }
  return out;
}

export function Triage() {
  const { selected, can, toast, refresh, select } = useStore();
  const [reveal, setReveal] = useState(false);
  const { data: inc, error, reload } = useApi<IncidentDetail>(selected ? `/api/incidents/${selected}?reveal=${reveal}` : null, { poll: 6000 });
  const { data: catalog } = useApi<{ root_causes: Record<string, { label: string }> }>("/api/catalog");
  const [live, setLive] = useState<Record<string, StageEvent> | null>(null);
  const [running, setRunning] = useState(false);
  const [useLlm, setUseLlm] = useState(true);
  const [focus, setFocus] = useState<string>("rank");
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => { setLive(null); setFocus("rank"); }, [selected]);

  const runActions = useMemo(() => (inc?.actions ?? []).filter((a) => a.triage_run_id === inc?.latest_run?.id), [inc]);
  const fix = runActions.find((a) => a.action_type !== "collect_diagnostics");

  const stations = useMemo(() => {
    const st: Record<string, StationState & { ev?: StageEvent }> = {};
    const source: StageEvent[] = live ? Object.values(live) : inc?.latest_run?.trace ?? [];
    for (const ev of source) st[ev.stage] = { ...(EV_TONE[ev.status] ?? { tone: "idle" }), ev };
    if (!running && inc?.latest_run) Object.assign(st, postGate(fix, runActions));
    return st;
  }, [live, inc, running, fix, runActions]);

  const trainAt = [...LINE].reverse().find((s) => stations[s.id] && stations[s.id].tone !== "idle")?.id;

  async function run() {
    if (!inc) return;
    setRunning(true);
    setLive({});
    try {
      await streamTriage(inc.id, useLlm, (ev) => {
        if (ev.type === "stage") {
          setLive((l) => ({ ...(l ?? {}), [ev.stage]: ev }));
          if (ev.status !== "running") setFocus(ev.stage);
        } else if (ev.type === "error") {
          toast(ev.message, "error");
        } else if (ev.type === "complete") {
          setFocus("rank");
          toast(ev.status === "awaiting_approval" ? "Triage done. A fix is waiting at the approval gate." : "Triage done. No safe fix: handed to a human.", ev.status === "awaiting_approval" ? "ok" : "warn");
        }
      });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setRunning(false);
      setLive(null);
      await reload();
      refresh();
    }
  }

  async function reset() {
    if (!inc) return;
    try {
      await api(`/api/incidents/${inc.id}/reset`, { method: "POST" });
      toast(`${inc.id} reset to open. Simulated environment restored.`);
      setFocus("rank");
      reload();
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  if (!selected) {
    return (
      <>
        <StationHeader n={2} title="Triage line">Choose an incident in the queue and watch the agent work through each stage.</StationHeader>
        <Empty title="No incident selected">
          <button className="font-semibold text-enamel underline" onClick={() => document.getElementById("queue")?.scrollIntoView({ behavior: "smooth" })}>Pick one from the queue</button> to start.
        </Empty>
      </>
    );
  }

  const focused = stations[focus]?.ev;
  const m = inc?.metrics;

  return (
    <>
      <StationHeader n={2} title="Triage line">
        Eight automated stages, then a hard stop. Nothing past the human gate happens without a named approver.
      </StationHeader>
      {error && <ErrorNote text={error} />}
      {inc && (
        <>
          <div className="mb-5 flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[0.8125rem] text-mute">{inc.id}, {inc.service}, detected {stamp(inc.detected_at)}</p>
              <h3 className="mt-1 text-[1.5rem] font-extrabold leading-tight">{inc.title}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Severity sev={inc.severity} /><StatusPill status={inc.status} />
                {inc.adversarial && <span className="text-[0.8125rem] font-semibold text-danger-ink">Logs contain a prompt-injection attempt</span>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-rule px-3 py-2 text-[0.875rem] font-semibold">
                <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} className="accent-[#2445a8]" />
                Use Qwen
              </label>
              {can("approver") && <Button variant="ghost" onClick={reset} disabled={running}><RotateCcw size={16} />Reset</Button>}
              <Button onClick={run} busy={running} disabled={!can("responder") || inc.status === "resolved" || inc.status === "executing"}
                title={!can("responder") ? "Viewers can't run triage" : undefined}>
                <Play size={16} />{inc.latest_run ? "Run triage again" : "Run triage"}
              </Button>
            </div>
          </div>

          {/* mimic board */}
          <div className="board rounded-2xl bg-board p-5 text-board-text sm:p-6">
            <div className="scroll-thin overflow-x-auto pb-2">
              <LayoutGroup>
                <ol className="flex min-w-[880px] items-start">
                  {LINE.map((s, i) => {
                    const st = stations[s.id];
                    const tone = st?.tone ?? "idle";
                    const lit = !!st && tone !== "idle";
                    const nextLit = i < LINE.length - 1 && stations[LINE[i + 1].id] && stations[LINE[i + 1].id].tone !== "idle";
                    const isGate = s.id === "gate";
                    return (
                      <Fragment key={s.id}>
                        <li className="relative flex w-[64px] shrink-0 flex-col items-center">
                          <button onClick={() => st?.ev && setFocus(s.id)} disabled={!st?.ev}
                            aria-label={`${s.label}${st?.ev ? `: ${st.ev.status}` : ""}`}
                            className={`relative grid h-9 w-9 place-items-center rounded-full border-2 transition-colors ${focus === s.id ? "border-white" : "border-board-line"} ${isGate ? "rounded-md" : ""} bg-board-2 disabled:cursor-default`}>
                            <span className={lit ? "lamp-on rounded-full" : ""} style={{ color: { idle: "#34435a", run: "#7f9cf5", clear: "#2e9e5b", caution: "#e8a317", danger: "#d2362b", enamel: "#7f9cf5" }[tone] }}>
                              <Lamp tone={tone === "run" ? "enamel" : tone} size={14} pulse={st?.pulse} />
                            </span>
                            {trainAt === s.id && (
                              <motion.span layoutId="train" className="absolute -top-3 h-2 w-6 rounded-full bg-white"
                                transition={{ type: "spring", stiffness: 300, damping: 30 }} />
                            )}
                          </button>
                          <span className={`mt-2 text-center text-[0.75rem] leading-tight ${lit ? "text-white" : "text-board-text/60"} ${isGate ? "font-bold" : ""}`}>{s.label}</span>
                          <span className="h-4 text-[0.6875rem] text-board-text/70">{st?.note ?? (st?.ev?.ms != null ? `${st.ev.ms}ms` : "")}</span>
                        </li>
                        {i < LINE.length - 1 && (
                          <li aria-hidden className="relative mt-[17px] h-[3px] flex-1 bg-board-line">
                            <motion.span className="absolute inset-y-0 left-0 bg-clear" initial={false}
                              animate={{ width: lit && nextLit ? "100%" : "0%" }} transition={{ duration: 0.45 }} />
                            {isGate && <span className="absolute -top-[9px] left-1/2 h-[21px] w-[3px] -translate-x-1/2 rounded bg-danger" />}
                          </li>
                        )}
                      </Fragment>
                    );
                  })}
                </ol>
              </LayoutGroup>
            </div>
            {inc.latest_run && !running && (
              <p className="mt-4 border-t border-board-line pt-4 text-[0.9375rem] leading-relaxed">
                <span className="font-semibold text-white">Agent summary: </span>{inc.latest_run.summary}
                <span className="block mt-1 text-[0.8125rem] text-board-text/70">
                  {inc.latest_run.model === "none" ? "Ranked without the LLM" : inc.latest_run.llm_ok ? `Model ${inc.latest_run.model}` : "Model unavailable: fallback ranking"}, {(inc.latest_run.total_ms / 1000).toFixed(1)}s total
                </span>
              </p>
            )}
            {!inc.latest_run && !running && <p className="mt-4 border-t border-board-line pt-4 text-[0.9375rem]">The line is quiet. Press Run triage to send this incident through.</p>}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.35fr_1fr]">
            <div className="min-w-0 self-start rounded-2xl border border-rule bg-sheet p-5">
              <AnimatePresence mode="wait">
                <motion.div key={focus + (focused?.status ?? "")} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                  {focused ? <StageDetail ev={focused} labels={catalog?.root_causes ?? {}} onGate={() => document.getElementById("gate")?.scrollIntoView({ behavior: "smooth" })} />
                    : <p className="text-mute">Stage details appear here. Select any lit station on the board.</p>}
                </motion.div>
              </AnimatePresence>
            </div>

            <aside className="min-w-0 space-y-5">
              {m && (
                <div className="rounded-2xl border border-rule bg-sheet p-5">
                  <h4 className="font-bold">Metrics, last 24 minutes</h4>
                  <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3">
                    {([["error_rate_pct", "Error rate", "%"], ["p99_latency_ms", "p99 latency", " ms"], ["cpu_pct", "CPU", "%"],
                      ["mem_pct", "Memory", "%"], ["disk_pct", "Disk", "%"], ["rps", "Requests/s", ""]] as const).map(([k, label, unit]) => {
                      const v = m[k] ?? [];
                      const rising = v[v.length - 1] > v[0] * 1.6 && v[v.length - 1] - v[0] > 5;
                      return (
                        <div key={k}>
                          <div className="flex items-baseline justify-between text-[0.8125rem]">
                            <span className="text-mute">{label}</span>
                            <span className={`font-mono font-semibold ${rising ? "text-danger-ink" : ""}`}>{Math.round(v[v.length - 1] * 10) / 10}{unit}</span>
                          </div>
                          <Sparkline values={v} tone={rising ? "danger" : "idle"} height={30} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="rounded-2xl border border-rule bg-sheet p-5 text-[0.9375rem]">
                <h4 className="font-bold">Change timeline</h4>
                <ul className="mt-2 space-y-1">
                  {inc.context.deploy_history.slice(-2).map((d: any) => (
                    <li key={d.version} className="flex justify-between gap-3"><span>Deploy <span className="font-mono">{d.version}</span></span><span className="text-mute">{stamp(d.at)}</span></li>
                  ))}
                  {inc.context.config_history.slice(-2).map((d: any) => (
                    <li key={d.version} className="flex justify-between gap-3"><span>Config <span className="font-mono">{d.version}</span></span><span className="text-mute">{stamp(d.at)}</span></li>
                  ))}
                </ul>
                <p className="mt-3 text-mute">Depends on {inc.context.dependencies.map((d: any) => `${d.name} (${d.type})`).join(", ")}.</p>
                <p className="mt-1 text-mute">Live state: <span className="font-mono text-ink">{inc.env.version}, {inc.env.config_version}, {inc.env.replicas} replicas{inc.env.circuit_breaker ? ", breaker on" : ""}</span></p>
              </div>
              <div className="rounded-2xl border border-rule bg-sheet p-5">
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={() => setShowLogs((v) => !v)}>{showLogs ? "Hide raw logs" : "Show raw logs"}</Button>
                  <Button variant="ghost" onClick={() => setReveal((v) => !v)}>{reveal ? <EyeOff size={16} /> : <Eye size={16} />}{reveal ? "Hide answer key" : "Show answer key"}</Button>
                </div>
                {reveal && inc.ground_truth && (
                  <p className="mt-3 rounded-lg bg-caution-soft px-3 py-2 text-[0.875rem]">
                    Evaluation only, never shown to the agent: <b>{catalog?.root_causes[inc.ground_truth.root_cause]?.label ?? inc.ground_truth.root_cause}</b>, fixed by <span className="font-mono">{inc.ground_truth.action}</span> on <span className="font-mono">{inc.ground_truth.target}</span>.
                  </p>
                )}
                {showLogs && (
                  <pre className="scroll-thin mt-3 max-h-80 overflow-auto rounded-lg bg-board p-3 font-mono text-[0.71875rem] leading-relaxed text-board-text">
                    {inc.logs.split("\n").map((l, i) => (
                      <span key={i} className={`block ${/ ERROR | FATAL /.test(l) ? "text-[#ff9b92]" : / WARN /.test(l) ? "text-[#f5cf7a]" : ""}`}>{l}</span>
                    ))}
                  </pre>
                )}
              </div>
              <button className="text-[0.875rem] font-semibold text-mute hover:text-ink" onClick={() => select(null)}>Clear selection</button>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
