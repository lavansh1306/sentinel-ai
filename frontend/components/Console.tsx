"use client";
import { AnimatePresence, motion } from "framer-motion";
import { StoreProvider, useApi, useStore } from "@/lib/store";
import { LineRail } from "./LineRail";
import { LoginScreen } from "./LoginScreen";
import { Section } from "./Section";
import { TopBar } from "./TopBar";
import { Evaluation } from "./sections/Evaluation";
import { Execution } from "./sections/Execution";
import { Gate } from "./sections/Gate";
import { Overview, type Stats } from "./sections/Overview";
import { Queue } from "./sections/Queue";
import { Trace } from "./sections/Trace";
import { Triage } from "./sections/Triage";

function Shell() {
  const { user, ready } = useStore();
  if (!ready) return <div className="grid min-h-screen place-items-center text-mute">Loading console</div>;
  if (!user) return <LoginScreen />;
  return <Authed />;
}

function Authed() {
  const { data: stats } = useApi<Stats>("/api/stats", { poll: 5000 });
  return (
    <>
      <TopBar />
      <LineRail badges={{ gate: stats?.pending_approvals ?? 0 }} />
      <main>
        <Section id="overview"><Overview stats={stats} /></Section>
        <Section id="queue" tone="sheet"><Queue /></Section>
        <Section id="triage"><Triage /></Section>
        <Section id="gate" tone="sheet"><Gate /></Section>
        <Section id="execution"><Execution /></Section>
        <Section id="trace" tone="sheet"><Trace /></Section>
        <Section id="evaluation"><Evaluation /></Section>
      </main>
      <Toasts />
    </>
  );
}

function Toasts() {
  const { toasts } = useStore();
  const tone = { ok: "border-clear bg-sheet", warn: "border-caution bg-caution-soft", error: "border-danger bg-danger-soft" };
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }}
            className={`pointer-events-auto rounded-xl border-l-4 px-4 py-3 text-[0.9375rem] shadow-lg ${tone[t.tone]}`}>
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export default function Console() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
