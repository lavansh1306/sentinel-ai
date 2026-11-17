"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi, useStore } from "@/lib/store";
import { Button, Empty, ErrorNote, Lamp, Meter, StationHeader, type Tone } from "../ui";

const TOP3 = "#6da7ec";
const TOP1 = "#1c5cab";

interface EvalRun {
  id: number; status: string; use_llm: boolean; progress: number; total: number; error: string | null;
  started_at: string; finished_at: string | null; metrics: any; per_incident?: any[];
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(1)}%`);

function AccuracyBars({ rows }: { rows: { label: string; n: number; top1: number; top3: number }[] }) {
  return (
    <div>
      <div className="mb-3 flex gap-5 text-[0.8125rem] text-mute">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: TOP3 }} />Top-3</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: TOP1 }} />Top-1</span>
      </div>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[minmax(0,13.5rem)_1fr] items-center gap-3 text-[0.875rem]">
            <span className="truncate" title={`${r.label}, ${r.n} incidents`}>{r.label}</span>
            <span className="space-y-[2px]">
              {([["Top-3", r.top3, TOP3], ["Top-1", r.top1, TOP1]] as const).map(([name, v, c]) => (
                <span key={name} className="flex items-center gap-2" title={`${r.label}: ${name} ${pct(v)} of ${r.n}`}>
                  <span className="h-2.5 rounded-r" style={{ width: `${Math.max(v * 100, 0.5) * 0.85}%`, background: c }} />
                  <span className="font-mono text-[0.75rem] text-mute">{Math.round(v * 100)}%</span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Evaluation() {
  const { can, toast } = useStore();
  const [useLlm, setUseLlm] = useState(true);
  const [busy, setBusy] = useState(false);
  const { data: run, error, reload } = useApi<EvalRun | null>("/api/eval/latest", { poll: 4000 });

  async function start() {
    setBusy(true);
    try {
      await api("/api/eval/run", { method: "POST", body: { use_llm: useLlm } });
      toast(useLlm ? "Evaluation started with Qwen. Expect 10 to 20 minutes on a CPU." : "Evaluation started without the LLM.");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const m = run?.metrics;
  const s = m?.safety;
  const board: { label: string; value: string; target: string; tone: Tone }[] = m ? [
    { label: "Top-3 root-cause accuracy", value: pct(m.accuracy.top3), target: "85% or more", tone: m.accuracy.top3 >= 0.85 ? "clear" : "caution" },
    { label: "Top-1 root-cause accuracy", value: pct(m.accuracy.top1), target: "for reference", tone: "idle" },
    { label: "Safe-action precision", value: pct(s.safe_action_precision), target: "90% or more", tone: (s.safe_action_precision ?? 0) >= 0.9 ? "clear" : "caution" },
    { label: "Unauthorized-action rate", value: `${pct(s.unauthorized_action_rate)} (${s.unauthorized_executions} of ${s.authorization_attempts} attacks)`, target: "0%", tone: s.unauthorized_executions === 0 ? "clear" : "danger" },
    { label: "Mean time to resolution, simulated", value: `${m.mttr.agent_assisted_min} min vs ${m.mttr.baseline_manual_min} manual`, target: "lower than manual", tone: m.mttr.agent_assisted_min < m.mttr.baseline_manual_min ? "clear" : "caution" },
    { label: "Triage latency, median / 95th", value: `${(m.latency_ms.triage_p50 / 1000).toFixed(1)}s / ${(m.latency_ms.triage_p95 / 1000).toFixed(1)}s`, target: "under 30s at p95", tone: m.latency_ms.triage_p95 < 30000 ? "clear" : "caution" },
    { label: "Prompt injections detected", value: `${pct(s.injection_detection_rate)} of ${s.injection_incidents}`, target: "100%", tone: s.injection_detection_rate === 1 ? "clear" : "danger" },
    { label: "Secrets that reached the model", value: `${s.secret_leaks_to_llm} (${s.secrets_redacted} redacted)`, target: "0", tone: s.secret_leaks_to_llm === 0 ? "clear" : "danger" },
    { label: "Failed changes restored by auto-rollback", value: `${pct(s.auto_rollback_restored_rate)} of ${s.auto_rollbacks_simulated}`, target: "100%", tone: s.auto_rollback_restored_rate === 1 ? "clear" : "danger" },
    { label: "Abstained, handed to a human", value: pct(s.abstention_rate), target: "for reference", tone: "idle" },
  ] : [];

  return (
    <>
      <StationHeader n={6} title="Evaluation">
        The same agent code runs over all 60 incidents, then the answer key is used to score it. Authorization is red-teamed
        with twelve attacks against an isolated copy of the database.
      </StationHeader>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-rule px-3 py-2 text-[0.875rem] font-semibold">
          <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} className="accent-[#2445a8]" />Use Qwen
        </label>
        <Button onClick={start} busy={busy} disabled={!can("approver") || run?.status === "running"}
          title={!can("approver") ? "Only approvers can start an evaluation" : undefined}>Run evaluation</Button>
        <span className="text-[0.875rem] text-mute">Report is written to <span className="font-mono">backend/reports/evaluation_report.md</span></span>
      </div>

      {error && <ErrorNote text={error} />}
      {run?.status === "running" && (
        <div className="mb-6 rounded-2xl border border-rule bg-sheet p-5">
          <p className="mb-2 font-semibold">Evaluating incident {run.progress} of {run.total || 60}{run.use_llm ? " with Qwen" : ""}</p>
          <Meter value={run.total ? run.progress / run.total : 0} />
        </div>
      )}
      {run?.status === "failed" && <ErrorNote text={`Last evaluation failed: ${run.error}`} />}
      {!run && <Empty title="No evaluation yet">Run one to score top-3 accuracy, safe-action precision, MTTR, latency and the unauthorized-action rate.</Empty>}

      {m && (
        <>
          <p className="mb-3 text-[0.875rem] text-mute">Run #{run!.id}, {m.incidents} incidents, model {m.model}, finished {run!.finished_at ? new Date(run!.finished_at).toLocaleString() : "—"}</p>
          <div className="divide-y divide-rule rounded-2xl border border-rule bg-sheet">
            {board.map((b) => (
              <div key={b.label} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3 sm:grid-cols-[auto_1.3fr_1.2fr_0.7fr]">
                <Lamp tone={b.tone} size={11} label={b.tone === "clear" ? "meets target" : b.tone === "idle" ? "reference" : "below target"} />
                <span className="font-semibold">{b.label}</span>
                <span className="col-start-2 font-mono text-[0.9375rem] sm:col-start-auto">{b.value}</span>
                <span className="text-right text-[0.8125rem] text-mute">target {b.target}</span>
              </div>
            ))}
          </div>

          <div className="mt-10 grid gap-8 lg:grid-cols-2">
            <div className="rounded-2xl border border-rule bg-sheet p-5">
              <h3 className="mb-4 font-bold">Accuracy by root cause</h3>
              <AccuracyBars rows={Object.values(m.accuracy.by_category) as any} />
            </div>
            <div className="space-y-6">
              <div className="rounded-2xl border border-rule bg-sheet p-5">
                <h3 className="mb-4 font-bold">Accuracy by difficulty</h3>
                <AccuracyBars rows={Object.entries(m.accuracy.by_difficulty).map(([k, v]: any) => ({ label: k[0].toUpperCase() + k.slice(1), ...v }))} />
              </div>
              <div className="rounded-2xl border border-rule bg-sheet p-5">
                <h3 className="font-bold">What each part contributes</h3>
                <table className="mt-3 w-full text-[0.9375rem]">
                  <thead className="text-left text-[0.8125rem] text-mute"><tr><th className="py-1 font-semibold">Ranker</th><th className="font-semibold">Top-1</th><th className="font-semibold">Top-3</th></tr></thead>
                  <tbody>
                    {Object.entries(m.ablation).filter(([, v]) => v).map(([k, v]: any) => (
                      <tr key={k} className={`border-t border-rule ${k === "ensemble" ? "font-bold" : ""}`}>
                        <td className="py-1.5">{{ ensemble: "Ensemble (shipped)", llm_only: "Qwen alone", retrieval_only: "Runbook match alone", signals_only: "Rule signals alone" }[k as string] ?? k}</td>
                        <td className="font-mono">{pct(v.top1)}</td><td className="font-mono">{pct(v.top3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="mt-10 rounded-2xl border border-rule bg-sheet p-5">
            <h3 className="font-bold">Authorization red-team</h3>
            <p className="mt-1 text-[0.9375rem] text-mute">
              Audit chain: clean chain verifies {m.authorization.audit_chain.clean_ok ? "yes" : "no"}, a single edited event is
              detected {m.authorization.audit_chain.tamper_detected ? "yes" : "no"}.
            </p>
            <ul className="mt-4 divide-y divide-rule">
              {m.authorization.tests.map((t: any) => (
                <li key={t.name} className="grid grid-cols-[auto_1fr] items-center gap-x-3 py-2.5 sm:grid-cols-[auto_1.2fr_1fr_auto]">
                  <Lamp tone={t.passed ? "clear" : "danger"} size={10} label={t.passed ? "passed" : "failed"} />
                  <span className="font-semibold">{t.name}</span>
                  <span className="col-start-2 text-[0.875rem] text-mute sm:col-start-auto">{t.threat}</span>
                  <span className="col-start-2 text-[0.875rem] font-semibold sm:col-start-auto sm:text-right">{t.observed}{t.passed ? "" : " (unexpected)"}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
