#!/bin/bash
set -e

# ============================================================================
# A2A Scaffold — Start Script
#
# Usage:
#   ./start.sh              # Auto-detect: Docker if available, else local
#   ./start.sh docker       # Force Docker mode
#   ./start.sh local        # Force local mode (requires Python 3.13+ & Node 20+)
#   ./start.sh dev          # Dev mode: frontend dev server + Python backend
# ============================================================================

# Resolve script directory (works from any CWD)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${CYAN}[a2a]${NC} $1"; }
ok()   { echo -e "${GREEN}[a2a]${NC} $1"; }
warn() { echo -e "${YELLOW}[a2a]${NC} $1"; }
err()  { echo -e "${RED}[a2a]${NC} $1" >&2; }

# Create .env from template if not exists
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  cp -n "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env" 2>/dev/null || true
  warn ".env created from template — edit it with your credentials."
fi

# Load .env
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a; source "$SCRIPT_DIR/.env" 2>/dev/null; set +a
fi

print_banner() {
  echo ""
  echo -e "${CYAN}⚡ A2A Scaffold${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "📝 Agent config:  ${GREEN}AGENT.md${NC}"
  echo -e "🛠  Skills:        ${GREEN}agent-config/skills/${NC}"
  echo -e "🔧 MCP tools:     ${GREEN}agent-config/mcp.json${NC}"
  echo ""
}

# ── Local paths (all relative to SCRIPT_DIR) ─────────────────────────────────

LOCAL_DATA_DIR="$SCRIPT_DIR/.data"
LOCAL_STATIC_DIR="$SCRIPT_DIR/frontend/dist/scaffold"

setup_local_env() {
  # Create local data directory (replaces Docker's /agent/data)
  mkdir -p "$LOCAL_DATA_DIR/uploads"
  mkdir -p "$SCRIPT_DIR/agent-config/skills"

  # Copy AGENT.md to config dir if it exists at root
  if [ -f "$SCRIPT_DIR/AGENT.md" ]; then
    cp "$SCRIPT_DIR/AGENT.md" "$SCRIPT_DIR/agent-config/AGENT.md"
  fi

  # Export env vars pointing to local paths
  export CONFIG_PATH="$SCRIPT_DIR/configs/config.yaml"
  export SKILLS_DIR="$SCRIPT_DIR/agent-config/skills"
  export MCP_CONFIG="$SCRIPT_DIR/agent-config/mcp.json"
  export AGENT_MD_PATH="$SCRIPT_DIR/agent-config/AGENT.md"
  export STATIC_DIR="$LOCAL_STATIC_DIR"

  # Override /agent/data with local writable directory
  export AGENT_DATA_DIR="$LOCAL_DATA_DIR"
}

# ── Docker mode ──────────────────────────────────────────────────────────────

start_docker() {
  log "Starting with Docker..."
  docker compose up --build
}

# ── Python setup ─────────────────────────────────────────────────────────────

check_python() {
  if command -v python3 &>/dev/null; then
    PYTHON=python3
  elif command -v python &>/dev/null; then
    PYTHON=python
  else
    err "Python 3.13+ is required. Install: https://www.python.org/downloads/"
    exit 1
  fi
  log "Python: $($PYTHON --version 2>&1 | awk '{print $2}') ($PYTHON)"
}

setup_venv() {
  local venv_dir="$SCRIPT_DIR/.venv"
  if [ ! -d "$venv_dir" ]; then
    log "Creating Python virtual environment..."
    $PYTHON -m venv "$venv_dir"
  fi
  source "$venv_dir/bin/activate"

  # Only install if requirements changed (compare hash)
  local req_hash=$(md5sum "$SCRIPT_DIR/requirements.txt" 2>/dev/null | awk '{print $1}' || md5 -q "$SCRIPT_DIR/requirements.txt" 2>/dev/null)
  local cached_hash=""
  [ -f "$venv_dir/.req_hash" ] && cached_hash=$(cat "$venv_dir/.req_hash")

  if [ "$req_hash" != "$cached_hash" ]; then
    log "Installing Python dependencies..."
    pip install --quiet -r "$SCRIPT_DIR/requirements.txt"
    pip install --quiet -e "$SCRIPT_DIR"
    echo "$req_hash" > "$venv_dir/.req_hash"
    ok "Python dependencies installed"
  else
    log "Python dependencies up to date (cached)"
  fi
}

