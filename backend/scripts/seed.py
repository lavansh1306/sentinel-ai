"""Create tables, load the 60 synthetic incidents, index approved runbooks.

    python -m scripts.seed            # create + load (skips if already loaded)
    python -m scripts.seed --reset    # drop everything and reload
"""
import argparse
import json
import time
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError

from app import audit, rag
from app.config import settings
from app.db import Base, SessionLocal, engine
from app.models import Incident
from data.generate_incidents import OUT, generate


def wait_for_db(tries: int = 30):
    for i in range(tries):
        try:
            with engine.connect():
                return
        except OperationalError:
            print(f"waiting for database ({i + 1}/{tries})...")
            time.sleep(2)
    raise SystemExit("database not reachable")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true")
    args = ap.parse_args()

    wait_for_db()
    if args.reset:
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)

    db = SessionLocal()
    try:
        if db.execute(select(func.count()).select_from(Incident)).scalar():
            print("incidents already loaded, skipping (use --reset to reload)")
        else:
            if not OUT.exists():
                OUT.write_text(json.dumps(generate(), indent=1))
            data = json.loads(OUT.read_text())
            for d in data:
                db.add(Incident(
                    id=d["id"], title=d["title"], service=d["service"], severity=d["severity"], status="open",
                    difficulty=d["difficulty"], adversarial=d["adversarial"],
                    detected_at=datetime.strptime(d["detected_at"], "%Y-%m-%dT%H:%M:%SZ"),
                    logs=d["logs"], metrics=d["metrics"], context=d["context"], env_state=d["env_state"],
                    initial_env=d["env_state"], ground_truth=d["ground_truth"], baseline_mttr_min=d["baseline_mttr_min"]))
            audit.record(db, "system", "system.seeded", payload={"incidents": len(data)})
            print(f"loaded {len(data)} incidents")
        idx = rag.build_index()
        print(f"indexed {idx['indexed']} approved runbooks; skipped unapproved: {idx['skipped_unapproved']}")
        print(f"chroma store: {settings.chroma_dir}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
