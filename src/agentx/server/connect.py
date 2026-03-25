"""
A2A Scaffold — ASGI dispatcher for Connect protocol.

Stripped version: no JWT authentication, static agent card from config.
"""
from __future__ import annotations

import json
import os
import time
from typing import Any

_CONNECT_CONTENT_TYPES = frozenset({
    "application/grpc",
    "application/grpc+proto",
    "application/grpc-web",
    "application/grpc-web+proto",
    "application/proto",
    "application/connect+proto",
    "application/json",
    "application/connect+json",
})


async def _http_response(send: Any, status: int, body: bytes) -> None:
    await send({"type": "http.response.start", "status": status, "headers": [
        [b"content-type", b"application/json"],
    ]})
    await send({"type": "http.response.body", "body": body})


async def _json_response(send: Any, status: int, data: Any) -> None:
    body = json.dumps(data).encode()
    headers = [
        [b"content-type", b"application/json"],
        [b"access-control-allow-origin", b"*"],
    ]
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})


async def _cors_preflight(send: Any) -> None:
    headers = [
        [b"access-control-allow-origin", b"*"],
        [b"access-control-allow-methods", b"POST, GET, OPTIONS"],
        [b"access-control-allow-headers", b"Content-Type"],
        [b"access-control-max-age", b"86400"],
    ]
    await send({"type": "http.response.start", "status": 204, "headers": headers})
    await send({"type": "http.response.body", "body": b""})


def build_connect_app(
    asgi_apps: list[Any],
    jwt_validator: Any | None = None,  # ignored in scaffold
    agent_name: str = "A2A Agent",
    agent_description: str = "",
    **kwargs: Any,
) -> Any:
    return _DispatchASGI(asgi_apps, agent_name=agent_name, agent_description=agent_description)


