"use client";
import { motion } from "framer-motion";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { STATUS_LABEL } from "@/lib/api";

export type Tone = "idle" | "run" | "clear" | "caution" | "danger" | "enamel";

const LAMP: Record<Tone, string> = {
  idle: "bg-rule", run: "bg-enamel", clear: "bg-clear", caution: "bg-caution", danger: "bg-danger", enamel: "bg-enamel",
};

export const STATUS_TONE: Record<string, Tone> = {
  open: "idle", triaging: "run", awaiting_approval: "caution", executing: "run", resolved: "clear", needs_human: "danger",
  pending_approval: "caution", approved: "enamel", rejected: "danger", blocked: "danger", succeeded: "clear",
  rolled_back: "caution", auto_executed: "idle", superseded: "idle",
};

export function Lamp({ tone, size = 10, pulse = false, label }: { tone: Tone; size?: number; pulse?: boolean; label?: string }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} aria-label={label} role={label ? "img" : undefined}>
      {pulse && <span className={`absolute inset-0 rounded-full ${LAMP[tone]} animate-ping opacity-60`} />}
      <span className={`relative inline-block rounded-full ${LAMP[tone]}`} style={{ width: size, height: size }} />
    </span>
  );
}

const PILL: Record<Tone, string> = {
  idle: "bg-paper text-mute border-rule",
  run: "bg-enamel-soft text-enamel-deep border-enamel/30",
  clear: "bg-clear-soft text-clear-ink border-clear/30",
  caution: "bg-caution-soft text-caution-ink border-caution/40",
  danger: "bg-danger-soft text-danger-ink border-danger/30",
  enamel: "bg-enamel-soft text-enamel-deep border-enamel/30",
};

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.8125rem] font-semibold leading-5 ${PILL[tone]}`}>
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "idle";
  return <Pill tone={tone}><Lamp tone={tone} size={7} />{STATUS_LABEL[status] ?? status}</Pill>;
}

const SEV: Record<string, Tone> = { SEV1: "danger", SEV2: "caution", SEV3: "idle" };
export function Severity({ sev }: { sev: string }) {
  return <Pill tone={SEV[sev] ?? "idle"}>{sev}</Pill>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "clear"; busy?: boolean };
export function Button({ variant = "primary", busy, className = "", children, disabled, ...rest }: BtnProps) {
  const v = {
    primary: "bg-enamel text-white hover:bg-enamel-deep",
    ghost: "bg-transparent text-ink border border-rule hover:border-ink",
    danger: "bg-danger text-white hover:bg-danger-ink",
    clear: "bg-clear text-white hover:bg-clear-ink",
  }[variant];
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-[0.9375rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${v} ${className}`}
    >
      {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function StationHeader({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <header className="mb-8 flex items-start gap-4">
      <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[3px] border-ink bg-sheet text-[0.9375rem] font-extrabold">
        {n}
      </span>
      <div>
        <h2 className="text-[2rem] font-extrabold leading-tight tracking-[-0.01em] sm:text-[2.25rem]">{title}</h2>
        {children && <p className="mt-1 max-w-[62ch] text-mute">{children}</p>}
      </div>
    </header>
  );
}

export function Meter({ value, tone = "enamel", height = 8 }: { value: number; tone?: Tone; height?: number }) {
  return (
    <span className="block w-full overflow-hidden rounded-full bg-paper" style={{ height }}>
      <motion.span
        className={`block h-full rounded-full ${LAMP[tone]}`}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        transition={{ duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}
      />
    </span>
  );
}

export function Sparkline({ values, tone = "enamel", height = 36 }: { values: number[]; tone?: Tone; height?: number }) {
  const w = 120;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${height - 3 - ((v - min) / span) * (height - 6)}`).join(" ");
  const stroke = { idle: "#8a95a6", run: "#2445a8", clear: "#2e9e5b", caution: "#c98a0c", danger: "#d2362b", enamel: "#2445a8" }[tone];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-rule px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-[52ch] text-[0.9375rem] text-mute">{children}</p>}
    </div>
  );
}

export function ErrorNote({ text }: { text: string }) {
  return <p className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[0.9375rem] text-danger-ink">{text}</p>;
}
