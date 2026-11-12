export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Role = "viewer" | "responder" | "approver";
export interface User { username: string; name: string; role: Role; title: string }

export interface IncidentSummary {
  id: string; title: string; service: string; severity: string; status: string;
  difficulty: string; adversarial: boolean; detected_at: string; resolved_at: string | null;
}

export interface StageEvent {
  stage: string; title: string; status: "running" | "done" | "warn" | "degraded" | "skipped" | "waiting" | "failed";
  data: any; ms: number | null;
}

export interface Check { name: string; passed: boolean; detail: string; hard?: boolean }

export interface ActionItem {
  id: number; incident_id: string; triage_run_id: number | null; action_type: string; label: string; target: string; params: Record<string, any>;
  rationale: string; runbook_id: string | null; risk: string; required_approvals: number; status: string;
  policy: { decision?: string; checks?: Check[] }; execution: any; created_at: string; executed_at: string | null;
  executed_by: string | null; approvals: { approver: string; name: string; decision: string; reason: string; at: string }[];
  incident?: IncidentSummary;
}

export interface RankRow {
  root_cause: string; label: string; score: number; evidence?: string[];
  components: { llm: number; retrieval: number; signal: number };
}

export interface IncidentDetail extends IncidentSummary {
  logs: string; metrics: Record<string, number[]>; context: any; env: Record<string, any>;
  baseline_mttr_min: number; triage_started_at: string | null;
  latest_run: null | { id: number; status: string; model: string; llm_ok: boolean; total_ms: number; llm_ms: number;
    summary: string; top3: RankRow[]; trace: StageEvent[]; started_at: string; finished_at: string };
  actions: ActionItem[];
  ground_truth?: { root_cause: string; action: string; target: string; params: Record<string, any> };
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public checks: Check[] = []) { super(message); }
}

export function readToken(): string | null {
  try { return localStorage.getItem("sentinel.token"); } catch { return null; }
}
export function writeToken(t: string | null) {
  try { t ? localStorage.setItem("sentinel.token", t) : localStorage.removeItem("sentinel.token"); } catch { /* storage unavailable */ }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = readToken();
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: opts.method ?? "GET",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, `Can't reach the API at ${API}. Is the backend running?`);
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new ApiError(res.status, typeof j.detail === "string" ? j.detail : res.statusText, j.checks ?? []);
  }
  return res.json();
}

/** POST that streams server-sent events (fetch-based so we can send the auth header). */
export async function streamTriage(id: string, useLlm: boolean, onEvent: (ev: any) => void) {
  const token = readToken();
  const res = await fetch(`${API}/api/incidents/${id}/triage?use_llm=${useLlm}`, {
    method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new ApiError(res.status, j.detail ?? "Triage could not start");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) onEvent(JSON.parse(line.slice(6)));
    }
  }
}

export const STATUS_LABEL: Record<string, string> = {
  open: "Open", triaging: "Triaging", awaiting_approval: "Awaiting approval", executing: "Executing",
  resolved: "Resolved", needs_human: "Handed to a human",
  pending_approval: "Awaiting approval", approved: "Approved", rejected: "Rejected", blocked: "Blocked by policy",
  succeeded: "Succeeded", rolled_back: "Rolled back", auto_executed: "Ran (read-only)", superseded: "Superseded",
};

export const ago = (iso: string | null) => {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

export const stamp = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
