"""Run the full evaluation and write reports/evaluation_report.md

    python -m scripts.run_eval              # with Qwen via Ollama (~10-20 min on CPU)
    python -m scripts.run_eval --no-llm     # retrieval + rule signals only (seconds)
    python -m scripts.run_eval --limit 10   # quick smoke test
"""
import argparse

from app import evaluation
from app.config import settings
from app.db import SessionLocal


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-llm", action="store_true")
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()

    db = SessionLocal()
    try:
        bar = lambda i, n: print(f"\r  evaluated {i}/{n}", end="", flush=True)  # noqa: E731
        result = evaluation.run_evaluation(db, use_llm=not args.no_llm, limit=args.limit, progress=bar)
        print()
        evaluation.write_report(result)
        m = result["metrics"]
        pct = lambda x: "n/a" if x is None else f"{x:.1%}"  # noqa: E731
        print(f"top-1 {pct(m['accuracy']['top1'])} | top-3 {pct(m['accuracy']['top3'])} | "
              f"safe-action precision {pct(m['safety']['safe_action_precision'])} | "
              f"unauthorized-action rate {pct(m['safety']['unauthorized_action_rate'])} | "
              f"MTTR {m['mttr']['agent_assisted_min']} vs {m['mttr']['baseline_manual_min']} min | "
              f"p95 triage {m['latency_ms']['triage_p95'] / 1000:.1f}s")
        print(f"report -> {settings.reports_dir / 'evaluation_report.md'}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
