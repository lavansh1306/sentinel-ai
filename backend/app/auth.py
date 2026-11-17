"""Demo RBAC with signed, stateless bearer tokens.

Roles: viewer < responder < approver
  viewer    -> read only
  responder -> run triage, execute an already-approved action
  approver  -> approve / reject actions, kill switch, evaluation, resets
"""
import base64
import hashlib
import hmac
import time
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException

from .config import settings

USERS = {
    "alice": {"name": "Alice Rao", "role": "approver", "title": "SRE Lead"},
    "bob": {"name": "Bob Mehta", "role": "approver", "title": "On-call SRE"},
    "carol": {"name": "Carol Iyer", "role": "responder", "title": "Backend Engineer"},
    "dave": {"name": "Dave Singh", "role": "viewer", "title": "Product Manager"},
}
ROLE_RANK = {"viewer": 0, "responder": 1, "approver": 2}


@dataclass(frozen=True)
class User:
    username: str
    name: str
    role: str
    title: str

    def can(self, role: str) -> bool:
        return ROLE_RANK[self.role] >= ROLE_RANK[role]

    def public(self) -> dict:
        return {"username": self.username, "name": self.name, "role": self.role, "title": self.title}


def get_user(username: str) -> User | None:
    u = USERS.get(username)
    return User(username, u["name"], u["role"], u["title"]) if u else None


def _sign(body: str) -> str:
    return hmac.new(settings.secret_key.encode(), body.encode(), hashlib.sha256).hexdigest()


def issue_token(username: str) -> str:
    body = base64.urlsafe_b64encode(f"{username}|{int(time.time()) + settings.token_ttl_s}".encode()).decode()
    return f"{body}.{_sign(body)}"


def verify_token(token: str) -> User | None:
    try:
        body, sig = token.rsplit(".", 1)
        if not hmac.compare_digest(sig, _sign(body)):
            return None
        username, exp = base64.urlsafe_b64decode(body.encode()).decode().split("|")
        if int(exp) < time.time():
            return None
        return get_user(username)
    except Exception:
        return None


def login(username: str, password: str) -> User | None:
    user = get_user(username)
    if user and hmac.compare_digest(password, settings.demo_password):
        return user
    return None


def current_user(authorization: str = Header(default="")) -> User:
    token = authorization.removeprefix("Bearer ").strip()
    user = verify_token(token) if token else None
    if not user:
        raise HTTPException(401, "Sign in required")
    return user


def require(role: str):
    def dep(user: User = Depends(current_user)) -> User:
        if not user.can(role):
            raise HTTPException(403, f"Role '{user.role}' cannot do this (needs '{role}')")
        return user
    return dep
