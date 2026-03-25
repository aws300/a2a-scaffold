"""Skill content loader for the Agent Playground.

Fetches skill content from the Go backend's SkillService.GetSkill RPC via
ConnectRPC (HTTP/JSON). Skill content is injected into the agent's system
prompt so the agent adopts the skill's instructions/personality.

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


def fetch_skill(skill_id: str, backend_addr: str = "localhost:8080") -> dict[str, Any] | None:
    """
    Fetch a single skill by ID from the Go backend's SkillService.GetSkill.

    Returns a dict with keys: id, name, description, content, tags.
    Returns None on error.
    """
    client = _get_http_client()
    url = f"http://{backend_addr}/skill.v1.SkillService/GetSkill"

    payload = {"id": skill_id}
    headers = {"Content-Type": "application/json"}

    try:
        resp = client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

        return {
            "id": data.get("id", skill_id),
            "name": data.get("name", ""),
            "description": data.get("description", ""),
            "content": data.get("content", ""),
            "tags": data.get("tags", []),
        }
    except httpx.HTTPStatusError as e:
        log.error(
            "skill_loader: fetch failed for %s (HTTP %d): %s",
            skill_id, e.response.status_code, e.response.text[:500],
        )
        return None
    except Exception as e:
        log.error("skill_loader: fetch error for %s: %s", skill_id, str(e))
        return None


def fetch_skills(skill_ids: list[str], backend_addr: str = "localhost:8080") -> list[dict[str, Any]]:
    """
    Fetch multiple skills by ID. Returns only successfully fetched skills.
    """
    skills = []
    for sid in skill_ids:
        skill = fetch_skill(sid, backend_addr=backend_addr)
        if skill and skill.get("content"):
            skills.append(skill)
            log.info("skill_loader: loaded skill %s (%s)", sid, skill.get("name", ""))
        else:
            log.warning("skill_loader: skipping skill %s (not found or empty content)", sid)
    return skills


def build_skill_prompt_section(skills: list[dict[str, Any]]) -> str:
    """
    Build a system prompt section from fetched skill data.

    Each skill's content is wrapped in a named section so the agent can
    identify which skill instructions apply.
    """
    if not skills:
        return ""

    sections = []
    for skill in skills:
        name = skill.get("name", skill.get("id", "Unknown"))
        content = skill.get("content", "")
        if content:
            sections.append(
                f"### Skill: {name}\n\n{content}"
            )

    if not sections:
        return ""

    return "## Active Skills\n\n" + "\n\n---\n\n".join(sections)