class _DispatchASGI:
    """Minimal ASGI dispatcher — routes Connect/gRPC requests to service apps.
    Also serves static frontend files and manages agent configuration."""

    STATIC_DIR = os.environ.get("STATIC_DIR", "/usr/share/nginx/html")
    AGENT_MD_PATH = os.environ.get("AGENT_MD_PATH", "/agent/config/AGENT.md")
    SKILLS_DIR = os.environ.get("SKILLS_DIR", "/agent/config/skills")

    def __init__(self, apps: list[Any], agent_name: str = "", agent_description: str = "") -> None:
        self._apps = apps
        self._agent_name = agent_name
        self._agent_description = agent_description
        self._load_agent_config()

    def _parse_agent_md(self, path: str) -> dict:
        """Parse AGENT.md: frontmatter → metadata, body → system_prompt."""
        import os, re
        if not os.path.isfile(path):
            return {}
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()

        cfg: dict = {}
        body = content

        # Parse YAML frontmatter (--- ... ---)
        fm_match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
        if fm_match:
            import yaml
            try:
                fm = yaml.safe_load(fm_match.group(1)) or {}
                cfg.update(fm)
            except Exception:
                pass
            body = content[fm_match.end():]

        # Body IS the system prompt (stripped of leading/trailing whitespace)
        cfg["system_prompt"] = body.strip()

        # First line of body (up to first newline) serves as short description
        first_line = body.strip().split("\n")[0].strip().lstrip("#").strip() if body.strip() else ""
        if first_line:
            cfg.setdefault("description", first_line[:200])

        return cfg

    def _write_agent_md(self, cfg: dict) -> None:
        """Write agent config as AGENT.md: frontmatter + system_prompt as body."""
        import os
        os.makedirs(os.path.dirname(self.AGENT_MD_PATH), exist_ok=True)

        fm_fields = {}
        for key in ["name", "version", "iconUrl", "documentationUrl"]:
            if cfg.get(key):
                fm_fields[key] = cfg[key]
        if cfg.get("provider") and cfg["provider"].get("organization"):
            fm_fields["provider"] = cfg["provider"]

        import yaml
        frontmatter = yaml.dump(fm_fields, default_flow_style=False, allow_unicode=True).strip()
        system_prompt = cfg.get("system_prompt", "")

        md = f"---\n{frontmatter}\n---\n\n{system_prompt}\n"
        with open(self.AGENT_MD_PATH, "w", encoding="utf-8") as f:
            f.write(md)

    def _load_agent_config(self) -> None:
        """Load agent config from AGENT.md."""
        import os
        if os.path.isfile(self.AGENT_MD_PATH):
            cfg = self._parse_agent_md(self.AGENT_MD_PATH)
            if cfg.get("name"):
                self._agent_name = cfg["name"]
            if cfg.get("description"):
                self._agent_description = cfg["description"]

    def _save_agent_config(self, cfg: dict) -> None:
        """Save agent config to AGENT.md only (no JSON cache)."""
        self._write_agent_md(cfg)
        self._agent_name = cfg.get("name", self._agent_name)
        self._agent_description = cfg.get("description", self._agent_description)

    def _scan_skills(self) -> list[dict]:
        """Scan skills directory for .md files and return skill list."""
        import os, re
        skills = []
        if not os.path.isdir(self.SKILLS_DIR):
            return skills
        for fn in sorted(os.listdir(self.SKILLS_DIR)):
            if not fn.endswith(".md"):
                continue
            skill_id = fn.rsplit(".", 1)[0]
            filepath = os.path.join(self.SKILLS_DIR, fn)
            # Read first 5 lines for description
            desc = ""
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    lines = f.readlines()[:5]
                    for line in lines:
                        stripped = line.strip().lstrip("#").strip()
                        if stripped and not stripped.startswith("---"):
                            desc = stripped
                            break
            except Exception:
                pass
            skills.append({
                "id": skill_id,
                "name": skill_id.replace("-", " ").replace("_", " ").title(),
                "description": desc or f"Skill: {skill_id}",
                "tags": ["skill"],
            })
        return skills

    def _build_agent_card(self, base_url: str = "") -> dict:
        """Build A2A v1.0 compliant agent card from AGENT.md + skills."""
        import os

        cfg = self._parse_agent_md(self.AGENT_MD_PATH) if os.path.isfile(self.AGENT_MD_PATH) else {}

        name = cfg.get("name", self._agent_name) or "A2A Agent"
        description = cfg.get("description", self._agent_description) or ""
        version = cfg.get("version", "1.0.0")
        icon_url = cfg.get("iconUrl", "")

        # Scan skills from filesystem
        skills = self._scan_skills()
        # Merge any custom skills from config
        custom_skills = cfg.get("skills", [])
        if custom_skills:
            existing_ids = {s["id"] for s in skills}
            for cs in custom_skills:
                if cs.get("id") and cs["id"] not in existing_ids:
                    skills.append(cs)

        if not skills:
            skills = [{"id": "chat", "name": "General Chat", "description": "General-purpose conversation", "tags": ["chat"]}]

        # Build the card (A2A v1.0 spec)
        if not base_url:
            base_url = cfg.get("url", "http://localhost:8080")

        card: dict[str, Any] = {
            "name": name,
            "description": description,
            "version": version,
            "supportedInterfaces": [
                {"url": base_url, "protocolBinding": "HTTP+JSON", "protocolVersion": "1.0"},
                {"url": base_url, "protocolBinding": "GRPC", "protocolVersion": "1.0"},
            ],
            "capabilities": {"streaming": True},
            "defaultInputModes": ["text/plain", "application/json"],
            "defaultOutputModes": ["text/plain", "application/json"],
            "skills": skills,
        }

        if cfg.get("provider"):
            card["provider"] = cfg["provider"]
        elif not cfg.get("provider"):
            card["provider"] = {"organization": "A2A Scaffold"}

        if icon_url:
            card["iconUrl"] = icon_url
        if cfg.get("documentationUrl"):
            card["documentationUrl"] = cfg["documentationUrl"]

        return card

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] == "lifespan":
            for app in self._apps:
                try:
                    await app(scope, receive, send)
                except Exception:
                    pass
            return

        path = scope.get("path", "")
        method = scope.get("method", "GET")

        # ── Agent card (A2A v1.0 standard discovery) ──
        if path == "/.well-known/agent-card.json":
            if method == "GET":
                await self._serve_agent_card(scope, receive, send)
                return
            if method == "OPTIONS":
                await _cors_preflight(send)
                return

        # ── Agent config REST API ──
        if path == "/api/agent":
            if method == "GET":
                await self._handle_get_agent(scope, receive, send)
                return
            if method == "PUT":
                await self._handle_put_agent(scope, receive, send)
                return
            if method == "OPTIONS":
                await _cors_preflight(send)
                return

        # ── Health check ──
        if path == "/healthz":
            await _http_response(send, 200, b'{"status":"ok"}')
            return

        # ── File upload REST API (scaffold-only, not part of A2A proto) ──
        if path == "/api/upload" and method == "POST":
            await self._handle_file_upload(scope, receive, send)
            return
        if path == "/api/upload" and method == "OPTIONS":
            await _cors_preflight(send)
            return

        # ── List uploaded files ──
        if path == "/api/files" and method == "GET":
            await self._handle_list_files(scope, receive, send)
            return

        # ── Connect/gRPC (POST with correct content-type) ──
        if scope["type"] == "http" and method == "POST":
            content_type = ""
            for header_name, header_value in scope.get("headers", []):
                if header_name == b"content-type":
                    content_type = header_value.decode().split(";")[0].strip()
                    break
            if content_type in _CONNECT_CONTENT_TYPES:
                for app in self._apps:
                    try:
                        await app(scope, receive, send)
                        return
                    except Exception:
                        continue

        # ── Static files (frontend SPA) ──
        if scope["type"] == "http" and method == "GET":
            await self._serve_static(scope, receive, send, path)
            return

        await _http_response(send, 404, b'{"error": "not found"}')

    async def _serve_static(self, scope: Any, receive: Any, send: Any, path: str) -> None:
        """Serve static files from STATIC_DIR. Falls back to index.html for SPA routing."""
        import os
        import mimetypes

        if path == "/":
            path = "/index.html"

        file_path = os.path.join(self.STATIC_DIR, path.lstrip("/"))

        # SPA fallback: if file doesn't exist, serve index.html
        if not os.path.isfile(file_path):
            file_path = os.path.join(self.STATIC_DIR, "index.html")

        if not os.path.isfile(file_path):
            await _http_response(send, 404, b'{"error": "not found"}')
            return

        content_type, _ = mimetypes.guess_type(file_path)
        if not content_type:
            content_type = "application/octet-stream"

        with open(file_path, "rb") as f:
            body = f.read()

        headers = [
            [b"content-type", content_type.encode()],
            [b"content-length", str(len(body)).encode()],
        ]
        # Cache static assets with hashes
        if "/assets/" in path:
            headers.append([b"cache-control", b"public, max-age=31536000, immutable"])
        else:
            headers.append([b"cache-control", b"no-cache"])

        await send({"type": "http.response.start", "status": 200, "headers": headers})
        await send({"type": "http.response.body", "body": body})

    async def _serve_agent_card(self, scope: Any, receive: Any, send: Any) -> None:
        """Serve A2A v1.0 agent card — dynamically built from config + skills."""
        host = ""
        for header_name, header_value in scope.get("headers", []):
            if header_name == b"host":
                host = header_value.decode()
        # Use https for all non-localhost hosts
        scheme = "http" if host and ("localhost" in host or "127.0.0.1" in host) else "https"
        base_url = f"{scheme}://{host}" if host else ""

        card = self._build_agent_card(base_url)
        body = json.dumps(card, indent=2, ensure_ascii=False).encode()
        headers = [
            [b"content-type", b"application/json"],
            [b"access-control-allow-origin", b"*"],
            [b"access-control-allow-methods", b"GET, OPTIONS"],
            [b"cache-control", b"no-cache"],
        ]
        await send({"type": "http.response.start", "status": 200, "headers": headers})
        await send({"type": "http.response.body", "body": body})

    async def _handle_get_agent(self, scope: Any, receive: Any, send: Any) -> None:
        """GET /api/agent — return current agent config from AGENT.md."""
        import os
        cfg = self._parse_agent_md(self.AGENT_MD_PATH) if os.path.isfile(self.AGENT_MD_PATH) else {}
        cfg.setdefault("name", self._agent_name)
        cfg.setdefault("description", self._agent_description)
        cfg.setdefault("version", "1.0.0")
        cfg.setdefault("provider", {"organization": ""})
        cfg["_scannedSkills"] = self._scan_skills()
        if os.path.isfile(self.AGENT_MD_PATH):
            with open(self.AGENT_MD_PATH, "r", encoding="utf-8") as f:
                cfg["_agentMd"] = f.read()
        await _json_response(send, 200, cfg)

    async def _handle_put_agent(self, scope: Any, receive: Any, send: Any) -> None:
        """PUT /api/agent — save agent config."""
        body = b""
        while True:
            message = await receive()
            body += message.get("body", b"")
            if not message.get("more_body", False):
                break
        try:
            cfg = json.loads(body)
            # Remove internal fields
            cfg.pop("_scannedSkills", None)
            self._save_agent_config(cfg)
            await _json_response(send, 200, {"ok": True})
        except Exception as e:
            await _json_response(send, 400, {"error": str(e)})

    # ── File upload handler ──────────────────────────────────────────────
    UPLOAD_DIR = os.environ.get("AGENT_DATA_DIR", "/agent/data") + "/uploads"

    async def _handle_file_upload(self, scope: Any, receive: Any, send: Any) -> None:
        """Handle multipart file upload — saves files to UPLOAD_DIR.
        
        Expects multipart/form-data with:
        - files: one or more files
        - path: (optional) relative subdirectory within UPLOAD_DIR
        
        Returns JSON: {"files": [{"name": "...", "path": "...", "size": 123}]}
        """
        import os

        # Read the entire request body
        body = b""
        while True:
            message = await receive()
            body += message.get("body", b"")
            if not message.get("more_body", False):
                break

        # Parse content-type for boundary
        content_type = ""
        for header_name, header_value in scope.get("headers", []):
            if header_name == b"content-type":
                content_type = header_value.decode()
                break

        if "multipart/form-data" not in content_type:
            await _json_response(send, 400, {"error": "Expected multipart/form-data"})
            return

        # Extract boundary
        boundary = None
        for part in content_type.split(";"):
            part = part.strip()
            if part.startswith("boundary="):
                boundary = part[9:].strip('"')
                break

        if not boundary:
            await _json_response(send, 400, {"error": "Missing boundary in content-type"})
            return

        # Parse multipart parts
        saved_files = []
        rel_path = ""
        boundary_bytes = f"--{boundary}".encode()
        parts = body.split(boundary_bytes)

        for part in parts:
            if not part or part == b"--\r\n" or part == b"--":
                continue

            # Split headers from body
            header_end = part.find(b"\r\n\r\n")
            if header_end == -1:
                continue
            
            part_headers = part[:header_end].decode("utf-8", errors="replace")
            part_body = part[header_end + 4:]
            # Remove trailing \r\n
            if part_body.endswith(b"\r\n"):
                part_body = part_body[:-2]

            # Extract Content-Disposition
            filename = None
            field_name = None
            for line in part_headers.split("\r\n"):
                if "Content-Disposition:" in line:
                    for item in line.split(";"):
                        item = item.strip()
                        if item.startswith("filename="):
                            filename = item[9:].strip('"')
                        elif item.startswith("name="):
                            field_name = item[5:].strip('"')

            # "path" field — relative subdirectory
            if field_name == "path" and not filename:
                rel_path = part_body.decode("utf-8", errors="replace").strip()
                # Sanitize: no traversal
                rel_path = rel_path.replace("..", "").lstrip("/")
                continue

            # File field
            if filename:
                # Sanitize filename
                safe_name = os.path.basename(filename)
                if not safe_name:
                    continue

                upload_dir = os.path.join(self.UPLOAD_DIR, rel_path) if rel_path else self.UPLOAD_DIR
                os.makedirs(upload_dir, exist_ok=True)

                file_path = os.path.join(upload_dir, safe_name)
                with open(file_path, "wb") as f:
                    f.write(part_body)

                display_path = os.path.join(rel_path, safe_name) if rel_path else safe_name
                saved_files.append({
                    "name": safe_name,
                    "path": f"/agent/data/uploads/{display_path}",
                    "size": len(part_body),
                })

        await _json_response(send, 200, {"files": saved_files, "count": len(saved_files)})

    async def _handle_list_files(self, scope: Any, receive: Any, send: Any) -> None:
        """List uploaded files in UPLOAD_DIR."""
        import os

        files = []
        if os.path.isdir(self.UPLOAD_DIR):
            for root, dirs, filenames in os.walk(self.UPLOAD_DIR):
                for fn in filenames:
                    full_path = os.path.join(root, fn)
                    rel = os.path.relpath(full_path, self.UPLOAD_DIR)
                    files.append({
                        "name": fn,
                        "path": f"/agent/data/uploads/{rel}",
                        "size": os.path.getsize(full_path),
                    })

        await _json_response(send, 200, {"files": files, "count": len(files)})
