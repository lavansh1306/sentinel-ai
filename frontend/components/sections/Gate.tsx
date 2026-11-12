"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Play, X } from "lucide-react";
import { useState } from "react";
import { api, ApiError, type ActionItem } from "@/lib/api";
import { useApi, useStore } from "@/lib/store";
import { Button, Empty, ErrorNote, StationHeader, StatusPill } from "../ui";
import { Checks } from "./StageDetail";

const RISK_BAND: Record<string, string> = {
  read_only: "bg-rule", low: "bg-enamel", medium: "bg-caution", high: "bg-danger", critical: "bg-danger",
};

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2);
}

function Lever({ a }: { a: ActionItem }) {
  const { user, can, toast, refresh, select } = useStore();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<ApiError | null>(null);
  const yes = a.approvals.filter((v) => v.decision === "approve");
  const voted = a.approvals.some((v) => v.approver === user?.username);

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    try {
      const r = await api<ActionItem>(`/api/actions/${a.id}/decision`, { method: "POST", body: { decision, reason } });
      toast(decision === "reject" ? `Rejected ${a.label}. ${a.incident_id} goes to a human.`
        : r.status === "approved" ? `Approved ${a.label}. It can run now.` : `Approval recorded. ${r.required_approvals - yes.length - 1} more approver needed.`,
        decision === "reject" ? "warn" : "ok");
      setReason("");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function execute() {
    setBusy("execute");
    setBlocked(null);
    try {
      const r = await api<ActionItem>(`/api/actions/${a.id}/execute`, { method: "POST" });
      toast(r.status === "succeeded" ? `${a.label} succeeded. ${a.incident_id} resolved.` : `${a.label} failed its checks and was rolled back automatically.`, r.status === "succeeded" ? "ok" : "warn");
      refresh();
      document.getElementById("execution")?.scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      if (e instanceof ApiError && e.checks.length) setBlocked(e);
      toast((e as Error).message, "error");
      refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.article layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -30 }}
      className="relative overflow-hidden rounded-2xl border border-rule bg-paper pl-2">
      <span className={`absolute inset-y-0 left-0 w-2 ${RISK_BAND[a.risk] ?? "bg-rule"}`} aria-hidden />
      <div className="grid gap-5 p-5 md:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[1.25rem] font-extrabold">{a.label}</h3>
            <span className="font-mono text-[0.9375rem]">{a.target}</span>
            {Object.keys(a.params).length > 0 && <span className="font-mono text-[0.875rem] text-mute">{JSON.stringify(a.params)}</span>}
          </div>
          <p className="mt-1 text-[0.875rem]">
            <span className="font-semibold capitalize">{a.risk} risk</span>
            <span className="text-mute"> for </span>
            <button className="font-semibold text-enamel underline" onClick={() => { select(a.incident_id); document.getElementById("triage")?.scrollIntoView({ behavior: "smooth" }); }}>
              {a.incident_id}
            </button>
            <span className="text-mute"> {a.incident?.title}</span>
          </p>
          <p className="mt-3 leading-relaxed">{a.rationale}</p>
          <details className="mt-3">
            <summary className="cursor-pointer text-[0.875rem] font-semibold text-mute hover:text-ink">Policy checks passed ({a.policy.checks?.length ?? 0})</summary>
            <div className="mt-2"><Checks checks={a.policy.checks ?? []} /></div>
          </details>
          {blocked && (
            <div className="mt-3 rounded-lg border border-danger/30 bg-danger-soft p-3">
              <p className="font-bold text-danger-ink">{blocked.message}</p>
              <Checks checks={blocked.checks} />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <p className="text-[0.875rem] font-semibold">Approvals {yes.length} of {a.required_approvals}{a.required_approvals > 1 ? ", two different people" : ""}</p>
            {a.policy.checks?.some((c) => c.name === "injection_escalation") && (
              <p className="mt-1 text-[0.8125rem] text-danger-ink">Escalated to two approvers: the logs contained a prompt-injection attempt.</p>
            )}
            <div className="mt-2 flex gap-2">
              {Array.from({ length: a.required_approvals }).map((_, i) => {
                const v = yes[i];
                return (
                  <span key={i} title={v ? `${v.name}: ${v.reason || "approved"}` : "Open slot"}
                    className={`grid h-11 w-11 place-items-center rounded-full border-2 text-[0.875rem] font-bold ${v ? "border-clear bg-clear text-white" : "border-dashed border-rule text-mute"}`}>
                    {v ? initials(v.name) : i + 1}
                  </span>
                );
              })}
            </div>
          </div>

          {a.status === "pending_approval" && (
            can("approver") ? (
              voted ? <p className="text-[0.875rem] text-mute">You already approved this. A different approver must give the next approval.</p> : (
                <>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why? Required to reject."
                    className="w-full rounded-lg border border-rule bg-sheet px-3 py-2 text-[0.9375rem] outline-none focus:border-enamel" />
                  <div className="flex gap-2">
                    <Button variant="clear" busy={busy === "approve"} onClick={() => decide("approve")} className="flex-1"><Check size={16} />Approve</Button>
                    <Button variant="ghost" busy={busy === "reject"} onClick={() => decide("reject")} disabled={reason.trim().length < 5}
                      title={reason.trim().length < 5 ? "Write a reason to reject" : undefined}><X size={16} />Reject</Button>
                  </div>
                </>
              )
            ) : <p className="rounded-lg bg-paper text-[0.875rem] text-mute">Only approvers can clear this signal. You're signed in as {user?.role}.</p>
          )}

          {a.status === "approved" && (
            <Button busy={busy === "execute"} disabled={!can("responder")} onClick={execute}
              title={!can("responder") ? "Viewers can't execute" : undefined}>
              <Play size={16} />{busy === "execute" ? "Running with snapshot and health checks" : "Execute change"}
            </Button>
          )}
          <span className="self-start"><StatusPill status={a.status} /></span>
        </div>
      </div>
    </motion.article>
  );
}

export function Gate() {
  const { data, error } = useApi<ActionItem[]>("/api/actions", { poll: 5000 });
  const open = (data ?? []).filter((a) => a.status === "pending_approval" || a.status === "approved");
  const recent = (data ?? []).filter((a) => a.status === "rejected" || a.status === "blocked").slice(0, 5);

  return (
    <>
      <StationHeader n={3} title="Approval gate">
        Every state-changing action stops here. High-risk changes need one approver, critical ones two, and prompt-injection
        incidents are escalated to two automatically.
      </StationHeader>
      {error && <ErrorNote text={error} />}
      {data && open.length === 0 && (
        <Empty title="Nothing is waiting for approval">Run triage on an incident and its proposed fix will appear here for review.</Empty>
      )}
      <div className="space-y-4">
        <AnimatePresence>{open.map((a) => <Lever key={a.id} a={a} />)}</AnimatePresence>
      </div>
      {recent.length > 0 && (
        <div className="mt-10">
          <h3 className="font-bold">Recently stopped</h3>
          <ul className="mt-3 divide-y divide-rule rounded-xl border border-rule">
            {recent.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[0.9375rem]">
                <StatusPill status={a.status} />
                <span className="font-mono">{a.action_type}</span><span className="text-mute">on {a.target}, {a.incident_id}</span>
                <span className="ml-auto text-[0.875rem] text-mute">
                  {a.status === "rejected" ? `“${a.approvals.find((v) => v.decision === "reject")?.reason}”`
                    : a.policy.checks?.filter((c) => c.hard !== false && !c.passed).map((c) => c.name).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
