from datetime import datetime

from sqlalchemy import (JSON, Boolean, DateTime, Float, ForeignKey, Integer, String,
                        Text, UniqueConstraint)
from sqlalchemy.dialects.mysql import MEDIUMTEXT
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base, utcnow

LongText = Text().with_variant(MEDIUMTEXT(), "mysql")


class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    service: Mapped[str] = mapped_column(String(64), index=True)
    severity: Mapped[str] = mapped_column(String(8))
    status: Mapped[str] = mapped_column(String(24), default="open", index=True)
    difficulty: Mapped[str] = mapped_column(String(8))
    adversarial: Mapped[bool] = mapped_column(Boolean, default=False)
    detected_at: Mapped[datetime] = mapped_column(DateTime)
    triage_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    logs: Mapped[str] = mapped_column(LongText)
    metrics: Mapped[dict] = mapped_column(JSON)
    context: Mapped[dict] = mapped_column(JSON)          # deps, deploy + config history
    env_state: Mapped[dict] = mapped_column(JSON)        # simulated live state
    initial_env: Mapped[dict] = mapped_column(JSON)      # for demo resets
    ground_truth: Mapped[dict] = mapped_column(JSON)     # hidden from the agent
    baseline_mttr_min: Mapped[float] = mapped_column(Float)


class TriageRun(Base):
    __tablename__ = "triage_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    incident_id: Mapped[str] = mapped_column(ForeignKey("incidents.id"), index=True)
    actor: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))      # completed | abstained | failed
    model: Mapped[str] = mapped_column(String(64))
    llm_ok: Mapped[bool] = mapped_column(Boolean, default=False)
    total_ms: Mapped[int] = mapped_column(Integer, default=0)
    llm_ms: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[str] = mapped_column(Text, default="")
    top3: Mapped[list] = mapped_column(JSON, default=list)
    result: Mapped[dict] = mapped_column(JSON, default=dict)   # full stage outputs
    trace: Mapped[list] = mapped_column(JSON, default=list)    # ordered stage events
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Action(Base):
    __tablename__ = "actions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    incident_id: Mapped[str] = mapped_column(ForeignKey("incidents.id"), index=True)
    triage_run_id: Mapped[int | None] = mapped_column(ForeignKey("triage_runs.id"), nullable=True)
    action_type: Mapped[str] = mapped_column(String(48))
    target: Mapped[str] = mapped_column(String(64))
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    rationale: Mapped[str] = mapped_column(Text, default="")
    runbook_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    risk: Mapped[str] = mapped_column(String(16))
    required_approvals: Mapped[int] = mapped_column(Integer, default=1)
    # blocked | pending_approval | approved | rejected | executing | succeeded
    # rolled_back | auto_executed | superseded
    status: Mapped[str] = mapped_column(String(24), index=True)
    policy: Mapped[dict] = mapped_column(JSON, default=dict)
    execution: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    executed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    executed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)


class Approval(Base):
    __tablename__ = "approvals"
    __table_args__ = (UniqueConstraint("action_id", "approver", name="uq_one_vote_per_approver"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    action_id: Mapped[int] = mapped_column(ForeignKey("actions.id"), index=True)
    approver: Mapped[str] = mapped_column(String(64))
    decision: Mapped[str] = mapped_column(String(8))     # approve | reject
    reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AuditEvent(Base):
    """Append-only, hash-chained trace log."""
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[str] = mapped_column(String(32))
    actor: Mapped[str] = mapped_column(String(64))
    event: Mapped[str] = mapped_column(String(64), index=True)
    incident_id: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    action_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload: Mapped[str] = mapped_column(Text)
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))


class EvalRun(Base):
    __tablename__ = "eval_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    status: Mapped[str] = mapped_column(String(16))      # running | completed | failed
    use_llm: Mapped[bool] = mapped_column(Boolean, default=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    metrics: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    per_incident: Mapped[list | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(String(255))
