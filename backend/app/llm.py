"""Thin client for a local Qwen model served by Ollama (structured JSON output)."""
import json
import re
import time

import httpx

from .config import settings

THINK = re.compile(r"<think>.*?</think>", re.S)


class LLMError(RuntimeError):
    pass


def chat_json(system: str, user: str, schema: dict) -> tuple[dict, dict]:
    """Returns (parsed_json, meta). Retries once if the model returns invalid JSON."""
    payload = {
        "model": settings.ollama_model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "format": schema,            # Ollama constrains decoding to this JSON schema
        "stream": False,
        "think": False,              # Qwen3: skip the hidden reasoning trace for latency
        "options": {"temperature": 0, "seed": 7, "num_ctx": settings.llm_num_ctx},
    }
    last_err = None
    for attempt in (1, 2):
        t0 = time.perf_counter()
        try:
            r = httpx.post(f"{settings.ollama_url}/api/chat", json=payload, timeout=settings.llm_timeout_s)
            r.raise_for_status()
            body = r.json()
            content = THINK.sub("", body["message"]["content"]).strip()
            data = json.loads(content)
            return data, {"latency_ms": int((time.perf_counter() - t0) * 1000), "attempts": attempt,
                          "prompt_tokens": body.get("prompt_eval_count"), "output_tokens": body.get("eval_count")}
        except (httpx.HTTPError, KeyError) as e:
            raise LLMError(f"Ollama unreachable or failed: {e}") from e
        except json.JSONDecodeError as e:
            last_err = e
    raise LLMError(f"Model returned invalid JSON twice: {last_err}")


def health() -> dict:
    try:
        r = httpx.get(f"{settings.ollama_url}/api/tags", timeout=3)
        names = [m["name"] for m in r.json().get("models", [])]
        return {"ok": True, "model": settings.ollama_model, "model_present": settings.ollama_model in names,
                "available": names}
    except Exception as e:
        return {"ok": False, "model": settings.ollama_model, "model_present": False, "error": str(e)}
