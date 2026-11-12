"use client";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useRef, type ReactNode } from "react";

/** A full-height "page". Scroll position drives its entry and exit, so moving
 *  through the console feels like turning pages along the line. */
export function Section({ id, children, tone = "paper" }: { id: string; children: ReactNode; tone?: "paper" | "sheet" }) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress: enter } = useScroll({ target: ref, offset: ["start end", "start 30%"] });
  const { scrollYProgress: exit } = useScroll({ target: ref, offset: ["end 60%", "end start"] });
  const opacity = useTransform(() => Math.min(0.2 + enter.get() * 0.8, 1 - exit.get() * 0.8));
  const scale = useTransform(() => 0.94 + enter.get() * 0.06 - exit.get() * 0.04);
  const y = useTransform(enter, [0, 1], [56, 0]);

  return (
    <section
      id={id}
      ref={ref}
      className={`snap-section relative min-h-screen px-5 pb-24 pt-36 sm:px-10 lg:pl-72 lg:pr-12 lg:pt-28 ${tone === "sheet" ? "bg-sheet" : ""}`}
    >
      <motion.div style={reduce ? undefined : { opacity, scale, y }} className="mx-auto max-w-6xl origin-top">
        {children}
      </motion.div>
    </section>
  );
}
