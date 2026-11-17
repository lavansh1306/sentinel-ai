"""Tamper-evident trace log.

Every event stores sha256(prev_hash + canonical_body). Editing or deleting any
row breaks the chain from that point on, and /api/audit/verify finds it.
"""
import hashlib
import json
import threading

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import utcnow
from .models import AuditEvent

GENESIS = "0" * 64
_lock = threading.Lock()


def _canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _body(ts, actor, event, incident_id, action_id, payload: str) -> str:
    return _canonical({"ts": ts, "actor": actor, "event": event,
                       "incident_id": incident_id, "action_id": action_id, "payload": payload})


def _hash(prev: str, body: str) -> str:
    return hashlib.sha256((prev + body).encode()).hexdigest()


def record(db: Session, actor: str, event: str, incident_id: str | None = None,
           action_id: int | None = None, payload: dict | None = None) -> AuditEvent:
    """Append an event and COMMIT the session, so state change + audit land atomically."""
    with _lock:
        # FOR UPDATE = read the latest committed head, not this transaction's
        # (possibly old) snapshot, so a long triage run can never fork the chain.
        prev = db.execute(select(AuditEvent.hash).order_by(AuditEvent.id.desc()).limit(1)
                          .with_for_update()).scalar() or GENESIS
        ts = utcnow().isoformat(timespec="microseconds") + "Z"
        payload_s = _canonical(payload or {})
        ev = AuditEvent(ts=ts, actor=actor, event=event, incident_id=incident_id, action_id=action_id,
                        payload=payload_s, prev_hash=prev,
                        hash=_hash(prev, _body(ts, actor, event, incident_id, action_id, payload_s)))
        db.add(ev)
        db.commit()
        return ev


def verify_rows(rows) -> dict:
    prev = GENESIS
    for i, ev in enumerate(rows):
        expected = _hash(prev, _body(ev.ts, ev.actor, ev.event, ev.incident_id, ev.action_id, ev.payload))
        if ev.prev_hash != prev or ev.hash != expected:
            return {"ok": False, "checked": i, "broken_at": ev.id,
                    "reason": "prev_hash mismatch" if ev.prev_hash != prev else "content hash mismatch"}
        prev = ev.hash
    return {"ok": True, "checked": len(rows), "head": prev}


def verify(db: Session) -> dict:
    return verify_rows(db.execute(select(AuditEvent).order_by(AuditEvent.id)).scalars().all())


def to_dict(ev: AuditEvent) -> dict:
    return {"id": ev.id, "ts": ev.ts, "actor": ev.actor, "event": ev.event,
            "incident_id": ev.incident_id, "action_id": ev.action_id,
            "payload": json.loads(ev.payload), "prev_hash": ev.prev_hash, "hash": ev.hash}