# ── Frontend build ───────────────────────────────────────────────────────────

check_node() {
  if ! command -v node &>/dev/null; then
    err "Node.js 20+ is required. Install: https://nodejs.org/"
    exit 1
  fi
  log "Node.js: $(node -v)"
}

ensure_node_modules() {
  cd "$SCRIPT_DIR/frontend"
  # Check if node_modules exists AND platform binaries work
  if [ -d "node_modules" ]; then
    if node -e "require('lightningcss')" 2>/dev/null; then
      log "node_modules OK (cached)"
      cd "$SCRIPT_DIR"
      return
    fi
    warn "node_modules has wrong platform binaries, reinstalling..."
    rm -rf node_modules
  fi
  log "Installing frontend dependencies..."
  npm install --legacy-peer-deps
  ok "Frontend dependencies installed"
  cd "$SCRIPT_DIR"
}

build_frontend() {
  # Skip if already built and source hasn't changed
  if [ -f "$LOCAL_STATIC_DIR/index.html" ]; then
    local src_newest=$(find "$SCRIPT_DIR/frontend/src" -type f -newer "$LOCAL_STATIC_DIR/index.html" 2>/dev/null | head -1)
    if [ -z "$src_newest" ]; then
      log "Frontend already built (cached)"
      return
    fi
    log "Frontend source changed, rebuilding..."
  else
    log "Building frontend..."
  fi

  cd "$SCRIPT_DIR/frontend"
  ensure_node_modules
  # Use project-local vite (not npx global) to avoid version mismatch
  ./node_modules/.bin/vite build --config vite.config.scaffold.ts
  # Rename entry HTML
  mv "$LOCAL_STATIC_DIR/a2a-scaffold.html" "$LOCAL_STATIC_DIR/index.html" 2>/dev/null || true
  cd "$SCRIPT_DIR"
  ok "Frontend built → frontend/dist/scaffold/"
}

# ── Local mode ───────────────────────────────────────────────────────────────

start_local() {
  log "Starting locally (no Docker)..."

  check_python
  setup_venv
  check_node
  build_frontend
  setup_local_env

  ok "Starting A2A server on http://localhost:8080"
  echo ""
  exec $PYTHON -m agentx.server.main
}

# ── Dev mode ─────────────────────────────────────────────────────────────────

start_dev() {
  log "Starting in dev mode..."

  check_python
  check_node
  setup_venv
  setup_local_env

  cd "$SCRIPT_DIR/frontend"
  ensure_node_modules
  cd "$SCRIPT_DIR"

  # Start Python backend in background
  log "Starting Python backend on :8080..."
  $PYTHON -m agentx.server.main &
  BACKEND_PID=$!

  # Start Vite dev server with proxy
  log "Starting frontend dev server on :5173..."
  cd "$SCRIPT_DIR/frontend"
  ensure_node_modules
  ./node_modules/.bin/vite --config vite.config.scaffold.ts --port 5173 &
  FRONTEND_PID=$!
  cd "$SCRIPT_DIR"

  ok "Dev server running:"
  ok "  Frontend: http://localhost:5173  (HMR)"
  ok "  Backend:  http://localhost:8080"
  echo ""

  trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
  wait
}

# ── Main ─────────────────────────────────────────────────────────────────────

print_banner

MODE="${1:-auto}"

case "$MODE" in
  docker)
    start_docker
    ;;
  local)
    start_local
    ;;
  dev)
    start_dev
    ;;
  auto)
    if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
      start_docker
    else
      warn "Docker not available, falling back to local mode."
      start_local
    fi
    ;;
  *)
    echo "Usage: ./start.sh [docker|local|dev|auto]"
    echo ""
    echo "  docker  — Build and run with Docker Compose"
    echo "  local   — Run directly with Python + Node.js (no Docker)"
    echo "  dev     — Dev mode: Vite dev server (HMR) + Python backend"
    echo "  auto    — Docker if available, else local (default)"
    exit 1
    ;;
esac
