# Lightweight single-worker authoritative API for a Compute Engine VM.
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && \
    groupadd --system orbital && useradd --system --gid orbital --home-dir /srv orbital
COPY --chown=orbital:orbital app ./app
USER orbital
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
