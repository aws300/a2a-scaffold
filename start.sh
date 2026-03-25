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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${CYAN}[a2a]${NC} $1"; }
ok()   { echo -e "${GREEN}[a2a]${NC} $1"; }
warn() { echo -e "${YELLOW}[a2a]${NC} $1"; }
err()  { echo -e "${RED}[a2a]${NC} $1" >&2; }

# Create .env from template if not exists
if [ ! -f .env ]; then
  cp -n .env.example .env 2>/dev/null || true
  warn ".env created from template — edit it with your credentials before starting."
fi

# Load .env
if [ -f .env ]; then
  set -a; source .env 2>/dev/null; set +a
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

# ── Docker mode ──────────────────────────────────────────────────────────────

start_docker() {
  log "Starting with Docker..."
  docker compose up --build
}

# ── Local mode ───────────────────────────────────────────────────────────────

check_python() {
  if command -v python3 &>/dev/null; then
    PYTHON=python3
  elif command -v python &>/dev/null; then
    PYTHON=python
  else
    err "Python 3.13+ is required but not found."
    err "Install: https://www.python.org/downloads/"
    exit 1
  fi

  local ver=$($PYTHON -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
  log "Python: $ver ($PYTHON)"
}

check_node() {
  if ! command -v node &>/dev/null; then
    err "Node.js 20+ is required but not found."
    err "Install: https://nodejs.org/"
    exit 1
  fi
  local ver=$(node -v)
  log "Node.js: $ver"
}

setup_venv() {
  if [ ! -d ".venv" ]; then
    log "Creating Python virtual environment..."
    $PYTHON -m venv .venv
  fi
  source .venv/bin/activate
  log "Installing Python dependencies..."
  pip install --quiet -r requirements.txt
  pip install --quiet -e .
}

build_frontend() {
  if [ ! -f "frontend/dist/scaffold/index.html" ]; then
    log "Building frontend..."
    cd frontend
    # Ensure node_modules has correct platform binaries
    # (lightningcss/esbuild have platform-specific native modules)
    if [ -d "node_modules" ] && ! node -e "require('lightningcss')" 2>/dev/null; then
      warn "node_modules has wrong platform binaries, reinstalling..."
      rm -rf node_modules
    fi
    if [ ! -d "node_modules" ]; then
      npm install --legacy-peer-deps
    fi
    npx vite build --config vite.config.scaffold.ts
    cd ..
    ok "Frontend built → frontend/dist/scaffold/"
  else
    log "Frontend already built (frontend/dist/scaffold/index.html exists)"
  fi

  # Copy to where the Python server expects it
  mkdir -p /tmp/a2a-scaffold-static
  cp -r frontend/dist/scaffold/* /tmp/a2a-scaffold-static/
  # Rename entry HTML
  mv /tmp/a2a-scaffold-static/a2a-scaffold.html /tmp/a2a-scaffold-static/index.html 2>/dev/null || true
}

start_local() {
  log "Starting locally (no Docker)..."

  check_python
  setup_venv

  # Build frontend if needed
  check_node
  build_frontend

  # Set env vars for local mode
  export STATIC_DIR="/tmp/a2a-scaffold-static"
  export CONFIG_PATH="$SCRIPT_DIR/configs/config.yaml"
  export SKILLS_DIR="$SCRIPT_DIR/agent-config/skills"
  export MCP_CONFIG="$SCRIPT_DIR/agent-config/mcp.json"
  export AGENT_MD_PATH="$SCRIPT_DIR/agent-config/AGENT.md"

  # Ensure agent config directory exists
  mkdir -p "$SCRIPT_DIR/agent-config/skills"

  # Copy AGENT.md to config dir if it exists at root
  if [ -f "$SCRIPT_DIR/AGENT.md" ]; then
    cp "$SCRIPT_DIR/AGENT.md" "$SCRIPT_DIR/agent-config/AGENT.md"
  fi

  ok "Starting A2A server on http://localhost:8080"
  echo ""

  # Run the Python server
  exec $PYTHON -m agentx.server.main
}

# ── Dev mode (frontend dev server + Python backend) ──────────────────────────

start_dev() {
  log "Starting in dev mode..."

  check_python
  check_node
  setup_venv

  export CONFIG_PATH="$SCRIPT_DIR/configs/config.yaml"
  export SKILLS_DIR="$SCRIPT_DIR/agent-config/skills"
  export MCP_CONFIG="$SCRIPT_DIR/agent-config/mcp.json"

  if [ -f "$SCRIPT_DIR/AGENT.md" ]; then
    cp "$SCRIPT_DIR/AGENT.md" "$SCRIPT_DIR/agent-config/AGENT.md"
  fi

  mkdir -p "$SCRIPT_DIR/agent-config/skills"

  export CONFIG_PATH="$SCRIPT_DIR/configs/config.yaml"
  export SKILLS_DIR="$SCRIPT_DIR/agent-config/skills"
  export MCP_CONFIG="$SCRIPT_DIR/agent-config/mcp.json"
  export AGENT_MD_PATH="$SCRIPT_DIR/agent-config/AGENT.md"

  # Start Python backend in background
  log "Starting Python backend on :8080..."
  $PYTHON -m agentx.server.main &
  BACKEND_PID=$!

  # Start Vite dev server with proxy
  log "Starting frontend dev server on :5173..."
  cd frontend
  if [ -d "node_modules" ] && ! node -e "require('lightningcss')" 2>/dev/null; then
    warn "node_modules has wrong platform binaries, reinstalling..."
    rm -rf node_modules
  fi
  if [ ! -d "node_modules" ]; then
    npm install --legacy-peer-deps
  fi
  npx vite --config vite.config.scaffold.ts --port 5173 &
  FRONTEND_PID=$!
  cd ..

  ok "Dev server running:"
  ok "  Frontend: http://localhost:5173"
  ok "  Backend:  http://localhost:8080"
  echo ""

  # Trap to kill both on exit
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
    echo "Usage: ./start.sh [docker|local|dev]"
    echo ""
    echo "  docker  — Build and run with Docker Compose"
    echo "  local   — Run directly with Python + Node.js (no Docker)"
    echo "  dev     — Dev mode: Vite dev server (HMR) + Python backend"
    echo "  auto    — Docker if available, else local (default)"
    exit 1
    ;;
esac
