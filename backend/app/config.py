"""Runtime settings. Everything is overridable with environment variables."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _float(name: str, default: float) -> float:
    return float(os.getenv(name, str(default)))


class Settings:
    database_url = os.getenv(
        "DATABASE_URL", "mysql+pymysql://sentinel:sentinel@localhost:3306/sentinel"
    )

    # Local LLM (Ollama)
    ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
    ollama_model = os.getenv("OLLAMA_MODEL", "qwen3:4b")
    llm_timeout_s = _float("LLM_TIMEOUT_S", 180)
    llm_num_ctx = int(os.getenv("LLM_NUM_CTX", "8192"))

    # Retrieval
    chroma_dir = os.getenv("CHROMA_DIR", str(BASE_DIR / "chroma_data"))
    runbook_dir = BASE_DIR / "data" / "runbooks"
    incidents_file = BASE_DIR / "data" / "incidents.json"
    reports_dir = BASE_DIR / "reports"
    retrieval_k = 4

    # Ensemble weights (LLM, retrieval, deterministic signals) and abstention
    w_llm = _float("W_LLM", 0.50)
    w_retrieval = _float("W_RETRIEVAL", 0.25)
    w_signal = _float("W_SIGNAL", 0.25)
    abstain_below = _float("ABSTAIN_BELOW", 0.35)

    # Auth (demo RBAC)
    secret_key = os.getenv("SECRET_KEY", "dev-only-change-me")
    demo_password = os.getenv("DEMO_PASSWORD", "sentinel")
    token_ttl_s = int(os.getenv("TOKEN_TTL_S", str(8 * 3600)))
    cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")]

    # Simulator + evaluation
    exec_step_delay_s = _float("EXEC_STEP_DELAY_S", 0.35)
    eval_review_delay_s = _float("EVAL_REVIEW_DELAY_S", 120)


settings = Settings()
