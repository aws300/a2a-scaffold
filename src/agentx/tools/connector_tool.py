"""
Connector Token Tool — Strands tool for retrieving per-user connector credentials.

The Agent calls `get_connector_token(connector_id)` when it needs to interact
with a connected service (GitHub, GitLab). The tool fetches the credential from
the Go backend's ConnectorService.GetCredential RPC.

User identity (`user_sub`) is injected via ContextVar by a2a_service.py per-request.
"""

from __future__ import annotations

import contextvars
from typing import Any

import httpx

# ContextVar for per-request user identity — set by a2a_service.py
current_user_sub: contextvars.ContextVar[str] = contextvars.ContextVar(
    "current_user_sub", default=""
)

# ContextVar for backend address
current_backend_addr: contextvars.ContextVar[str] = contextvars.ContextVar(
    "current_backend_addr", default="agentx-backend:8080"
)


def _get_credential(connector_id: str) -> dict[str, Any]:
    """Internal: fetch credential from Go backend via ConnectRPC."""
    user_sub = current_user_sub.get()
    backend_addr = current_backend_addr.get()

    if not user_sub:
        return {"error": "User identity not available. Cannot retrieve connector token."}

    url = f"http://{backend_addr}/connector.v1.ConnectorService/GetCredential"
    payload = {"connectorId": connector_id, "userSub": user_sub}

    try:
        with httpx.Client(timeout=10) as client:
            resp = client.post(url, json=payload, headers={"Content-Type": "application/json"})
            if resp.status_code != 200:
                try:
                    err_data = resp.json()
                    err_msg = err_data.get("message", err_data.get("msg", resp.text[:200]))
                except Exception:
                    err_msg = resp.text[:200]
                return {"error": f"Connector '{connector_id}' not connected: {err_msg}"}
            data = resp.json()
            return {
                "token": data.get("accessToken", ""),
                "base_url": data.get("baseUrl", ""),
                "username": data.get("username", ""),
                "status": data.get("status", "disconnected"),
                "app_type": data.get("appType", ""),
            }
    except Exception as e:
        return {"error": f"Failed to fetch credential for '{connector_id}': {e}"}


def get_connector_token(connector_id: str) -> dict:
    """Get the current user's credentials for a connected service (GitHub, GitLab, etc.).

    Returns a dict with:
    - token: the access token/PAT for authenticating with the service
    - base_url: instance URL (e.g. https://gitlab.com or your self-hosted GitLab URL)
    - username: authenticated username
    - status: 'connected' or 'disconnected'
    - app_type: 'github', 'gitlab', etc.

    If no credential is found, returns {"error": "..."}

    Usage examples:
      get_connector_token("connector-github")  → GitHub PAT
      get_connector_token("connector-gitlab")  → GitLab PAT + base_url

    Args:
        connector_id: The connector ID (e.g. "connector-github", "connector-gitlab")

    Returns:
        dict with token, base_url, username, status, app_type — or error
    """
    return _get_credential(connector_id)


def get_connector_token_tool():
    """Create the get_connector_token as a Strands @tool."""
    try:
        from strands import tool

        @tool
        def get_connector_token_strands(connector_id: str) -> dict:
            """Get the current user's credentials for a connected service.

            Returns a dict with token, base_url, username, status, app_type.
            Use this to get authentication tokens for GitHub, GitLab, etc.

            Args:
                connector_id: The connector ID (e.g. "connector-github", "connector-gitlab")
            """
            return _get_credential(connector_id)

        return get_connector_token_strands
    except ImportError:
        return None
