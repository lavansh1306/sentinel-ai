"use client";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { useEffect, useState } from "react";

export const STATIONS = [
  { id: "overview", label: "Overview" },
  { id: "queue", label: "Incident queue" },
  { id: "triage", label: "Triage line" },
  { id: "gate", label: "Approval gate" },
  { id: "execution", label: "Execution" },
  { id: "trace", label: "Trace log" },
  { id: "evaluation", label: "Evaluation" },
];

/** Line map: the train rides the page scroll between stations. */
export function LineRail({ badges = {} }: { badges?: Record<string, number> }) {
  const reduce = useReducedMotion();
  const pos = useMotionValue(0);                       // 0 .. STATIONS.length-1
  const smooth = useSpring(pos, { stiffness: 220, damping: 32, mass: 0.6 });
  const [active, setActive] = useState(0);
  const last = STATIONS.length - 1;
  const top = useTransform(reduce ? pos : smooth, (v) => `${(v / last) * 100}%`);
  const left = useTransform(reduce ? pos : smooth, (v) => `${(v / last) * 100}%`);

  useEffect(() => {
    const update = () => {
      // a section counts as "arrived" when its top reaches the header line
      const probe = window.scrollY + 1;
      const tops = STATIONS.map((s, i) => {
        const el = document.getElementById(s.id);
        return i === 0 ? 0 : el ? el.getBoundingClientRect().top + window.scrollY - 72 : Infinity;
      });
      let i = 0;
      while (i < last && probe >= tops[i + 1]) i++;
      const span = (tops[i + 1] ?? tops[i] + 1) - tops[i];
      const frac = i === last ? 0 : Math.min(1, Math.max(0, (probe - tops[i]) / span));
      pos.set(i + frac);
      setActive(frac > 0.5 && i < last ? i + 1 : i);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, [pos, last]);

  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });

  return (
    <>
      {/* desktop: vertical line map */}
      <nav aria-label="Console sections" className="fixed left-0 top-16 bottom-0 z-30 hidden w-60 border-r border-rule bg-paper/90 backdrop-blur lg:block">
        <div className="relative mx-8 my-14 h-[calc(100%-7rem)] max-h-[560px]">
          <div className="absolute left-[7px] top-0 h-full w-[3px] rounded bg-rule" />
          <motion.div className="absolute left-[7px] top-0 w-[3px] rounded bg-ink" style={{ height: top }} />
          {STATIONS.map((s, i) => {
            const on = i === active;
            const passed = i < active;
            return (
              <button
                key={s.id}
                onClick={() => go(s.id)}
                aria-current={on ? "true" : undefined}
                className="group absolute left-0 flex -translate-y-1/2 items-center gap-3 text-left"
                style={{ top: `${(i / last) * 100}%` }}
              >
                <span className={`block h-[17px] w-[17px] rounded-full border-[3px] transition-colors ${on || passed ? "border-ink bg-ink" : "border-ink bg-paper"} ${on ? "ring-4 ring-enamel/20" : ""}`} />
                <span className={`text-[0.9375rem] transition-colors ${on ? "font-bold text-ink" : "text-mute group-hover:text-ink"}`}>
                  {s.label}
                </span>
                {!!badges[s.id] && (
                  <span className="rounded-full bg-caution px-1.5 text-[0.75rem] font-bold leading-5 text-ink">{badges[s.id]}</span>
                )}
              </button>
            );
          })}
          <motion.span
            aria-hidden
            className="pointer-events-none absolute -left-[3px] h-[25px] w-[25px] -translate-y-1/2 rounded-full border-[3px] border-paper bg-enamel shadow-[0_0_0_3px_rgb(36_69_168/0.25)]"
            style={{ top }}
          />
        </div>
      </nav>

      {/* mobile: horizontal line */}
      <nav aria-label="Console sections" className="fixed inset-x-0 top-14 z-30 border-b border-rule bg-paper/95 px-5 pb-2 pt-3 backdrop-blur lg:hidden">
        <div className="relative mx-2 h-4">
          <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded bg-rule" />
          {STATIONS.map((s, i) => (
            <button
              key={s.id}
              onClick={() => go(s.id)}
              aria-label={s.label}
              className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-ink ${i <= active ? "bg-ink" : "bg-paper"}`}
              style={{ left: `${(i / last) * 100}%` }}
            />
          ))}
          <motion.span aria-hidden className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-paper bg-enamel" style={{ left }} />
        </div>
        <p className="mt-1.5 text-center text-[0.8125rem] font-semibold">{STATIONS[active].label}</p>
      </nav>
    </>
  );
}
