"""
A2A Scaffold — Minimal A2A Server entry point.

Stripped version of backend-py/server/main.py:
- No JWT authentication
- No Redis session hooks
- No MongoDB
- No Terminal service
"""
from __future__ import annotations

import asyncio
import os
import signal
import sys

import uvloop


def run():
    """Entry point for `agentx-server` console script."""
    uvloop.run(_serve())


async def _serve():
    import yaml

    # Load config
    config_paths = [
        os.environ.get("CONFIG_PATH", ""),
        "/home/core/config.yaml",
        "/home/core/configs/config.yaml",
        "configs/config.yaml",
    ]
    cfg = {}
    for p in config_paths:
        if p and os.path.isfile(p):
            with open(p) as f:
                cfg = yaml.safe_load(f) or {}
            break

    apis_cfg = cfg.get("apis", {})
    deps_cfg = cfg.get("dependencies", {})
    svc_cfg = cfg.get("service", {})

    http_addr = os.environ.get("HTTP_ADDR", apis_cfg.get("httpAddr", ":8080"))
    model_id = os.environ.get("MODEL", deps_cfg.get("model", ""))

    # ── Configure Bedrock API Key auth if provided ──
    # AWS_BEARER_TOKEN_BEDROCK is a single API key for Bedrock access
    # (alternative to IAM credentials). Decoded and set as session token.
    bearer_token = os.environ.get("AWS_BEARER_TOKEN_BEDROCK", "")
    if bearer_token:
        import base64
        try:
            decoded = base64.b64decode(bearer_token).decode("utf-8")
            # Format: "BedrockAPIKey-{id}-at-{account}:{secret}"
            # Split into access key and secret key parts for boto3
            if ":" in decoded:
                access_part, secret_part = decoded.rsplit(":", 1)
                os.environ.setdefault("AWS_ACCESS_KEY_ID", access_part)
                os.environ.setdefault("AWS_SECRET_ACCESS_KEY", secret_part)
                os.environ.setdefault("AWS_SESSION_TOKEN", bearer_token)
            print("[A2A Scaffold] Auth: Bedrock API Key configured", flush=True)
        except Exception as e:
            print(f"[A2A Scaffold] Warning: Failed to decode AWS_BEARER_TOKEN_BEDROCK: {e}", flush=True)

    # Parse model URI: "bedrock://model-id?region=xxx" → just "model-id"
    if model_id.startswith("bedrock://"):
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(model_id)
        model_id = parsed.netloc + parsed.path  # e.g. "us.anthropic.claude-opus-4-6-v1"
        # Extract region from query params if present
        qs = parse_qs(parsed.query)
        if "region" in qs:
            os.environ.setdefault("AWS_DEFAULT_REGION", qs["region"][0])
    elif model_id.startswith("anthropic://"):
        model_id = model_id.replace("anthropic://", "")
    agent_name = os.environ.get("AGENT_NAME", svc_cfg.get("agent_name", "A2A Agent"))
    skills_dir = os.environ.get("SKILLS_DIR", svc_cfg.get("skills_dir", "/agent/config/skills"))
    mcp_config_path = os.environ.get("MCP_CONFIG", svc_cfg.get("mcp_config_path", "/agent/config/mcp.json"))
    data_base_path = os.environ.get("AGENT_DATA_DIR", svc_cfg.get("dataBasePath", "/agent/data"))

    # Ensure data directory exists and is writable
    os.makedirs(data_base_path, exist_ok=True)

    # Load system prompt from AGENT.md body (the primary source of agent behavior)
    agent_md_path = os.environ.get("AGENT_MD_PATH", "/agent/config/AGENT.md")
    system_prompt = ""
    if os.path.isfile(agent_md_path):
        import re
        with open(agent_md_path, "r", encoding="utf-8") as f:
            content = f.read()
        fm_match = re.match(r'^---\s*\n.*?\n---\s*\n', content, re.DOTALL)
        body = content[fm_match.end():] if fm_match else content
        system_prompt = body.strip()
        # Also read name from frontmatter if not overridden by env
        if fm_match and not os.environ.get("AGENT_NAME"):
            try:
                import yaml
                fm = yaml.safe_load(fm_match.group(0).strip("- \n")) or {}
                if fm.get("name"):
                    agent_name = fm["name"]
            except Exception:
                pass

    print(f"[A2A Scaffold] Agent: {agent_name}", flush=True)
    print(f"[A2A Scaffold] Model: {model_id}", flush=True)
    print(f"[A2A Scaffold] Skills: {skills_dir}", flush=True)
    print(f"[A2A Scaffold] MCP:    {mcp_config_path}", flush=True)
    print(f"[A2A Scaffold] System prompt: {len(system_prompt)} chars from AGENT.md", flush=True)

    # ── Create A2A service ──
    from agentx.services.a2a_service import A2AServicer

    a2a_servicer = A2AServicer(
        model_id=model_id,
        mcp_config=mcp_config_path,
        skills_dir=skills_dir,
        backend_addr="",
        default_system_prompt=system_prompt,
    )

    # ── Build Connect ASGI app (no JWT) ──
    from agentx.server.connect import build_connect_app

    connect_servicers = []
    try:
        # Fix gRPC generated import: 'lf.a2a.v1' → 'agentx.generated.lf.a2a.v1'
        import sys
        if 'lf' not in sys.modules:
            sys.modules['lf'] = __import__('agentx.generated.lf', fromlist=['a2a'])
        if 'lf.a2a' not in sys.modules:
            sys.modules['lf.a2a'] = __import__('agentx.generated.lf.a2a', fromlist=['v1'])
        if 'lf.a2a.v1' not in sys.modules:
            sys.modules['lf.a2a.v1'] = __import__('agentx.generated.lf.a2a.v1', fromlist=['a2a_pb2'])

        from agentx.generated.lf.a2a.v1.a2a_connect import A2AServiceASGIApplication
        connect_servicers.append(A2AServiceASGIApplication(a2a_servicer))
        print("[A2A Scaffold] A2A Connect service registered", flush=True)
    except ImportError as e:
        print(f"[A2A Scaffold] Warning: A2A Connect app not available: {e}", flush=True)

    app = build_connect_app(
        connect_servicers,
        jwt_validator=None,
        agent_name=agent_name,
        agent_description=system_prompt[:200] if system_prompt else "",
    )

    # ── Start HTTP server ──
    import uvicorn

    host = "::"  # Bind to all interfaces (IPv4 + IPv6)
    port = int(http_addr.split(":")[-1]) if http_addr and ":" in http_addr else 8080

    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level="info",
        access_log=False,
    )
    server = uvicorn.Server(config)

    # Graceful shutdown
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda: asyncio.create_task(server.shutdown()))

    print(f"[A2A Scaffold] Listening on {host}:{port}", flush=True)
    await server.serve()


if __name__ == "__main__":
    run()
