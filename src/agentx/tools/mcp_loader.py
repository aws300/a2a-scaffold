"""MCP connector loader for the Agent Playground.

Fetches MCP server (connector) configuration from the Go backend's
ConnectorService.GetConnector RPC via ConnectRPC (HTTP/JSON), then creates
Strands MCPClient instances for each selected MCP server.

Uses the same httpx-based ConnectRPC pattern as kb_tool.py.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

log = logging.getLogger(__name__)

# Reusable HTTP client (connection pooling)
_http_client: httpx.Client | None = None


def _get_http_client() -> httpx.Client:
    """Lazily create and cache the HTTP client."""
    global _http_client
    if _http_client is None:
        _http_client = httpx.Client(
            timeout=httpx.Timeout(30.0, connect=10.0),
            http2=True,
        )
    return _http_client


def fetch_connector(connector_id: str, backend_addr: str = "localhost:8080") -> dict[str, Any] | None:
    """
    Fetch a single connector by ID from the Go backend's ConnectorService.GetConnector.

    Returns a dict with keys: id, name, title, description, kind, url, command, env, enabled.
    Returns None on error.
    """
    client = _get_http_client()
    url = f"http://{backend_addr}/connector.v1.ConnectorService/GetConnector"

    payload = {"id": connector_id}
    headers = {"Content-Type": "application/json"}

    try:
        resp = client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

        return {
            "id": data.get("id", connector_id),
            "name": data.get("name", ""),
            "title": data.get("title", ""),
            "description": data.get("description", ""),
            "kind": data.get("kind", 0),  # 0=unspecified, 1=app, 2=mcp_remote, 3=mcp_local
            "url": data.get("url", ""),
            "command": data.get("command", ""),
            "env": data.get("env", {}),
            "headers": data.get("headers", {}),
            "enabled": data.get("enabled", False),
            # APP connector fields (kind=1) — needed for connector skill injection
            "app_type": data.get("appType", data.get("app_type", "")),
            "access_token": data.get("accessToken", data.get("access_token", "")),
            "base_url": data.get("baseUrl", data.get("base_url", "")),
        }
    except httpx.HTTPStatusError as e:
        log.error(
            "mcp_loader: fetch failed for %s (HTTP %d): %s",
            connector_id, e.response.status_code, e.response.text[:500],
        )
        return None
    except Exception as e:
        log.error("mcp_loader: fetch error for %s: %s", connector_id, str(e))
        return None


def fetch_connectors(connector_ids: list[str], backend_addr: str = "localhost:8080") -> list[dict[str, Any]]:
    """
    Fetch multiple connectors by ID. Returns only successfully fetched MCP connectors.
    """
    connectors = []
    for cid in connector_ids:
        conn = fetch_connector(cid, backend_addr=backend_addr)
        if conn:
            connectors.append(conn)
            log.info(
                "mcp_loader: loaded connector %s (%s) kind=%s",
                cid, conn.get("title", conn.get("name", "")), conn.get("kind"),
            )
        else:
            log.warning("mcp_loader: skipping connector %s (not found)", cid)
    return connectors


def create_mcp_tools_for_connectors(
    connectors: list[dict[str, Any]],
) -> list[Any]:
    """
    Create Strands MCPClient instances for MCP connectors.

    For remote MCP servers (kind=2 / CONNECTOR_KIND_MCP_REMOTE), uses
    mcp.client.streamable_http.streamablehttp_client as the transport.
    For local MCP servers (kind=3 / CONNECTOR_KIND_MCP_LOCAL), uses
    mcp.client.stdio.stdio_client as the transport.

    MCPClient.start() is NOT called here — Strands Agent handles lifecycle
    automatically when tools are passed to Agent(tools=[...]).

    Returns a list of MCPClient instances ready for Agent(tools=[...]).
    """
    mcp_tools: list[Any] = []

    for conn in connectors:
        kind = conn.get("kind", 0)
        # kind can be int or string enum name
        kind_str = str(kind)
        is_remote = kind_str in ("2", "CONNECTOR_KIND_MCP_REMOTE", "mcp_remote")
        is_local = kind_str in ("3", "CONNECTOR_KIND_MCP_LOCAL", "mcp_local")

        try:
            if is_remote and conn.get("url"):
                mcp_client = _create_remote_mcp_client(conn)
                if mcp_client:
                    mcp_tools.append(mcp_client)
                    log.info(
                        "mcp_loader: created remote MCP client for %s (%s)",
                        conn["id"], conn.get("url"),
                    )
            elif is_local and conn.get("command"):
                mcp_client = _create_local_mcp_client(conn)
                if mcp_client:
                    mcp_tools.append(mcp_client)
                    log.info(
                        "mcp_loader: created local MCP client for %s (%s)",
                        conn["id"], conn.get("command"),
                    )
            else:
                log.warning(
                    "mcp_loader: skipping connector %s (unsupported kind=%s or missing url/command)",
                    conn["id"], kind,
                )
        except Exception as e:
            log.error(
                "mcp_loader: failed to create MCP client for %s: %s",
                conn["id"], str(e),
            )

    return mcp_tools


def _create_remote_mcp_client(conn: dict[str, Any]) -> Any:
    """Create an MCPClient for a remote (HTTP) MCP server.

    Uses mcp.client.streamable_http.streamablehttp_client as the transport
    callable. The Strands MCPClient takes a transport_callable (a function
    returning an async context manager) and manages its lifecycle internally.

    If the connector has custom headers (e.g. Authorization), they are passed
    to streamablehttp_client so every request includes them.
    """
    try:
        from functools import partial
        from strands.tools.mcp import MCPClient
        from mcp.client.streamable_http import streamablehttp_client

        url = conn["url"]
        custom_headers = conn.get("headers") or {}

        kwargs: dict[str, Any] = {"url": url}
        if custom_headers:
            kwargs["headers"] = custom_headers
            log.info("mcp_loader: remote MCP %s has %d custom header(s)", url, len(custom_headers))

        transport = partial(streamablehttp_client, **kwargs)
        client = MCPClient(transport_callable=transport)
        log.info("mcp_loader: remote MCPClient prepared for %s", url)
        return client
    except ImportError as e:
        log.warning("mcp_loader: MCP import error (strands or mcp package missing): %s", e)
        return None
    except Exception as e:
        log.error("mcp_loader: remote MCP client creation failed for %s: %s", conn.get("url"), str(e))
        return None


def _create_local_mcp_client(conn: dict[str, Any]) -> Any:
    """Create an MCPClient for a local (stdio) MCP server.

    Uses mcp.client.stdio.stdio_client as the transport callable.
    The command string is split into command + args for StdioServerParameters.
    """
    try:
        import shlex
        from functools import partial
        from strands.tools.mcp import MCPClient
        from mcp.client.stdio import stdio_client, StdioServerParameters

        command_str = conn["command"]
        env = conn.get("env") or {}

        # Split command string into command + args
        parts = shlex.split(command_str)
        if not parts:
            log.error("mcp_loader: empty command for connector %s", conn.get("id"))
            return None

        params = StdioServerParameters(
            command=parts[0],
            args=parts[1:] if len(parts) > 1 else [],
            env=env if env else None,
        )
        transport = partial(stdio_client, server=params)
        client = MCPClient(transport_callable=transport)
        log.info("mcp_loader: local MCPClient prepared for %s", command_str)
        return client
    except ImportError as e:
        log.warning("mcp_loader: MCP import error (strands or mcp package missing): %s", e)
        return None
    except Exception as e:
        log.error("mcp_loader: local MCP client creation failed for %s: %s", conn.get("command"), str(e))
        return None
