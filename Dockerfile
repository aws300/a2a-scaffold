# ============================================================================
# A2A Scaffold — Self-contained Docker build
# Build: docker build -t a2a-scaffold .
# Run:   docker run -p 8080:8080 --env-file .env a2a-scaffold
# ============================================================================

# Stage 1: Build frontend SPA
FROM node:20-slim AS frontend-builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY frontend/ .
RUN npx vite build --config vite.config.scaffold.ts

# Stage 2: Build Python backend
FROM python:3.13-slim AS backend-builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends gcc g++ make \
    && rm -rf /var/lib/apt/lists/*
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY pyproject.toml ./
COPY src/ src/
RUN pip install --no-cache-dir .

# Stage 3: Runtime
FROM python:3.13-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

# Python venv from builder
COPY --from=backend-builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Frontend static files (served by Python ASGI)
COPY --from=frontend-builder /app/dist/scaffold /usr/share/nginx/html
RUN mv /usr/share/nginx/html/a2a-scaffold.html /usr/share/nginx/html/index.html 2>/dev/null || true

# Create non-root user
RUN groupadd -g 1000 core && useradd -m -u 1000 -g 1000 -s /bin/bash core

# Agent data + config directories
RUN mkdir -p /agent/data /agent/config/skills && chown -R core:core /agent/data /agent/config

# Default config
COPY configs/config.yaml /home/core/config.yaml
COPY agent-config/ /agent/config/
RUN chown -R core:core /home/core /agent/config

# Git config
RUN git config --global --add safe.directory '*' && \
    git config --global init.defaultBranch main && \
    git config --global user.name "A2A Agent" && \
    git config --global user.email "agent@a2a-scaffold.local"

EXPOSE 8080

CMD ["agentx-server"]
