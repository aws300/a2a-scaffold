#!/bin/bash
set -e

# Copy .env template if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from template — edit it with your AWS credentials."
  echo ""
fi

echo "⚡ A2A Scaffold"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 Agent config:  AGENT.md"
echo "🛠  Skills:        agent-config/skills/"
echo "🔧 MCP tools:     agent-config/mcp.json"
echo ""

docker compose up --build
