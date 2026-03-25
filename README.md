# A2A Scaffold

A standalone A2A (Agent-to-Agent) server with a built-in chat UI. Deploy anywhere as a single Docker container — other A2A agents can discover and interact with your agent via the standard `/.well-known/agent-card.json` endpoint.

## Quick Start

```bash
# 1. Clone and configure
cd a2a_scaffold
cp .env.example .env
# Edit .env with your AWS credentials (for Bedrock) or Anthropic API key

# 2. Customize your agent
# Edit AGENT.md — the body becomes the agent's system prompt
# Add skill files to agent-config/skills/*.md
# Add MCP tools to agent-config/mcp.json

# 3. Start
./start.sh

# 4. Open http://localhost:8080
```

## Architecture

```
Single Docker Container
├── Python ASGI Server (:8080)
│   ├── GET  /                              → Chat UI (built-in SPA)
│   ├── GET  /.well-known/agent-card.json   → A2A v1.0 Agent Card (public)
│   ├── POST /lf.a2a.v1.A2AService/*       → ConnectRPC A2A protocol
│   ├── GET  /api/agent                     → Read agent config
│   ├── PUT  /api/agent                     → Save agent config
│   ├── POST /api/upload                    → Upload files to workspace
│   └── GET  /healthz                       → Health check
└── Static Files (/usr/share/nginx/html/)   → Pre-built frontend SPA
```

## Configuration

### AGENT.md (Primary configuration)

The main configuration file. YAML frontmatter contains metadata, the body is the agent's **system prompt**.

```markdown
---
name: My Coding Agent
version: 1.0.0
provider:
  organization: My Company
---

You are an expert coding assistant specializing in Python and Go.

You have access to shell commands, file operations, and Python execution.
Always explain your reasoning before writing code.
Follow best practices and include error handling.
```

| Frontmatter Field | Required | Description |
|---|---|---|
| `name` | Yes | Agent display name |
| `version` | No | Agent version (default: `1.0.0`) |
| `provider.organization` | No | Organization name |
| `iconUrl` | No | URL to agent icon |
| `documentationUrl` | No | URL to documentation |

The body (after `---`) is injected as the agent's system prompt verbatim.

### Skills (agent-config/skills/*.md)

Drop `.md` files into `agent-config/skills/` to extend the agent's capabilities. Each file is automatically detected and included in the agent card.

```
agent-config/
└── skills/
    ├── code-review.md      → "Code Review" skill
    ├── data-analysis.md    → "Data Analysis" skill
    └── api-design.md       → "Api Design" skill
```

Skill names are derived from filenames (hyphens/underscores → title case).

### MCP Tools (agent-config/mcp.json)

Configure [Model Context Protocol](https://modelcontextprotocol.io/) tools:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/agent/data"],
      "env": {}
    },
    "github": {
      "command": "github-mcp-server",
      "args": ["stdio"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."
      }
    }
  }
}
```

### Environment Variables (.env)

```bash
# ── AI Model (choose one method) ──

# Method A: AWS Bedrock API Key (simplest — single token, no IAM setup needed)
# Get from: https://console.aws.amazon.com/bedrock/home#/api-keys
AWS_BEARER_TOKEN_BEDROCK=ABSKQ...your_base64_token...

# Method B: AWS Bedrock with IAM credentials
# AWS_DEFAULT_REGION=us-west-2
# AWS_ACCESS_KEY_ID=your_key
# AWS_SECRET_ACCESS_KEY=your_secret

# Method C: Anthropic API directly
# ANTHROPIC_API_KEY=sk-ant-...
# MODEL=anthropic://claude-sonnet-4-20250514

# ── Optional overrides ──
# AGENT_NAME=My Agent          # Override AGENT.md name
# SKILLS_DIR=/custom/skills    # Override skills directory
# MCP_CONFIG=/custom/mcp.json  # Override MCP config path
```

## A2A Protocol

### Agent Discovery

Any A2A client can discover your agent:

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
  "skills": [
    {"id": "code-review", "name": "Code Review", "description": "...", "tags": ["skill"]}
  ],
  "provider": {"organization": "My Company"}
}
```

