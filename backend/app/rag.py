"""Stage 4: retrieval over APPROVED runbooks only (Chroma, cosine similarity).

Runbooks are markdown files with YAML front matter. A runbook with
`approved: false` is never indexed, and approval is re-checked at query time.
"""
import re
import threading
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import chromadb
import yaml
from chromadb.utils.embedding_functions import DefaultEmbeddingFunction

from .config import settings

FRONT = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.S)
_lock = threading.Lock()
_client = None


@dataclass
class Runbook:
    id: str
    title: str
    root_cause: str
    version: int
    approved: bool
    approved_by: str | None
    approved_on: str | None
    target: str
    primary_action: str
    allowed_actions: list[str]
    body: str
    file: str

    def section(self, name: str) -> str:
        m = re.search(rf"## {name}\n(.*?)(?=\n## |\Z)", self.body, re.S)
        return m.group(1).strip() if m else ""

    def public(self, full: bool = False) -> dict:
        d = {k: getattr(self, k) for k in ("id", "title", "root_cause", "version", "approved", "approved_by",
                                           "approved_on", "target", "primary_action", "allowed_actions")}
        if full:
            d["body"] = self.body
        return d


def _parse(path: Path) -> Runbook:
    m = FRONT.match(path.read_text(encoding="utf-8"))
    if not m:
        raise ValueError(f"{path.name}: missing front matter")
    meta = yaml.safe_load(m.group(1))
    return Runbook(id=meta["id"], title=meta["title"], root_cause=meta["root_cause"], version=int(meta["version"]),
                   approved=bool(meta.get("approved")), approved_by=meta.get("approved_by"),
                   approved_on=str(meta["approved_on"]) if meta.get("approved_on") else None,
                   target=meta["target"], primary_action=meta["primary_action"],
                   allowed_actions=list(meta["allowed_actions"]), body=m.group(2).strip(), file=path.name)


@lru_cache(maxsize=1)
def catalog() -> dict:
    books = [_parse(p) for p in sorted(Path(settings.runbook_dir).glob("*.md"))]
    approved = [b for b in books if b.approved]
    return {"all": books, "by_id": {b.id: b for b in approved},
            "by_cause": {b.root_cause: b for b in approved}}


def runbook_for(root_cause: str) -> Runbook | None:
    return catalog()["by_cause"].get(root_cause)


def _embedder():
    return DefaultEmbeddingFunction()   # all-MiniLM-L6-v2 (ONNX), downloaded once, runs locally


def _collection():
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(path=settings.chroma_dir)
    return _client.get_or_create_collection(
        "approved_runbooks", embedding_function=_embedder(), configuration={"hnsw": {"space": "cosine"}})


def _doc_text(rb: Runbook) -> str:
    return f"{rb.title}\nSymptoms:\n{rb.section('Symptoms')}\nDiagnosis:\n{rb.section('Diagnosis')}"


def build_index() -> dict:
    with _lock:
        catalog.cache_clear()
        cat = catalog()
        col = _collection()
        approved = list(cat["by_id"].values())
        existing = set(col.get()["ids"])
        stale = existing - {b.id for b in approved}
        if stale:
            col.delete(ids=list(stale))
        col.upsert(ids=[b.id for b in approved], documents=[_doc_text(b) for b in approved],
                   metadatas=[{"root_cause": b.root_cause, "version": b.version} for b in approved])
        return {"indexed": len(approved), "skipped_unapproved": [b.id for b in cat["all"] if not b.approved]}


def index_size() -> int:
    try:
        return _collection().count()
    except Exception:
        return 0


def retrieve(query: str, k: int | None = None) -> list[dict]:
    col = _collection()
    if col.count() == 0:
        build_index()
    k = k or settings.retrieval_k
    res = col.query(query_texts=[query], n_results=k)
    approved = catalog()["by_id"]
    hits = []
    for rid, dist in zip(res["ids"][0], res["distances"][0]):
        rb = approved.get(rid)
        if not rb:                       # approval revoked after indexing -> never use it
            continue
        hits.append({"id": rb.id, "title": rb.title, "root_cause": rb.root_cause,
                     "similarity": round(max(0.0, 1 - float(dist)), 4),
                     "allowed_actions": rb.allowed_actions, "primary_action": rb.primary_action,
                     "version": rb.version, "approved_by": rb.approved_by})
    return hits
