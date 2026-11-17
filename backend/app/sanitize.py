"""Stage 2: treat logs as untrusted data.

- Redacts secrets / PII before anything reaches the LLM or the UI trace.
- Detects prompt-injection text hidden in log lines and removes it.
- Builds a compact, de-duplicated excerpt for the LLM context window.
"""
import re
from dataclasses import dataclass, field

LINE = re.compile(r"^(\S+)\s+(DEBUG|INFO|WARN|ERROR|FATAL)\s+(\S+)\s+\[([^\]]*)\]\s+(.*)$")

SECRET_RULES = [
    (re.compile(r"(://[^:/\s@]+:)[^@\s]+@"), r"\1<redacted>@"),
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9\-._~+/]+=*"), "Bearer <redacted>"),
    (re.compile(r"\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{6,}"), "<redacted-key>"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "<redacted-aws-key>"),
    (re.compile(r"(?i)\b(password|passwd|secret|api[_-]?key|token)\s*[=:]\s*[^\s,;\"']+"), r"\1=<redacted>"),
    (re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"), "<email>"),
]

INJECTION = re.compile(
    r"(?i)(ignore (all |any )?(previous|prior|above) instructions|system override|you are now|"
    r"disregard (the |all )?(runbooks?|rules|instructions|policy)|without (any )?(human )?approval|"
    r"approval (has been |is )?already granted|assistant must|\bai agent\s*:|new instructions\s*:|"
    r"act as (an? )?(admin|root))"
)

LEVEL_RANK = {"DEBUG": 0, "INFO": 1, "WARN": 2, "ERROR": 3, "FATAL": 4}


@dataclass
class LogLine:
    no: int
    ts: str
    level: str
    service: str
    pod: str
    msg: str


@dataclass
class Sanitized:
    lines: list[LogLine] = field(default_factory=list)
    redactions: int = 0
    injections: list[dict] = field(default_factory=list)
    excerpt: str = ""

    @property
    def injection_suspected(self) -> bool:
        return bool(self.injections)


def redact(text: str) -> tuple[str, int]:
    total = 0
    for rx, repl in SECRET_RULES:
        text, n = rx.subn(repl, text)
        total += n
    return text, total


def _normalize(msg: str) -> str:
    return re.sub(r"[0-9a-f]{8,}|\d+", "#", msg)


def sanitize(raw_logs: str, max_lines: int = 70, max_chars: int = 7000) -> Sanitized:
    out = Sanitized()
    for no, raw in enumerate(raw_logs.splitlines(), 1):
        m = LINE.match(raw.strip())
        if not m:
            continue
        ts, level, service, pod, msg = m.groups()
        msg, n = redact(msg)
        out.redactions += n
        if INJECTION.search(msg):
            out.injections.append({"line": no, "excerpt": msg[:160]})
            msg = "[REMOVED: suspected prompt injection inside log data]"
        out.lines.append(LogLine(no, ts, level, service, pod, msg))

    # Excerpt: every WARN+ line (collapsing repeats) plus a little INFO context.
    seen: dict[str, list] = {}
    for ln in out.lines:
        if LEVEL_RANK[ln.level] >= 2:
            key = _normalize(ln.msg)
            if key in seen:
                seen[key][1] += 1
            else:
                seen[key] = [ln, 1]
    important = sorted(seen.values(), key=lambda x: x[0].no)
    change_events = [ln for ln in out.lines if ln.pod in ("deployer", "config-sync")]
    info = [ln for ln in out.lines if LEVEL_RANK[ln.level] < 2 and ln not in change_events]
    context = info[:3] + change_events + info[-3:]

    rows = [(ln.no, f"{ln.ts} {ln.level} [{ln.pod}] {ln.msg}" + (f"  (x{c})" if c > 1 else ""))
            for ln, c in important]
    rows += [(ln.no, f"{ln.ts} {ln.level} [{ln.pod}] {ln.msg}") for ln in context]
    rows = sorted(dict(rows).items())[:max_lines]
    out.excerpt = "\n".join(r for _, r in rows)[:max_chars]
    return out
