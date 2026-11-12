"use client";
import { motion, useReducedMotion } from "framer-motion";
import { Lamp, type Tone } from "../ui";

export interface Stats {
  incidents: { total: number; by_status: Record<string, number> };
  pending_approvals: number; mttr_min: number | null; resolved: number; executions: number; rolled_back: number;
  unauthorized_executions: number; unauthorized_rate: number; blocked_attempts: number; triage_runs: number;
  triage_p50_ms: number | null; triage_p95_ms: number | null; llm_fallback_rate: number | null; kill_switch: boolean;
}

const FLOW: { key: string; label: string; tone: Tone }[] = [
  { key: "open", label: "Open", tone: "idle" },
  { key: "triaging", label: "Agent triaging", tone: "run" },
  { key: "awaiting_approval", label: "Waiting for a human", tone: "caution" },
  { key: "executing", label: "Change running", tone: "run" },
  { key: "resolved", label: "Resolved", tone: "clear" },
];

const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

export function Overview({ stats }: { stats: Stats | null }) {
  const reduce = useReducedMotion();
  const by = stats?.incidents.by_status ?? {};
  const s = (n: number | null | undefined, unit = "") => (n === null || n === undefined ? "—" : `${n}${unit}`);

  const rows: { tone: Tone; label: string; value: string; note: string }[] = stats ? [
    { tone: stats.unauthorized_executions === 0 ? "clear" : "danger", label: "Changes made without valid approval",
      value: `${stats.unauthorized_executions} of ${stats.executions}`, note: "Re-checked from the database at execution time" },
    { tone: "enamel", label: "Unsafe execution attempts blocked", value: s(stats.blocked_attempts),
      note: "Missing approvals, kill switch, out-of-scope targets" },
    { tone: stats.pending_approvals ? "caution" : "idle", label: "Changes waiting at the gate", value: s(stats.pending_approvals),
      note: "Each one needs a named approver" },
    { tone: "idle", label: "Mean time to resolution", value: s(stats.mttr_min, " min"), note: `From triage start, ${stats.resolved} resolved here` },
    { tone: "idle", label: "Triage time, median / 95th", value: stats.triage_p50_ms === null ? "—" : `${(stats.triage_p50_ms / 1000).toFixed(1)}s / ${((stats.triage_p95_ms ?? 0) / 1000).toFixed(1)}s`,
      note: `${stats.triage_runs} runs on this machine` },
    { tone: stats.llm_fallback_rate ? "caution" : "idle", label: "Runs where the model was unavailable", value: stats.llm_fallback_rate === null ? "—" : `${Math.round(stats.llm_fallback_rate * 100)}%`,
      note: "The agent then ranks with runbooks and rules only" },
  ] : [];

  return (
    <div>
      <div className="grid gap-12 lg:grid-cols-[1.25fr_1fr] lg:items-end">
        <div>
          <h1 className="max-w-[17ch] text-[2.75rem] font-black leading-[1.02] tracking-[-0.025em] sm:text-[4rem]">
            No change reaches production until a person pulls the lever.
          </h1>
          <p className="mt-6 max-w-[56ch] text-[1.125rem] leading-relaxed text-mute">
            Sentinel reads incident logs, ranks likely root causes with a local Qwen model, and proposes a fix from an
            approved runbook. Then it stops at the gate and waits for you. Every step lands in a tamper-evident trace log.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button onClick={() => go("queue")} className="rounded-lg bg-enamel px-5 py-2.5 font-semibold text-white hover:bg-enamel-deep">Open the incident queue</button>
            <button onClick={() => go("evaluation")} className="rounded-lg border border-rule px-5 py-2.5 font-semibold hover:border-ink">See the evaluation</button>
          </div>
        </div>

        {/* lifecycle line with live counts */}
        <div className="rounded-2xl bg-board p-6 text-board-text">
          <p className="text-[0.875rem] font-semibold text-white">Where the {stats?.incidents.total ?? 0} incidents are now</p>
          <ol className="relative mt-5 space-y-4">
            <span className="absolute bottom-3 left-[9px] top-3 w-[3px] bg-board-line" aria-hidden />
            {FLOW.map((f, i) => (
              <motion.li key={f.key} className="relative flex items-center gap-4"
                initial={reduce ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.08 }}>
                <span className="relative z-10 grid h-[21px] w-[21px] place-items-center rounded-full bg-board">
                  <Lamp tone={by[f.key] ? f.tone : "idle"} size={13} pulse={!!by[f.key] && (f.tone === "run" || f.tone === "caution")} />
                </span>
                <span className="flex-1">{f.label}</span>
                <span className="font-mono text-[1.25rem] font-semibold text-white">{by[f.key] ?? 0}</span>
              </motion.li>
            ))}
            <li className="relative flex items-center gap-4 border-t border-board-line pt-4">
              <span className="relative z-10 grid h-[21px] w-[21px] place-items-center rounded-full bg-board">
                <Lamp tone={by.needs_human ? "danger" : "idle"} size={13} />
              </span>
              <span className="flex-1">Handed to a human (agent unsure, rejected or rolled back)</span>
              <span className="font-mono text-[1.25rem] font-semibold text-white">{by.needs_human ?? 0}</span>
            </li>
          </ol>
        </div>
      </div>

      <div className="mt-16">
        <h3 className="text-[1.25rem] font-bold">Safety record on this machine</h3>
        <div className="mt-4 divide-y divide-rule rounded-2xl border border-rule bg-sheet">
          {rows.map((r) => (
            <div key={r.label} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 px-5 py-3.5 sm:grid-cols-[auto_1.2fr_1fr_auto]">
              <Lamp tone={r.tone} size={11} />
              <span className="font-semibold">{r.label}</span>
              <span className="hidden text-[0.875rem] text-mute sm:block">{r.note}</span>
              <span className="text-right font-mono text-[1.125rem] font-semibold">{r.value}</span>
            </div>
          ))}
          {!stats && <p className="px-5 py-6 text-mute">Loading live numbers from the API</p>}
        </div>
      </div>
    </div>
  );
}
