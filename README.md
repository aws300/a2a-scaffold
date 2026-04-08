# A2A Scaffold

A standalone A2A (Agent-to-Agent) server with a built-in chat UI. Deploy anywhere as a single Docker container or run locally — other A2A agents can discover and interact with your agent via the standard `/.well-known/agent-card.json` endpoint.

## Quick Start

### Step 1: Get an API Key

Choose **one** of the following:

**Option A — AWS Bedrock API Key** (recommended):
1. Go to [AWS Bedrock Console → API Keys](https://console.aws.amazon.com/bedrock/home#/api-keys)
2. Click "Create API key"
3. Copy the key (starts with `ABSK...`)

**Option B — Custom LLM API Key** (Anthropic or compatible):
1. Get an API key from your LLM provider
2. Get the API base URL (e.g. `https://api.anthropic.com` or your own proxy)

### Step 2: Configure

```bash
cp .env.example .env
```

Edit `.env` — choose one option:

```bash
# Option A: AWS Bedrock API Key
AWS_BEARER_TOKEN_BEDROCK=ABSKQ...your_key_here

# Option B: Custom LLM API (Anthropic or compatible)
# ANTHROPIC_BASE_URL=https://llmapi.example.com
# ANTHROPIC_API_KEY=sk-ant-your_key_here
# MODEL=anthropic://claude-sonnet-4-6
```

### Step 3: Customize Your Agent (optional)

Edit `AGENT.md` — the body becomes your agent's system prompt:

```markdown
---
name: My Coding Agent
version: 1.0.0
---

You are an expert Python developer. Always write clean, well-documented code.
```

### Step 4: Start

```bash
./start.sh
```

Open **http://localhost:8080** and start chatting.

---

## Running Modes

```bash
./start.sh              # Auto-detect: Docker if available, else local
./start.sh docker       # Force Docker mode
./start.sh local        # Force local mode (requires Python 3.13+ & Node 20+)
./start.sh dev          # Dev mode: Vite HMR (5173) + Python backend (8080)
```

### Second run is fast

On the second run, `start.sh` uses cached dependencies:
- Python venv: reused (only reinstalls if `requirements.txt` changes)
- node_modules: reused (only reinstalls if platform binaries are wrong)
- Frontend build: reused (only rebuilds if source files changed)

## Architecture

```
Single process (port 8080)
├── GET  /                              → Chat UI (built-in SPA)
├── GET  /.well-known/agent-card.json   → A2A v1.0 Agent Card (public)
├── POST /lf.a2a.v1.A2AService/*       → ConnectRPC A2A protocol (streaming)
├── GET  /api/agent                     → Read agent config
├── PUT  /api/agent                     → Save agent config
├── POST /api/upload                    → Upload files to workspace
└── GET  /healthz                       → Health check
```

## Configuration

### AGENT.md

The main configuration file. YAML frontmatter = metadata, body = system prompt.

```markdown
---
name: My Coding Agent
version: 1.0.0
provider:
  organization: My Company
---

You are an expert coding assistant specializing in Python and Go.
Always explain your reasoning before writing code.
```

| Frontmatter Field | Required | Description |
|---|---|---|
| `name` | Yes | Agent display name |
| `version` | No | Agent version (default: `1.0.0`) |
| `provider.organization` | No | Organization name |
| `iconUrl` | No | URL to agent icon |
| `documentationUrl` | No | URL to documentation |

### Skills (agent-config/skills/)

Skills follow the [AgentSkills.io](https://agentskills.io) standard. Each skill is a **subdirectory** with a `SKILL.md` file:

```
agent-config/skills/
├── my-code-reviewer/
│   └── SKILL.md                ← Required: YAML frontmatter + instructions
├── my-api-designer/
│   ├── SKILL.md
│   ├── scripts/                ← Optional: helper scripts the agent can run
│   │   └── validate.py
│   └── references/             ← Optional: reference docs the agent can read
│       └── api-standards.md
└── my-devops-skill/
    ├── SKILL.md
    └── templates/
        └── dockerfile.tmpl
```

**SKILL.md format:**

```markdown
---
name: my-code-reviewer
description: Perform thorough code reviews with best practices
---

# Code Reviewer

You are a code review expert. When reviewing code:

1. Check for correctness, security, and performance
2. Suggest improvements with code examples
3. Flag any anti-patterns
```

**Rules:**
- Directory name = skill ID (kebab-case: `my-code-reviewer`)
- `SKILL.md` frontmatter must have `name` and `description`
- `name` should match the directory name
- Resource files (`scripts/`, `references/`, `templates/`) are accessible to the agent via `file_read`
- Skills are auto-detected on startup and listed in the agent card

### MCP Tools (agent-config/mcp.json)

Configure [Model Context Protocol](https://modelcontextprotocol.io/) tools:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": {}
    }
  }
}
```

### Environment Variables (.env)

```bash
# ── AI Model (choose one) ──────────────────────────────────────

