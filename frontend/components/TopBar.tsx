"use client";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi, useStore } from "@/lib/store";
import { Lamp } from "./ui";

interface Health {
  database: boolean; runbooks_indexed: number; kill_switch: boolean | null;
  llm: { ok: boolean; model: string; model_present: boolean };
}

export function Mark() {
  return (
    <svg viewBox="0 0 24 32" className="h-7 w-5" aria-hidden>
      <rect x="10.5" y="14" width="3" height="18" rx="1" fill="#14213d" />
      <rect x="3" y="1" width="18" height="15" rx="7.5" fill="#14213d" />
      <circle cx="12" cy="8.5" r="4" fill="#d2362b" />
    </svg>
  );
}

export function TopBar() {
  const { user, signOut, can, toast, refresh } = useStore();
  const { data: h, reload } = useApi<Health>("/api/health", { poll: 15000 });
  const [busy, setBusy] = useState(false);
  const frozen = !!h?.kill_switch;

  async function toggle() {
    setBusy(true);
    try {
      await api("/api/settings/kill-switch", { method: "POST", body: { on: !frozen } });
      toast(frozen ? "Changes unfrozen. Approved actions can run again." : "All changes frozen. Nothing will execute until you unfreeze.", frozen ? "ok" : "warn");
      reload();
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const llmTone = !h ? "idle" : h.llm.ok && h.llm.model_present ? "clear" : h.llm.ok ? "caution" : "danger";
  const llmText = !h ? "Checking model" : h.llm.ok && h.llm.model_present ? `${h.llm.model} ready`
    : h.llm.ok ? `${h.llm.model} not pulled` : "Model offline: fallback ranking";

  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-4 border-b border-rule bg-sheet/95 px-4 backdrop-blur sm:px-6 lg:h-16">
      <div className="flex items-center gap-2.5">
        <Mark />
        <span className="text-[1.25rem] font-black tracking-[-0.02em]">Sentinel</span>
      </div>

      <div className="ml-4 hidden items-center gap-5 text-[0.8125rem] text-mute md:flex">
        <span className="flex items-center gap-2"><Lamp tone={llmTone} size={8} />{llmText}</span>
        <span className="flex items-center gap-2"><Lamp tone={h?.database ? "clear" : "danger"} size={8} />MySQL</span>
        <span className="flex items-center gap-2"><Lamp tone={h?.runbooks_indexed ? "clear" : "caution"} size={8} />{h?.runbooks_indexed ?? 0} approved runbooks indexed</span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <button
          onClick={toggle}
          disabled={!can("approver") || busy || h?.kill_switch === null}
          title={can("approver") ? "Global kill switch" : "Only approvers can use the kill switch"}
          className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[0.8125rem] font-bold transition-colors disabled:cursor-not-allowed ${
            frozen ? "border-danger bg-danger text-white" : "border-rule bg-sheet text-ink hover:border-danger hover:text-danger-ink"
          } disabled:opacity-70`}
        >
          <span className={`relative h-4 w-7 rounded-full ${frozen ? "bg-white/30" : "bg-rule"}`}>
            <span className={`absolute top-0.5 h-3 w-3 rounded-full transition-all ${frozen ? "left-3.5 bg-white" : "left-0.5 bg-ink"}`} />
          </span>
          {frozen ? "Changes frozen" : "Freeze all changes"}
        </button>
        {user && (
          <div className="flex items-center gap-2">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-[0.875rem] font-bold">{user.name}</p>
              <p className="text-[0.75rem] capitalize text-mute">{user.role}</p>
            </div>
            <button onClick={signOut} className="rounded-lg p-2 text-mute hover:bg-paper hover:text-ink" aria-label="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