### Sending Messages

Use the ConnectRPC protocol to send messages:

```bash
# Using the example client
python examples/a2a_client.py stream https://your-domain "Write a hello world in Python"

# Using curl (Connect server-streaming)
# See examples/a2a_client.py for the binary envelope format
```

## Example A2A Client

A Python client is included at `examples/a2a_client.py`:

```bash
pip install httpx

# Discover agent capabilities
python examples/a2a_client.py discover http://localhost:8080

# Send a message (wait for full response)
python examples/a2a_client.py ask http://localhost:8080 "What is 2+2?"

# Stream a response (token by token)
python examples/a2a_client.py stream http://localhost:8080 "Write a haiku about coding"
```

## Chat UI

The built-in chat UI at `http://localhost:8080` provides:

- **Chat**: Send messages and receive streaming responses
- **Image support**: Paste or upload images (sent to the agent as part of the message)
- **File upload**: Upload files to the agent's workspace (`/agent/data/uploads/`)
- **Agent editor** (⚙️): Edit agent name, system prompt, version, and provider — saves to `AGENT.md`
- **Agent card link** (🔗): View the live `/.well-known/agent-card.json`

## File Structure

```
a2a_scaffold/
├── AGENT.md                        # ← Edit this: agent config + system prompt
├── agent-config/
│   ├── mcp.json                    # ← MCP tool configuration
│   └── skills/                     # ← Drop .md skill files here
│       └── example-skill.md
├── configs/
│   └── config.yaml                 # Server configuration (model, paths)
├── examples/
│   └── a2a_client.py               # Example A2A client (discover/ask/stream)
├── src/agentx/                     # Python A2A server source
│   ├── server/
│   │   ├── main.py                 # Entry point
│   │   └── connect.py              # ASGI dispatcher + agent card + file upload
│   ├── services/
│   │   └── a2a_service.py          # A2A streaming message handler
│   ├── agui_adapter.py             # AG-UI event protocol adapter
│   └── tools/                      # Strands agent tools
├── Dockerfile                      # Single-image build (Python + frontend)
├── docker-compose.yml
├── start.sh                        # One-command startup
├── .env.example                    # Environment variable template
└── README.md                       # This file
```

## Deployment

### Local (Docker Compose)

```bash
./start.sh
# → http://localhost:8080
```

### Cloud (any Docker host)

```bash
docker build -t my-a2a-agent .
docker run -p 8080:8080 \
  -e AWS_DEFAULT_REGION=us-west-2 \
  -e AWS_ACCESS_KEY_ID=... \
  -e AWS_SECRET_ACCESS_KEY=... \
  -v ./agent-config:/agent/config \
  my-a2a-agent
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-a2a-agent
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: agent
          image: my-a2a-agent:latest
          ports:
            - containerPort: 8080
          env:
            - name: AWS_DEFAULT_REGION
              value: us-west-2
          volumeMounts:
            - name: config
              mountPath: /agent/config
      volumes:
        - name: config
          configMap:
            name: my-agent-config
```

### Save Customized Image

After configuring your agent via the UI, save the container as a new image:

```bash
# Find your running container
docker ps

# Commit changes (AGENT.md edits are persisted)
docker commit <container_id> my-custom-agent:v1

# Push to registry
docker tag my-custom-agent:v1 your-registry/my-custom-agent:v1
docker push your-registry/my-custom-agent:v1
```

## Built-in Tools

The agent has access to these tools by default:

| Tool | Description |
|------|-------------|
| `shell` | Execute shell commands |
| `file_read` | Read file contents |
| `file_write` | Write/create files |
| `editor` | Edit files with search/replace |
| `python_repl` | Execute Python code |
| `http_request` | Make HTTP requests |
| `think` | Internal reasoning (chain-of-thought) |
| `calculator` | Math calculations |
| `current_time` | Get current date/time |
| `environment` | Read environment variables |

Additional tools can be added via MCP configuration.
