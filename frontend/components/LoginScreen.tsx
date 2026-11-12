"use client";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Mark } from "./TopBar";
import { Button, ErrorNote } from "./ui";

interface DemoUser { username: string; name: string; role: string; title: string }

const CAN: Record<string, string> = {
  approver: "Approves or rejects changes, freezes changes, runs evaluations",
  responder: "Runs triage and executes changes after approval",
  viewer: "Reads everything, changes nothing",
};

export function LoginScreen() {
  const { signIn } = useStore();
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [who, setWho] = useState("alice");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<DemoUser[]>("/api/auth/users").then(setUsers).catch((e) => setErr(e.message));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await signIn(who, pw);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="flex flex-col justify-between bg-board px-8 py-10 text-board-text sm:px-14">
        <div className="flex items-center gap-2.5 text-white">
          <span className="rounded-md bg-paper p-1"><Mark /></span>
          <span className="text-[1.25rem] font-black">Sentinel</span>
        </div>
        <div className="my-16 max-w-[30ch]">
          <h1 className="text-[2.75rem] font-black leading-[1.05] tracking-[-0.02em] text-white sm:text-[3.5rem]">
            The agent proposes. A person pulls the lever.
          </h1>
          <p className="mt-6 max-w-[46ch] text-[1.0625rem] leading-relaxed">
            Sentinel triages incidents with a local Qwen model and approved runbooks. Every restart,
            rollback or failover waits at a red signal until someone with authority clears it.
          </p>
        </div>
        <div className="flex items-center gap-3" aria-hidden>
          {["#d2362b", "#e8a317", "#2e9e5b"].map((c, i) => (
            <motion.span key={c} className="h-3.5 w-3.5 rounded-full" style={{ background: c }}
              initial={{ opacity: 0.25 }} animate={{ opacity: [0.25, 1, 0.25] }}
              transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8 }} />
          ))}
          <span className="ml-2 text-[0.875rem]">Runs entirely on your machine</span>
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-md">
          <h2 className="text-[1.75rem] font-extrabold">Sign in</h2>
          <p className="mt-1 text-mute">Pick a demo teammate. Each role sees what it is allowed to do.</p>
          <fieldset className="mt-6 space-y-2">
            <legend className="sr-only">User</legend>
            {users.map((u) => (
              <label key={u.username}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${who === u.username ? "border-enamel bg-enamel-soft/60" : "border-rule bg-sheet hover:border-ink/40"}`}>
                <input type="radio" name="user" value={u.username} checked={who === u.username}
                  onChange={() => setWho(u.username)} className="mt-1.5 accent-[#2445a8]" />
                <span>
                  <span className="font-bold">{u.name}</span>
                  <span className="text-mute">, {u.title}</span>
                  <span className="block text-[0.875rem] text-mute"><b className="capitalize text-ink">{u.role}</b>: {CAN[u.role]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="mt-5 block">
            <span className="text-[0.9375rem] font-semibold">Password</span>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password"
              className="mt-1 w-full rounded-lg border border-rule bg-sheet px-3 py-2.5 outline-none focus:border-enamel" />
            <span className="mt-1 block text-[0.8125rem] text-mute">Demo password is <code className="font-mono">sentinel</code> unless DEMO_PASSWORD is set.</span>
          </label>
          {err && <div className="mt-4"><ErrorNote text={err} /></div>}
          <Button type="submit" busy={busy} className="mt-6 w-full py-3">Sign in</Button>
        </form>
      </section>
    </main>
  );
}
