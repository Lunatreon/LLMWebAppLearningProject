FROM python:3.13.14-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --system --gid 10001 feely \
    && useradd --system --uid 10001 --gid feely --no-create-home feely

COPY backend/ ./backend/
COPY migrations/ ./migrations/
COPY alembic.ini ./
COPY deployment/__init__.py deployment/entrypoint.py deployment/healthcheck.py ./deployment/
COPY scripts/database_migration.py ./scripts/
COPY --chown=10001:10001 prompts/ ./prompts/

USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=20s --timeout=10s --start-period=90s --retries=3 \
    CMD ["python", "-m", "deployment.healthcheck"]
ENTRYPOINT ["python", "-m", "deployment.entrypoint"]
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers", "--no-server-header", "--no-access-log"]
