"use client";
import { Check as CheckIcon, X } from "lucide-react";
import type { ActionItem, Check, RankRow, StageEvent } from "@/lib/api";
import { Lamp, Meter, StatusPill } from "../ui";

type Labels = Record<string, { label: string }>;
const lbl = (labels: Labels, id: string) => labels[id]?.label ?? id;

export function Checks({ checks }: { checks: Check[] }) {
  return (
    <ul className="space-y-1.5">
      {checks.map((c) => (
        <li key={c.name} className="flex items-start gap-2 text-[0.875rem]">
          <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${c.passed ? (c.hard === false ? "bg-caution" : "bg-clear") : "bg-danger"} text-white`}>
            {c.passed ? <CheckIcon size={11} strokeWidth={3} /> : <X size={11} strokeWidth={3} />}
          </span>
          <span><span className="font-mono text-[0.8125rem] text-mute">{c.name}</span> {c.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function Title({ ev, children }: { ev: StageEvent; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <h4 className="text-[1.25rem] font-extrabold">{ev.title}</h4>
      <span className="text-[0.8125rem] text-mute">{children}{ev.ms != null ? ` ${ev.ms} ms` : ""}</span>
    </div>
  );
}

const COMP = [
  { key: "llm", label: "Qwen", color: "#2a78d6" },
  { key: "retrieval", label: "Runbook match", color: "#e87ba4" },
  { key: "signal", label: "Rule signals", color: "#6250d6" },
] as const;

function RankView({ d }: { d: any }) {
  const w = d.weights ?? { llm: 0.5, retrieval: 0.25, signal: 0.25 };
  const total = w.llm + w.retrieval + w.signal || 1;
  return (
    <>
      {d.abstained && (
        <p className="mb-4 rounded-lg bg-caution-soft px-3 py-2 text-[0.9375rem] text-caution-ink">
          Confidence is below {d.abstain_below}. The agent abstains: it will not send a change for approval, and a human takes over.
        </p>
      )}
      <ol className="space-y-4">
        {(d.top3 as RankRow[]).map((r, i) => (
          <li key={r.root_cause}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-bold"><span className="mr-2 text-mute">{i + 1}</span>{r.label}</span>
              <span className="font-mono font-semibold">{r.score.toFixed(2)}</span>
            </div>
            <div className="mt-1.5 flex h-3 w-full gap-[2px] rounded bg-paper">
              {COMP.map((c) => {
                const share = (r.components[c.key] * w[c.key]) / total;
                return share > 0.001 ? (
                  <span key={c.key} className="h-full first:rounded-l last:rounded-r" title={`${c.label}: ${share.toFixed(2)} of ${r.score.toFixed(2)}`}
                    style={{ width: `${share * 100}%`, background: c.color }} />
                ) : null;
              })}
            </div>
            {!!r.evidence?.length && (
              <ul className="mt-2 space-y-0.5 text-[0.8125rem] text-mute">
                {r.evidence.slice(0, 3).map((e) => <li key={e} className="truncate" title={e}>“{e}”</li>)}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-mute">
        {COMP.map((c) => (
          <span key={c.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />{c.label} weight {w[c.key]}
          </span>
        ))}
        <span>Mode: {d.mode}</span>
      </p>
    </>
  );
}

function ExecutionView({ a }: { a: ActionItem }) {
  const e = a.execution ?? {};
  const changed = Object.keys(e.after ?? {}).filter((k) => JSON.stringify(e.before?.[k]) !== JSON.stringify(e.after?.[k]));
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-bold">{a.label}</span><span className="font-mono text-[0.875rem]">{a.target}</span><StatusPill status={a.status} />
      </div>
      <ol className="space-y-1.5 border-l-2 border-rule pl-4">
        {(e.steps ?? []).map((s: any, i: number) => (
          <li key={i} className="relative text-[0.875rem]">
            <span className="absolute -left-[22px] top-1.5"><Lamp tone={s.status === "error" ? "danger" : s.status === "warn" ? "caution" : "clear"} size={9} /></span>
            {s.msg}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[0.875rem] text-mute">
        Approved by {e.approvers?.join(" and ") || "nobody"}, run by {a.executed_by}.{" "}
        {changed.length ? `Changed: ${changed.map((k) => `${k} ${e.before[k]} → ${e.after[k]}`).join(", ")}.` : "Final state is identical to the snapshot."}
      </p>
    </>
  );
}

export function StageDetail({ ev, labels, onGate }: { ev: StageEvent; labels: Labels; onGate: () => void }) {
  const d = ev.data ?? {};
  switch (ev.stage) {
    case "ingest":
      return (<><Title ev={ev} />
        <p>Loaded <b>{d.raw_lines}</b> log lines and {d.metric_series?.length} metric series for <span className="font-mono">{d.service}</span> ({d.severity}).</p>
        <p className="mt-2 text-mute">Dependencies in scope: {d.dependencies?.join(", ")}. The agent sees no answer key and no hidden simulator state.</p></>);
    case "sanitize":
      return (<><Title ev={ev} />
        <p>Parsed {d.parsed_lines} lines, redacted <b>{d.redactions}</b> secrets or emails before anything reached the model, kept {d.excerpt_lines} lines for its context.</p>
        {d.injections?.length ? (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft p-3">
            <p className="font-bold text-danger-ink">Prompt injection removed from {d.injections.length} line(s)</p>
            {d.injections.map((x: any) => <p key={x.line} className="mt-1 font-mono text-[0.78125rem] text-danger-ink">line {x.line}: {x.excerpt}</p>)}
            <p className="mt-2 text-[0.875rem]">Every change on this incident now needs two approvers.</p>
          </div>
        ) : <p className="mt-3 text-mute">No instruction-like text found in the logs.</p>}</>);
    case "signals": {
      const rows = Object.entries(d.scores ?? {}).filter(([, v]) => (v as number) > 0).sort((a, b) => (b[1] as number) - (a[1] as number));
      const max = Math.max(1, ...rows.map(([, v]) => v as number));
      return (<><Title ev={ev}>{d.stats?.errors} errors, {d.stats?.warnings} warnings</Title>
        {d.metric_findings?.length > 0 && <ul className="mb-4 space-y-1">{d.metric_findings.map((f: any) => <li key={f.text} className="text-[0.9375rem]"><Lamp tone="caution" size={8} /> <span className="ml-1">{f.text}</span></li>)}</ul>}
        <ul className="space-y-2.5">
          {rows.map(([k, v]) => (
            <li key={k}>
              <div className="flex justify-between text-[0.875rem]"><span>{lbl(labels, k)}</span><span className="font-mono">{v as number}</span></div>
              <Meter value={(v as number) / max} tone="idle" height={6} />
            </li>
          ))}
          {!rows.length && <li className="text-mute">No rule matched. The model and runbooks will have to carry this one.</li>}
        </ul></>);
    }
    case "retrieve":
      return (<><Title ev={ev} />
        <ul className="space-y-3">
          {d.runbooks?.map((r: any) => (
            <li key={r.id}>
              <div className="flex justify-between gap-3 text-[0.9375rem]"><span><span className="font-mono text-mute">{r.id}</span> {r.title}</span><span className="font-mono">{r.similarity.toFixed(2)}</span></div>
              <Meter value={r.similarity} tone="enamel" height={6} />
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[0.875rem] text-mute">Only approved runbooks are searchable. Excluded drafts: {d.excluded_unapproved?.join(", ") || "none"}.</p></>);
    case "reason": {
      const o = d.output;
      if (!o) return (<><Title ev={ev} />
        <p className="rounded-lg bg-caution-soft px-3 py-2 text-caution-ink">{d.error ? `Model call failed: ${d.error}` : "Model disabled for this run."}</p>
        <p className="mt-3 text-mute">Safe fallback: ranking uses runbook similarity and rule signals only, and the result is labelled as such.</p></>);
      return (<><Title ev={ev}>{d.model}{d.meta?.prompt_tokens ? `, ${d.meta.prompt_tokens} prompt tokens` : ""}</Title>
        <p className="leading-relaxed">{o.summary}</p>
        <ol className="mt-4 space-y-2">
          {o.root_causes.map((r: any, i: number) => (
            <li key={r.root_cause} className="text-[0.9375rem]"><b>{i + 1}. {lbl(labels, r.root_cause)}</b> <span className="text-mute">confidence {r.confidence}</span>
              {r.evidence?.[0] && <span className="block text-[0.8125rem] text-mute">“{r.evidence[0]}”</span>}</li>
          ))}
        </ol>
        {o.proposed_action?.action && <p className="mt-4 text-[0.9375rem]">Suggested: <span className="font-mono">{o.proposed_action.action}</span> on <span className="font-mono">{o.proposed_action.target}</span></p>}
        {o.risk_notes && <p className="mt-2 text-[0.875rem] text-mute">Risk notes: {o.risk_notes}</p>}</>);
    }
    case "rank":
      return (<><Title ev={ev} /><RankView d={d} /></>);
    case "plan":
      return (<><Title ev={ev}>{d.source === "llm" ? "action chosen by Qwen" : "runbook default"}</Title>
        <ul className="space-y-3">
          {d.actions?.map((a: any) => (
            <li key={a.action_type} className="rounded-lg border border-rule p-3">
              <p><span className="font-mono font-semibold">{a.action_type}</span> on <span className="font-mono">{a.target}</span> {Object.keys(a.params ?? {}).length > 0 && <span className="font-mono text-mute">{JSON.stringify(a.params)}</span>}</p>
              <p className="mt-1 text-[0.875rem] text-mute">{a.rationale} Runbook {a.runbook_id}.</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[0.875rem] text-mute">The model picks which allowed action. Targets and versions are bound from the runbook and change history, so the model can't invent them.</p>
        {d.notes?.map((n: string) => <p key={n} className="mt-1 text-[0.875rem] text-caution-ink">{n}</p>)}</>);
    case "policy":
      return (<><Title ev={ev} />
        <div className="space-y-5">
          {d.decisions?.map((p: any) => (
            <div key={p.action_type}>
              <p className="mb-2 flex flex-wrap items-center gap-2"><span className="font-mono font-semibold">{p.action_type}</span>
                <StatusPill status={p.decision === "blocked" ? "blocked" : p.decision === "auto_allowed" ? "auto_executed" : "pending_approval"} />
                <span className="text-[0.8125rem] text-mute">risk {p.risk}{p.required_approvals ? `, ${p.required_approvals} approver(s)` : ""}</span></p>
              <Checks checks={p.checks} />
            </div>
          ))}
        </div></>);
    case "gate": {
      const acts: ActionItem[] = d.actions ?? d.pending ?? [];
      const pending = acts.filter((a) => a.status === "pending_approval");
      return (<><Title ev={ev} />
        {pending.length ? <p>{pending.length} change(s) are held at a red signal until an approver clears them.</p>
          : <p>Nothing is waiting here. {acts.find((a) => a.status === "approved") ? "The change is approved and ready to run." : "No change passed the policy check, so a human owns this incident."}</p>}
        <ul className="mt-3 space-y-2">
          {acts.map((a) => <li key={a.id} className="flex flex-wrap items-center gap-2 text-[0.9375rem]"><span className="font-mono">{a.action_type}</span><StatusPill status={a.status} />{a.required_approvals > 0 && <span className="text-mute">{a.approvals.filter(v => v.decision === "approve").length}/{a.required_approvals} approvals</span>}</li>)}
        </ul>
        <button onClick={onGate} className="mt-4 font-semibold text-enamel underline">Go to the approval gate</button></>);
    }
    case "execute":
      return (<><Title ev={ev} /><ExecutionView a={d.action} /></>);
    default:
      return <Title ev={ev} />;
  }
}

export { ExecutionView };
