FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
EXPOSE 8000

# create tables + load incidents, then serve while runbook indexing runs in the background
CMD ["sh", "-c", "python -m scripts.seed --skip-index && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