# Method A: AWS Bedrock API Key (simplest — single token)
# Get from: https://console.aws.amazon.com/bedrock/home#/api-keys
AWS_BEARER_TOKEN_BEDROCK=ABSKQ...

# Method B: AWS Bedrock with IAM credentials
# AWS_DEFAULT_REGION=us-west-2
# AWS_ACCESS_KEY_ID=AKIA...
# AWS_SECRET_ACCESS_KEY=...

# Method C: Anthropic API directly
# ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_BASE_URL=https://api.anthropic.com  # optional: custom endpoint
# MODEL=anthropic://claude-sonnet-4-20250514

# ── Optional ───────────────────────────────────────────────────

# AGENT_NAME=My Agent          # Override AGENT.md name
# MODEL=bedrock://us.anthropic.claude-opus-4-6-v1?region=us-west-2
# PROJECT_ID=my-project        # Project context for tool isolation
# USER_SUB=my-user             # User identity for multi-user scenarios
```

## A2A Protocol

### Agent Discovery

```bash
curl https://your-domain/.well-known/agent-card.json
```

Returns an [A2A v1.0 Agent Card](https://github.com/a2aproject/a2a-spec):

```json
{
  "name": "My Coding Agent",
  "description": "You are an expert coding assistant...",
  "version": "1.0.0",
  "supportedInterfaces": [
    {"url": "https://your-domain", "protocolBinding": "HTTP+JSON", "protocolVersion": "1.0"},
    {"url": "https://your-domain", "protocolBinding": "GRPC", "protocolVersion": "1.0"}
  ],
  "capabilities": {"streaming": true},
  "skills": [{"id": "code-review", "name": "Code Review", "description": "...", "tags": ["skill"]}]
}
```

## Example A2A Client

```bash
pip install httpx

# Discover
python examples/a2a_client.py discover http://localhost:8080

# Ask (wait for full response)
python examples/a2a_client.py ask http://localhost:8080 "What is 2+2?"

# Stream (token by token)
python examples/a2a_client.py stream http://localhost:8080 "Write a haiku about coding"
```

## Chat UI

The built-in UI at `http://localhost:8080` provides:

- **Chat** — streaming responses with markdown rendering
- **Images** — paste (Ctrl+V) or click 📷 to attach images
- **File upload** — upload files to the agent's workspace
- **Mermaid diagrams** — rendered inline with tab switch (diagram/code)
- **Vega-Lite charts** — rendered inline with tab switch (chart/code)
- **Code highlighting** — syntax highlighting via Shiki (light theme)
- **Agent editor** (⚙️) — edit name, system prompt, version → saves to AGENT.md
- **Agent card** (🔗) — view live `/.well-known/agent-card.json`

## File Structure

```
a2a-scaffold/
├── AGENT.md                        # ← Your agent's config + system prompt
├── .env                            # ← Your API keys (not committed)
├── agent-config/
│   ├── mcp.json                    # ← MCP tool configuration
│   └── skills/                     # ← Skill directories (AgentSkills.io format)
│       └── example-skill/
│           └── SKILL.md
├── configs/config.yaml             # Server configuration
├── examples/a2a_client.py          # Example A2A client
├── frontend/                       # Chat UI source (SolidJS + Vite)
├── src/agentx/                     # Python A2A server source
├── Dockerfile                      # Single-image Docker build
├── docker-compose.yml
├── start.sh                        # One-command startup
├── .env.example                    # Environment template
└── README.md                       # This file
```

## Deployment

### Local Development

```bash
./start.sh local    # Python + Node.js, no Docker
./start.sh dev      # Frontend HMR + backend
```

### Docker

```bash
./start.sh docker   # Docker Compose

# Or manually:
docker build -t my-agent .
docker run -p 8080:8080 --env-file .env my-agent
```

### Production

```bash
# Save customized image
docker commit <container_id> my-agent:v1
docker push registry/my-agent:v1

# Deploy anywhere
docker run -p 8080:8080 -e AWS_BEARER_TOKEN_BEDROCK=... registry/my-agent:v1
```

## Built-in Tools

| Tool | Description |
|------|-------------|
| `shell` | Execute shell commands |
| `file_read` | Read file contents |
| `file_write` | Write/create files |
| `editor` | Edit files (search/replace) |
| `python_repl` | Execute Python code |
| `http_request` | Make HTTP requests |
| `think` | Internal reasoning |
| `calculator` | Math calculations |
| `current_time` | Current date/time |
