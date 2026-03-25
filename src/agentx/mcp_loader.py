"""
MCP (Model Context Protocol) loader for the AgentX backend-py.

Reads /agent/config/mcp.json and creates Strands-compatible MCPClient instances.

mcp.json format (compatible with Claude Desktop config):
---------------------------------------------------------
{
  "mcpServers": {
    "server-name": {
      "command": "uvx",
      "args": ["mcp-server-git", "--repository", "/agent/data"],
      "env": {"API_KEY": "..."},
      "cwd": "/agent/data"
    },
    "sse-server": {
      "url": "http://localhost:8080/sse",
      "type": "sse",
      "headers": {"Authorization": "Bearer ..."}
    },
    "http-server": {
      "url": "http://localhost:9000/mcp",
      "type": "streamable_http"
    }
  }
}

Transport detection:
  - "command" present            → stdio  (subprocess via stdin/stdout)
  - "url" + type "sse"           → SSE   (Server-Sent Events)
  - "url" (default / "streamable_http") → Streamable HTTP (MCP 2025-03-26)

Lifecycle:
  All MCPClient instances are entered once (await __aenter__) at first use and
  kept alive for the lifetime of the process. Call cleanup_mcp_clients() on
  graceful shutdown to close the underlying transports.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

import structlog

log = structlog.get_logger(__name__)
_std_log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_mcp_tools: list[Any] | None = None   # cached tool list (set after first load)
_mcp_clients: list[Any] = []          # open MCPClient instances


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def get_mcp_tools(config_path: str = "/agent/config/mcp.json") -> list[Any]:
    """
    Return the list of Strands-compatible MCP tool callables.

    On the first call the mcp.json is parsed, clients are started and their
    tools are collected. Subsequent calls return the cached result.
    """
    global _mcp_tools, _mcp_clients

    if _mcp_tools is not None:
        return _mcp_tools

    cfg_path = Path(config_path)
    if not cfg_path.exists():
        log.info("mcp.config.not_found", path=str(cfg_path))
        _mcp_tools = []
        return _mcp_tools

    try:
        with open(cfg_path, encoding="utf-8") as fh:
            cfg = json.load(fh)
    except Exception as e:
        log.warning("mcp.config.parse_error", path=str(cfg_path), error=str(e))
        _mcp_tools = []
        return _mcp_tools

    servers: dict[str, Any] = cfg.get("mcpServers", {})
    if not servers:
        log.info("mcp.config.empty", path=str(cfg_path))
        _mcp_tools = []
        return _mcp_tools

    tools: list[Any] = []
    for name, server_cfg in servers.items():
        try:
            client = _build_client(name, server_cfg)
            if client is None:
                continue
            await client.__aenter__()
            _mcp_clients.append(client)
            server_tools = client.tools
            tools.extend(server_tools)
            log.info("mcp.server.loaded", name=name, tools=len(server_tools))
        except Exception as e:
            log.warning("mcp.server.failed", name=name, error=str(e))

    log.info("mcp.tools.ready", total=len(tools), servers=len(_mcp_clients))
    _mcp_tools = tools
    return _mcp_tools


async def cleanup_mcp_clients() -> None:
    """Close all open MCP client connections (call on graceful shutdown)."""
    global _mcp_clients, _mcp_tools
    for client in _mcp_clients:
        try:
            await client.__aexit__(None, None, None)
        except Exception as e:
            log.warning("mcp.client.close_error", error=str(e))
    _mcp_clients = []
    _mcp_tools = None
    log.info("mcp.clients.closed")


def reset_mcp_cache() -> None:
    """Force reload on next get_mcp_tools() call (useful for config hot-reload)."""
    global _mcp_tools
    _mcp_tools = None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _build_client(name: str, cfg: dict[str, Any]) -> Any | None:
    """
    Construct a Strands MCPClient for one server entry from mcp.json.

    Detects transport type from config keys.
    """
    try:
        from strands.tools.mcp import MCPClient
    except ImportError:
        log.warning("mcp.strands.unavailable", hint="pip install strands-agents")
        return None

    transport_type = _detect_transport(cfg)

    if transport_type == "stdio":
        return _build_stdio_client(MCPClient, name, cfg)
    elif transport_type == "sse":
        return _build_sse_client(MCPClient, name, cfg)
    elif transport_type == "streamable_http":
        return _build_http_client(MCPClient, name, cfg)
    else:
        log.warning("mcp.server.unknown_transport", name=name, cfg=cfg)
        return None


def _detect_transport(cfg: dict[str, Any]) -> str:
    """Detect MCP transport type from config keys."""
    if "command" in cfg:
        return "stdio"
    if "url" in cfg:
        explicit = cfg.get("type", "").lower()
        if explicit == "sse":
            return "sse"
        if explicit == "streamable_http":
            return "streamable_http"
        # Heuristic: URL ending in /sse → SSE
        url: str = cfg["url"]
        if url.rstrip("/").endswith("/sse"):
            return "sse"
        return "streamable_http"
    return "unknown"


def _build_stdio_client(MCPClient: Any, name: str, cfg: dict[str, Any]) -> Any:
    from mcp import StdioServerParameters
    from mcp.client.stdio import stdio_client

    command: str = cfg["command"]
    args: list[str] = [str(a) for a in cfg.get("args", [])]
    env_override: dict[str, str] = {str(k): str(v) for k, v in cfg.get("env", {}).items()}
    cwd: str | None = cfg.get("cwd")

    # Merge env overrides on top of current process environment
    merged_env: dict[str, str] = {**os.environ, **env_override}

    params = StdioServerParameters(
        command=command,
        args=args,
        env=merged_env,
        cwd=cwd,
    )
    log.info("mcp.client.stdio", name=name, command=command, args=args)
    return MCPClient(lambda p=params: stdio_client(p))


def _build_sse_client(MCPClient: Any, name: str, cfg: dict[str, Any]) -> Any:
    from mcp.client.sse import sse_client

    url: str = cfg["url"]
    headers: dict[str, Any] = cfg.get("headers", {})
    timeout: float = float(cfg.get("timeout", 30))
    log.info("mcp.client.sse", name=name, url=url)
    return MCPClient(lambda u=url, h=headers, t=timeout: sse_client(u, headers=h or None, timeout=t))


def _build_http_client(MCPClient: Any, name: str, cfg: dict[str, Any]) -> Any:
    from mcp.client.streamable_http import streamablehttp_client

    url: str = cfg["url"]
    headers: dict[str, str] = {str(k): str(v) for k, v in cfg.get("headers", {}).items()}
    timeout: float = float(cfg.get("timeout", 30))
    log.info("mcp.client.streamable_http", name=name, url=url)
    return MCPClient(
        lambda u=url, h=headers, t=timeout: streamablehttp_client(u, headers=h or None, timeout=t)
    )
