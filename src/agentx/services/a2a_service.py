"""
A2A Gateway gRPC servicer — pure inference engine.

Implements the inference-only methods:
- SendStreamingMessage / LfSendStreamingMessage: stream Strands agent responses
- SendMessage: store a user message (in-memory only for current session)
- GetTask / ListTasks / CancelTask / GetAgentCard: A2A protocol stubs

Session metadata, message history, and long-term memory are managed entirely
by the Go backend (agentx.v1.A2AService). This service holds NO database
credentials and makes NO AWS API calls for storage.

Playground mode:
  When msg.metadata contains "playground_config", the servicer creates or
  reuses a per-config agent with dynamically selected tools (KB retrieval,
  filtered MCP tools) instead of the global singleton.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import logging
import time
import uuid
from dataclasses import dataclass, field as dc_field
from typing import Any, AsyncIterator

import structlog

log = structlog.get_logger(__name__)
_std_log = logging.getLogger(__name__)

# ── Strands Agent singleton (lazy-init on first request) ──────────────────────
_agent = None

# ── Playground agent cache (keyed by config hash) ─────────────────────────────
_playground_agents: dict[str, Any] = {}


@dataclass
class PlaygroundConfig:
    """Parsed playground configuration from msg.metadata.playground_config."""
    skill_ids: list[str] = dc_field(default_factory=list)
    mcp_server_ids: list[str] = dc_field(default_factory=list)
    knowledge_base_ids: list[str] = dc_field(default_factory=list)
    document_ids: list[str] = dc_field(default_factory=list)
    model_id: str = ""
    system_prompt: str = ""

    @property
    def cache_key(self) -> str:
        """Deterministic hash for agent caching."""
        data = json.dumps({
            "skills": sorted(self.skill_ids),
            "mcp": sorted(self.mcp_server_ids),
            "kb": sorted(self.knowledge_base_ids),
            "docs": sorted(self.document_ids),
            "model": self.model_id,
            "prompt": self.system_prompt[:200],  # truncate for key stability
        }, sort_keys=True)
        return hashlib.sha256(data.encode()).hexdigest()[:16]

    @classmethod
    def from_metadata(cls, meta_dict: dict) -> "PlaygroundConfig | None":
        """Parse playground_config from metadata dict. Returns None if not present."""
        cfg = meta_dict.get("playground_config") or meta_dict.get("playgroundConfig")
        if not cfg or not isinstance(cfg, dict):
            return None
        return cls(
            skill_ids=cfg.get("skill_ids", cfg.get("skillIds", [])),
            mcp_server_ids=cfg.get("mcp_server_ids", cfg.get("mcpServerIds", [])),
            knowledge_base_ids=cfg.get("knowledge_base_ids", cfg.get("knowledgeBaseIds", [])),
            document_ids=cfg.get("document_ids", cfg.get("documentIds", [])),
            model_id=cfg.get("model_id", cfg.get("modelId", "")),
            system_prompt=cfg.get("system_prompt", cfg.get("systemPrompt", "")),
        )


def _get_base_tools() -> list[Any]:
    """Return the standard set of Strands tools (shared across all agents)."""
    from strands_tools import (
        shell, file_read, file_write, editor,
        http_request, think, python_repl, batch,
        current_time, use_agent, calculator, environment,
    )
    tools: list[Any] = [
        shell, file_read, file_write, editor,
        http_request, think, python_repl, batch,
        current_time, use_agent, calculator, environment,
    ]
    try:
        from agentx.tools.todo_tool import todowrite, todoread
        tools.extend([todowrite, todoread])
    except Exception:
        pass
    try:
        from agentx.tools.copilot_demo_tools import (
            set_ui_theme, update_recipe, confirm_dangerous_action, run_progress_task,
        )
        tools.extend([set_ui_theme, update_recipe, confirm_dangerous_action, run_progress_task])
    except Exception:
        pass
    # Add connector token tool (for GitHub/GitLab PAT retrieval at runtime)
    try:
        from agentx.tools.connector_tool import get_connector_token_tool
        token_tool = get_connector_token_tool()
        if token_tool:
            tools.append(token_tool)
    except Exception:
        pass
    return tools


# Module-level: system prompt from AGENT.md (set by A2AServicer.__init__)
_agent_md_system_prompt: str = ""


def _get_default_system_prompt() -> str:
    """Return the default system prompt. Uses AGENT.md content if available."""
    if _agent_md_system_prompt:
        return _agent_md_system_prompt
    try:
        from agentx.prompts.system import SYSTEM_PROMPT
        return SYSTEM_PROMPT
    except Exception:
        return (
            "You are a helpful AI coding assistant with access to shell, file operations, "
            "Python execution, and other tools.\n\n"
            "IMPORTANT: Each user message includes a [Working directory: /path] prefix. "
            "Always use that path as the working directory for shell commands (cd to it first) "
            "and as the base path for file operations. Never ignore the working directory.\n\n"
            "When asked to run commands like pwd, ls, cat, etc., execute them using the shell tool "
            "in the specified working directory."
        )


def _create_model(model_id: str) -> Any:
    """Create an AI model instance based on available credentials.

    Supports:
    - AWS Bedrock (default): uses BedrockModel with IAM or API key auth
    - Anthropic API: uses AnthropicModel when ANTHROPIC_API_KEY is set
      - ANTHROPIC_BASE_URL: custom endpoint (e.g. proxy or self-hosted)
    """
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if anthropic_key:
        try:
            from strands.models.anthropic import AnthropicModel
            kwargs: dict[str, Any] = {"model_id": model_id, "max_tokens": 16384}
            base_url = os.environ.get("ANTHROPIC_BASE_URL", "")
            if base_url:
                kwargs["base_url"] = base_url
            return AnthropicModel(**kwargs)
        except ImportError:
            _std_log.warning("strands AnthropicModel not available, falling back to Bedrock")

    # Default: Bedrock
    from strands.models.bedrock import BedrockModel
    return BedrockModel(
        model_id=model_id,
        region_name=os.environ.get("AWS_DEFAULT_REGION", "us-west-2"),
        max_tokens=16384,
    )


def _get_or_create_agent(
    model_id: str,
    skills_dir: str,
    mcp_tools: list[Any] | None = None,
) -> Any:
    """
    Create Strands Agent lazily (module-level singleton).

    mcp_tools: pre-loaded MCP tool callables from mcp_loader.get_mcp_tools().
               Must be collected before entering the executor thread because
               MCPClient initialisation is async.
    """
    global _agent
    if _agent is not None:
        return _agent

    from strands import Agent
    model = _create_model(model_id)

    tools = _get_base_tools()

    # Append MCP tools (already initialised in async context by mcp_loader)
    if mcp_tools:
        tools.extend(mcp_tools)
        _std_log.info("strands.mcp_tools.added count=%d", len(mcp_tools))

    system_prompt = _get_default_system_prompt()

    plugins = []
    try:
        from pathlib import Path
        sd = Path(skills_dir)
        if sd.is_dir() and any(sd.iterdir()):
            from strands.vended_plugins.skills import AgentSkills
            plugins.append(AgentSkills(skills=[str(skills_dir)]))
            _std_log.info("strands.skills.loaded dir=%s", skills_dir)
    except Exception as e:
        _std_log.warning("strands.skills.error: %s", str(e))

    _agent = Agent(
        model=model,
        tools=tools,
        system_prompt=system_prompt,
        callback_handler=None,
        plugins=plugins if plugins else None,
    )
    _std_log.info(
        "strands.agent.created model=%s tools=%d mcp=%d",
        model_id, len(tools), len(mcp_tools or []),
    )
    return _agent


def _get_or_create_playground_agent(
    pg_config: PlaygroundConfig,
    default_model_id: str,
    mcp_tools: list[Any] | None = None,
    backend_addr: str = "localhost:8081",
    pre_loaded_docs: list[dict[str, Any]] | None = None,
    work_dir: str | None = None,
) -> Any:
    """
    Create or retrieve a cached Strands Agent configured for Playground mode.

    Unlike the singleton agent, playground agents are keyed by their
    configuration hash so different configs get different agent instances.

    Integrates:
      - Skills: fetched from Go backend SkillService, content injected into system prompt
      - Knowledge Bases: KB retrieval tool added to tools
      - Documents: fetched from Go backend LibraryService, content injected into system
        prompt (small docs) or as a search tool (large docs)
      - MCP Servers: connector config fetched from Go backend ConnectorService,
        Strands MCPClient instances created for each
    """
    global _playground_agents
    cache_key = pg_config.cache_key
    if cache_key in _playground_agents:
        _std_log.info("playground.agent.cache_hit key=%s", cache_key)
        return _playground_agents[cache_key]

    from strands import Agent

    model_id = pg_config.model_id or default_model_id
    model = _create_model(model_id)

    tools = _get_base_tools()

    # ── MCP Tools ──────────────────────────────────────────────────────────
    # If specific MCP server IDs are selected, fetch their configs from Go
    # backend and create per-server MCPClient instances.
    if pg_config.mcp_server_ids:
        try:
            from agentx.tools.mcp_loader import fetch_connectors, create_mcp_tools_for_connectors
            connectors = fetch_connectors(
                pg_config.mcp_server_ids, backend_addr=backend_addr,
            )
            if connectors:
                # create_mcp_tools_for_connectors is synchronous — it creates
                # MCPClient instances with transport_callable. The actual
                # connection is established lazily by Strands Agent on first use.
                mcp_connector_tools = create_mcp_tools_for_connectors(connectors)
                if mcp_connector_tools:
                    tools.extend(mcp_connector_tools)
                    _std_log.info(
                        "playground.mcp_tools.added count=%d from connectors=%s",
                        len(mcp_connector_tools), pg_config.mcp_server_ids,
                    )

                # ── Auto-inject built-in Connector Skills for APP connectors ──
                # When an APP connector (GitHub, GitLab) is selected, automatically
                # inject its corresponding built-in skill into the system prompt.
                # The skill tells the Agent how to use get_connector_token() to
                # retrieve the user's PAT at runtime.
                try:
                    from agentx.skills import get_connector_skill
                    from agentx.tools.skill_loader import build_skill_prompt_section
                    connector_skills = []
                    for conn in connectors:
                        app_type = conn.get("app_type", conn.get("appType", ""))
                        if app_type:
                            skill = get_connector_skill(app_type, conn.get("id", ""))
                            if skill:
                                connector_skills.append(skill)
                    if connector_skills:
                        connector_skill_section = build_skill_prompt_section(connector_skills)
                        if connector_skill_section:
                            system_prompt += "\n\n" + connector_skill_section
                            _std_log.info(
                                "playground.connector_skills.injected count=%d",
                                len(connector_skills),
                            )
                except Exception as e:
                    _std_log.warning("playground.connector_skills.error: %s", str(e))
        except Exception as e:
            _std_log.warning("playground.mcp_tools.error: %s", str(e))
    elif mcp_tools:
        # Fallback: use globally pre-loaded MCP tools
        tools.extend(mcp_tools)

    # ── KB Retrieval Tool ──────────────────────────────────────────────────
    if pg_config.knowledge_base_ids:
        try:
            from agentx.tools.kb_tool import make_kb_retrieve_tool
            kb_tool = make_kb_retrieve_tool(
                pg_config.knowledge_base_ids,
                backend_addr=backend_addr,
            )
            tools.append(kb_tool)
            _std_log.info(
                "playground.kb_tool.added kb_ids=%s",
                pg_config.knowledge_base_ids,
            )
        except Exception as e:
            _std_log.warning("playground.kb_tool.error: %s", str(e))

    # ── Document Tool ──────────────────────────────────────────────────────
    loaded_documents: list[dict] = []
    if pg_config.document_ids:
        try:
            from agentx.tools.doc_tool import (
                fetch_documents,
                make_document_search_tool,
                download_document_file,
                read_text_file,
            )

            if pre_loaded_docs is not None:
                # Documents were already downloaded to work_dir by the caller
                loaded_documents = pre_loaded_docs
                _std_log.info(
                    "playground.doc.pre_loaded docs=%d",
                    len(loaded_documents),
                )
            else:
                # Fallback: download to temp dir (legacy path for non-Lf callers)
                loaded_documents = fetch_documents(
                    pg_config.document_ids, backend_addr=backend_addr,
                )
                import tempfile, os
                tmp_dir = tempfile.mkdtemp(prefix="agentx-doc-")
                for doc in loaded_documents:
                    file_url = doc.get("file_url", "")
                    if not file_url:
                        continue
                    file_name = doc.get("file_name", "")
                    if doc.get("content", "").strip() == file_name.strip():
                        doc["content"] = ""
                    local_path = download_document_file(
                        doc["id"], tmp_dir, backend_addr=backend_addr,
                    )
                    if local_path:
                        doc["local_path"] = local_path
                        text_content = read_text_file(local_path)
                        if text_content:
                            doc["content"] = text_content
                        else:
                            _std_log.info(
                                "playground.doc.binary_file doc_id=%s path=%s",
                                doc["id"], local_path,
                            )

            # For documents with substantial content, add a search tool
            docs_with_content = [d for d in loaded_documents if d.get("content")]
            total_content_len = sum(len(d.get("content", "")) for d in docs_with_content)
            if docs_with_content and total_content_len > 5000:
                # Large content: provide a search tool instead of cramming into prompt
                doc_search_tool = make_document_search_tool(docs_with_content)
                if doc_search_tool:
                    tools.append(doc_search_tool)
                    _std_log.info(
                        "playground.doc_tool.added docs=%d total_chars=%d",
                        len(docs_with_content), total_content_len,
                    )
        except Exception as e:
            _std_log.warning("playground.doc_tool.error: %s", str(e))

    # ── System Prompt Assembly ─────────────────────────────────────────────
    system_prompt = pg_config.system_prompt or _get_default_system_prompt()

    # Fetch and inject skill content into system prompt
    loaded_skills: list[dict] = []
    if pg_config.skill_ids:
        try:
            from agentx.tools.skill_loader import fetch_skills, build_skill_prompt_section
            loaded_skills = fetch_skills(
                pg_config.skill_ids, backend_addr=backend_addr,
            )
            skill_section = build_skill_prompt_section(loaded_skills)
            if skill_section:
                system_prompt += "\n\n" + skill_section
                _std_log.info(
                    "playground.skills.injected count=%d ids=%s",
                    len(loaded_skills), pg_config.skill_ids,
                )
        except Exception as e:
            _std_log.warning("playground.skills.error: %s", str(e))

    # Inject small document content directly into system prompt
    if loaded_documents:
        try:
            from agentx.tools.doc_tool import build_document_prompt_section
            docs_with_content = [d for d in loaded_documents if d.get("content")]
            total_content_len = sum(len(d.get("content", "")) for d in docs_with_content)
            if docs_with_content and total_content_len <= 5000:
                # Small enough to include inline
                doc_section = build_document_prompt_section(docs_with_content)
                if doc_section:
                    system_prompt += "\n\n" + doc_section
                    _std_log.info(
                        "playground.docs.injected_inline count=%d chars=%d",
                        len(docs_with_content), total_content_len,
                    )
            elif docs_with_content:
                # Large content is in the search tool; just note in prompt
                doc_names = ", ".join(d.get("title", d.get("id", "?")) for d in docs_with_content)
                system_prompt += (
                    f"\n\n## Reference Documents\n"
                    f"You have access to a document_search tool that can search "
                    f"through these documents: {doc_names}. Use it when the user "
                    f"asks questions that might be answered by these documents."
                )

            # Note all documents that have local files in the work directory
            docs_with_files = [d for d in loaded_documents if d.get("local_path")]
            if docs_with_files:
                file_notes = []
                for d in docs_with_files:
                    file_notes.append(f"  - {d.get('title', 'Unknown')}: `{d['local_path']}`")
                system_prompt += (
                    f"\n\n## Document Files in Working Directory\n"
                    f"The following document files are available in the working "
                    f"directory. You can read them directly with file_read:\n"
                    + "\n".join(file_notes)
                )
        except Exception as e:
            _std_log.warning("playground.docs.prompt.error: %s", str(e))

    # Append playground context summary
    context_parts = []
    if pg_config.knowledge_base_ids:
        context_parts.append(
            f"You have access to a knowledge_base_search tool that searches "
            f"these knowledge bases: {', '.join(pg_config.knowledge_base_ids)}. "
            f"Use it when the user asks questions that might be answered by "
            f"the knowledge base documents."
        )
    if pg_config.mcp_server_ids:
        context_parts.append(
            f"MCP server tools are available from connectors: "
            f"{', '.join(pg_config.mcp_server_ids)}."
        )
    if context_parts:
        system_prompt += "\n\n## Playground Context\n" + "\n".join(context_parts)

    agent = Agent(
        model=model,
        tools=tools,
        system_prompt=system_prompt,
        callback_handler=None,
    )

    # Cache with a reasonable limit (evict oldest if too many)
    if len(_playground_agents) > 50:
        oldest_key = next(iter(_playground_agents))
        del _playground_agents[oldest_key]
    _playground_agents[cache_key] = agent

    _std_log.info(
        "playground.agent.created key=%s model=%s tools=%d kb=%d skills=%d docs=%d mcp=%s",
        cache_key, model_id, len(tools),
        len(pg_config.knowledge_base_ids),
        len(loaded_skills),
        len(loaded_documents),
        len(pg_config.mcp_server_ids),
    )
    return agent


class A2AServicer:
    """gRPC servicer — pure Strands agent inference, no database access."""

    def __init__(
        self,
        model_id: str = "us.anthropic.claude-opus-4-6-v1",
        pty_manager: Any = None,
        skills_dir: str = "/agent/config/skills",
        mcp_config: str = "/agent/config/mcp.json",
        redis_hook: Any = None,
        backend_addr: str = "localhost:8081",
        default_system_prompt: str = "",
    ) -> None:
        self._model_id = model_id
        self._default_system_prompt = default_system_prompt
        # Set module-level override so _get_or_create_agent uses AGENT.md prompt
        global _agent_md_system_prompt
        _agent_md_system_prompt = default_system_prompt
        self._pty = pty_manager
        self._skills_dir = skills_dir
        self._mcp_config = mcp_config
        self._redis_hook = redis_hook
        self._backend_addr = backend_addr
        # In-memory agent message state (per session, current pod lifetime only)
        # Persistence is handled by the Go backend via agentx.v1.A2AService.
        self._agent_messages: dict[str, list[dict[str, Any]]] = {}

    async def _load_agent_config(self, agent_id: str) -> "PlaygroundConfig | None":
        """Load an agent's configuration from the Go backend and convert to PlaygroundConfig."""
        import grpc
        import sys as _sys
        # Fix gRPC stub import path
        if 'agentx.v1' not in _sys.modules:
            _sys.modules['agentx.v1'] = __import__('agentx.generated.agentx.v1', fromlist=['agentx_pb2'])
        from agentx.generated.agentx.v1 import agentx_pb2, agentx_pb2_grpc

        try:
            grpc_addr = self._backend_addr.replace(":8080", ":8081") if ":8080" in self._backend_addr else self._backend_addr
            async with grpc.aio.insecure_channel(grpc_addr) as channel:
                stub = agentx_pb2_grpc.AgentServiceStub(channel)
                agent_pb = await stub.GetAgent(agentx_pb2.GetAgentRequest(id=agent_id))

            from google.protobuf.json_format import MessageToDict
            agent = MessageToDict(agent_pb, preserving_proto_field_name=False)

            config_dict: dict[str, Any] = {}
            if agent.get("skills"):
                config_dict["skill_ids"] = [ref.get("id", ref) if isinstance(ref, dict) else ref for ref in agent["skills"]]
            if agent.get("mcpServers"):
                config_dict["mcp_server_ids"] = [ref.get("id", ref) if isinstance(ref, dict) else ref for ref in agent["mcpServers"]]
            if agent.get("knowledgeBases"):
                config_dict["knowledge_base_ids"] = [ref.get("id", ref) if isinstance(ref, dict) else ref for ref in agent["knowledgeBases"]]
            if agent.get("documents"):
                config_dict["document_ids"] = [ref.get("id", ref) if isinstance(ref, dict) else ref for ref in agent["documents"]]
            if agent.get("systemPrompt"):
                config_dict["system_prompt"] = agent["systemPrompt"]

            if not config_dict:
                return None

            return PlaygroundConfig.from_metadata({"playground_config": config_dict})
        except Exception as e:
            import sys
            print(f"[a2a-agent] GetAgent({agent_id}) failed: {e}", file=sys.stderr, flush=True)
            return None

    def _resolve_workdir(self, project_id: str = "", context_id: str = "", user_sub: str = "") -> str:
        """Resolve the working directory for a session.

        Pattern: /agent/data/{project_id}
        - project_id from metadata.project_id (Chat page sends this)
        - user_sub from metadata.user_sub (Document Test sends this)
        - context_id fallback for Skill Creator ("skill-creator-{sub}")
        - Fallback: /agent/data
        """
        import os, re
        base = os.environ.get("AGENT_DATA_DIR", "/agent/data")

        # Priority 1: explicit project_id from metadata
        if project_id and "/" not in project_id:
            work_dir = os.path.join(base, project_id)
            os.makedirs(work_dir, exist_ok=True)
            return work_dir

        # Priority 2: user_sub from metadata (used by Document Test page)
        if user_sub and "/" not in user_sub and len(user_sub) < 128:
            work_dir = os.path.join(base, "users", user_sub, "doc-test")
            os.makedirs(work_dir, exist_ok=True)
            return work_dir

        # Priority 3: extract from context_id (e.g. "skill-creator-{sub}")
        if context_id:
            pid = re.sub(r"^skill-creator-", "", context_id)
            if pid and len(pid) < 64 and "/" not in pid:
                work_dir = os.path.join(base, pid)
                os.makedirs(work_dir, exist_ok=True)
                return work_dir

        return base

    # ── Session CRUD (now handled by Go backend — stubs only) ───────────────

    async def ListSessions(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        return pb.ListSessionsResponse(sessions=[])

    async def CreateSession(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        return pb.Session(id="", title="")

    async def DeleteSession(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        return pb.DeleteSessionResponse(success=True)

    async def GetSessionHistory(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        return pb.GetSessionHistoryResponse(messages=[])

    # ── Streaming Message ───────────────────────────────────────

    async def SendStreamingMessage(self, request: Any, context: Any) -> AsyncIterator[Any]:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb

        msg = request.message
        text = ""
        content_blocks: list[dict] = []
        for part in msg.parts:
            if part.HasField("text"):
                text += part.text
                content_blocks.append({"text": part.text})

        session_id = msg.task_id or msg.context_id or str(uuid.uuid4())
        work_dir = self._resolve_workdir(session_id, getattr(msg, 'context_id', ''))

        yield pb.StreamEvent(
            status_update=pb.TaskStatusUpdateEvent(
                task_id=session_id,
                context_id=session_id,
                status=pb.TaskStatus(state=pb.TASK_STATE_WORKING),
            )
        )

        accumulated_text = ""
        try:
            from agentx.mcp_loader import get_mcp_tools
            mcp_tools = await get_mcp_tools(self._mcp_config)

            loop = asyncio.get_running_loop()
            agent = await loop.run_in_executor(
                None, _get_or_create_agent, self._model_id, self._skills_dir, mcp_tools
            )

            # Restore in-memory conversation history for this session
            if session_id in self._agent_messages:
                agent.messages = list(self._agent_messages[session_id])

            agent_input = f"[Working directory: {work_dir}]\n{text}"
            async for event in agent.stream_async(agent_input):
                if "data" in event:
                    chunk = event["data"]
                    if chunk:
                        accumulated_text += chunk
                        yield pb.StreamEvent(
                            artifact_update=pb.TaskArtifactUpdateEvent(
                                task_id=session_id,
                                context_id=session_id,
                                artifact=pb.Artifact(
                                    artifact_id="response",
                                    parts=[pb.Part(text=chunk)],
                                ),
                                append=True,
                            )
                        )

            # Persist in-memory message state (current pod lifetime only)
            self._agent_messages[session_id] = list(agent.messages or [])

        except Exception as e:
            log.error("a2a.stream.error", error=str(e), session_id=session_id)
            yield pb.StreamEvent(
                status_update=pb.TaskStatusUpdateEvent(
                    task_id=session_id,
                    context_id=session_id,
                    status=pb.TaskStatus(state=pb.TASK_STATE_FAILED),
                )
            )
            return

        if self._redis_hook and session_id and accumulated_text:
            asyncio.create_task(
                self._redis_hook.publish_complete(session_id, accumulated_text, 0, 0)
            )

        yield pb.StreamEvent(
            status_update=pb.TaskStatusUpdateEvent(
                task_id=session_id,
                context_id=session_id,
                status=pb.TaskStatus(state=pb.TASK_STATE_COMPLETED),
            )
        )

    # ── Unary SendMessage ────────────────────────────────────────

    async def SendMessage(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        msg = request.message
        session_id = msg.task_id or msg.context_id or ""
        return pb.SendMessageResponse(
            task=pb.Task(id=session_id, context_id=session_id,
                         status=pb.TaskStatus(state=pb.TASK_STATE_SUBMITTED))
        )

    # ── Other RPCs (stubs) ──────────────────────────────────────

    async def GetTask(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        return pb.Task(id=request.id, status=pb.TaskStatus(state=pb.TASK_STATE_COMPLETED))

    async def ListTasks(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        return pb.ListTasksResponse(tasks=[])

    async def CancelTask(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        return pb.Task(id=request.id, status=pb.TaskStatus(state=pb.TASK_STATE_CANCELED))

    async def GetAgentCard(self, request: Any, context: Any) -> Any:
        from agentx.generated.lf.a2a.v1 import a2a_pb2 as pb
        from agentx.agent_card import build_agent_card, EXT_TOKEN_USAGE, EXT_COMPACT, EXT_A2UI
        card = build_agent_card()
        # Build proto AgentCard with extensions
        extensions = []
        for ext in card.get("capabilities", {}).get("extensions", []):
            extensions.append(pb.AgentExtension(
                uri=ext["uri"],
                description=ext.get("description", ""),
                required=ext.get("required", False),
            ))
        skills = []
        for s in card.get("skills", []):
            skills.append(pb.AgentSkill(
                id=s["id"], name=s["name"],
                description=s.get("description", ""),
                tags=s.get("tags", []),
            ))
        return pb.AgentCard(
            name=card["name"],
            description=card["description"],
            version=card["version"],
            capabilities=pb.AgentCapabilities(
                streaming=True,
                extensions=extensions,
            ),
            skills=skills,
            default_input_modes=card.get("defaultInputModes", []),
            default_output_modes=card.get("defaultOutputModes", []),
        )

    async def SendAction(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        return pb.SendActionResponse(success=True)


    # ── Memory + Compact RPCs (handled by Go backend — stubs only) ──────────

    async def AddMemoryMessage(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        return pb.AddMemoryMessageResponse(session_id=request.session_id, msg_idx=0)

    async def GetMemoryMessages(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        return pb.GetMemoryMessagesResponse(session_id=request.session_id, messages=[], total=0)

    async def GetMemoryContext(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        return pb.GetMemoryContextResponse(session_id=request.session_id, messages=[],
                                            long_term_memories=[], ltm_prefix="",
                                            message_count=0, memory_count=0)

    async def SearchMemory(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        return pb.SearchMemoryResponse(records=[], total=0)

    async def DeleteSessionMemory(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        return pb.DeleteSessionMemoryResponse(success=True)

    async def CompactSession(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        return pb.CompactSessionResponse(summary="", original_count=0, compacted_count=0)

    # ── Terminal RPCs ────────────────────────────────────────────

    async def CreateTerminal(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        if not self._pty:
            return pb.Terminal(id="", title="PTY not available")
        session = self._pty.create(
            title=request.title or "Terminal",
            rows=request.rows or 24,
            cols=request.cols or 80,
            cwd=request.working_directory or "/agent/data",
        )
        return pb.Terminal(
            id=session.id, title=session.title,
            rows=session.rows, cols=session.cols,
            created_at=str(int(session.created_at)),
        )

    async def ListTerminals(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        if not self._pty:
            return pb.ListTerminalsResponse(terminals=[])
        terminals = [
            pb.Terminal(id=t.id, title=t.title, rows=t.rows, cols=t.cols)
            for t in self._pty.list_terminals()
        ]
        return pb.ListTerminalsResponse(terminals=terminals)

    async def ResizeTerminal(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        if not self._pty:
            return pb.ResizeTerminalResponse(success=False)
        ok = self._pty.resize(request.id, request.rows, request.cols)
        return pb.ResizeTerminalResponse(success=ok)

    async def CloseTerminal(self, request: Any, context: Any) -> Any:
        from agentx.generated.a2a.v1 import a2a_pb2 as pb
        if not self._pty:
            return pb.CloseTerminalResponse(success=False)
        ok = self._pty.close(request.id)
        return pb.CloseTerminalResponse(success=ok)

    # ── Metadata parsing helper ─────────────────────────────────────────────

    def _parse_metadata(self, msg: Any) -> dict:
        """Extract metadata dict from a message, handling proto Struct and plain dict."""
        meta_dict: dict = {}
        try:
            fields = msg.metadata.fields
            from google.protobuf.json_format import MessageToDict
            meta_dict = MessageToDict(msg.metadata) if msg.metadata.ByteSize() > 0 else {}
        except Exception:
            pass
        if not meta_dict:
            try:
                meta = msg.metadata
                if isinstance(meta, dict):
                    meta_dict = meta
            except Exception:
                pass
        return meta_dict

    # ── lf.a2a.v1 streaming (yields lf proto StreamResponse for Connect) ─────

    async def LfSendStreamingMessage(self, request: Any, context: Any) -> AsyncIterator[Any]:
        """SendStreamingMessage for lf.a2a.v1 — yields lf.a2a.v1.StreamResponse."""
        from agentx.generated.lf.a2a.v1 import a2a_pb2 as lfpb

        msg = request.message
        text = ""
        content_blocks: list[dict] = []
        for part in msg.parts:
            if part.text:
                text += part.text
                content_blocks.append({"text": part.text})
            elif (part.raw or part.url) and part.media_type and part.media_type.startswith("image/"):
                # Image data — convert to Strands ContentBlock format
                import base64 as b64mod
                fmt = "jpeg"
                if "png" in part.media_type:
                    fmt = "png"
                elif "gif" in part.media_type:
                    fmt = "gif"
                elif "webp" in part.media_type:
                    fmt = "webp"

                img_bytes = None
                if part.raw:
                    img_bytes = bytes(part.raw)
                elif part.url and part.url.startswith("data:"):
                    # data URL: data:image/jpeg;base64,/9j/4AAQ...
                    try:
                        _, b64data = part.url.split(",", 1)
                        img_bytes = b64mod.b64decode(b64data)
                    except Exception:
                        pass

                if img_bytes:
                    content_blocks.append({
                        "image": {
                            "format": fmt,
                            "source": {"bytes": img_bytes},
                        }
                    })

        session_id = msg.task_id or msg.context_id or str(uuid.uuid4())

        # Parse metadata (used for project_id and playground_config)
        meta_dict = self._parse_metadata(msg)
        project_id = meta_dict.get("project_id", meta_dict.get("projectId", ""))
        user_sub = meta_dict.get("user_sub", meta_dict.get("userSub", ""))

        # Scaffold mode: fall back to env vars if metadata is empty
        if not project_id:
            project_id = os.environ.get("PROJECT_ID", "default")
        if not user_sub:
            user_sub = os.environ.get("USER_SUB", "default")

        # Parse playground config from metadata
        pg_config = PlaygroundConfig.from_metadata(meta_dict)

        # ── Per-agent A2A: load agent config from DB if agent_id is present ──
        # (Scaffold mode: no per-agent routing, skip this block)
        try:
            from agentx.server.connect import current_agent_id
            routed_agent_id = current_agent_id.get()
        except (ImportError, AttributeError):
            routed_agent_id = None
        if routed_agent_id and pg_config is None:
            # Load agent definition from Go backend
            try:
                agent_data = await self._load_agent_config(routed_agent_id)
                if agent_data:
                    pg_config = agent_data
            except Exception as e:
                import sys
                print(f"[a2a-agent] Failed to load agent {routed_agent_id}: {e}", file=sys.stderr, flush=True)
            finally:
                current_agent_id.set(None)  # clear for next request

        # ── HeroInput agent selection: agent_id in playground_config ──
        # When user selects an agent from HeroInput, its ID is passed
        # as playground_config.agent_id. Load the agent and merge its
        # resources into the existing playground_config.
        pg_agent_id = meta_dict.get("playground_config", {}).get("agent_id") if isinstance(meta_dict.get("playground_config"), dict) else None
        if pg_agent_id and pg_config is not None:
            try:
                agent_cfg = await self._load_agent_config(pg_agent_id)
                if agent_cfg:
                    # Merge agent's resources into existing config
                    if agent_cfg.skill_ids and not pg_config.skill_ids:
                        pg_config.skill_ids = agent_cfg.skill_ids
                    if agent_cfg.mcp_server_ids and not pg_config.mcp_server_ids:
                        pg_config.mcp_server_ids = agent_cfg.mcp_server_ids
                    if agent_cfg.knowledge_base_ids and not pg_config.knowledge_base_ids:
                        pg_config.knowledge_base_ids = agent_cfg.knowledge_base_ids
                    if agent_cfg.document_ids and not pg_config.document_ids:
                        pg_config.document_ids = agent_cfg.document_ids
                    if agent_cfg.system_prompt and not pg_config.system_prompt:
                        pg_config.system_prompt = agent_cfg.system_prompt
            except Exception as e:
                import sys
                print(f"[a2a-agent] Failed to load hero agent {pg_agent_id}: {e}", file=sys.stderr, flush=True)
        elif pg_agent_id and pg_config is None:
            try:
                pg_config = await self._load_agent_config(pg_agent_id)
            except Exception as e:
                import sys
                print(f"[a2a-agent] Failed to load hero agent {pg_agent_id}: {e}", file=sys.stderr, flush=True)

        import sys
        print(
            f"[workdir] project_id={project_id!r} session_id={session_id!r} "
            f"context_id={msg.context_id!r} user_sub={user_sub!r} "
            f"playground={pg_config is not None}",
            file=sys.stderr, flush=True,
        )
        work_dir = self._resolve_workdir(project_id, msg.context_id, user_sub)

        yield lfpb.StreamResponse(
            status_update=lfpb.TaskStatusUpdateEvent(
                task_id=session_id,
                context_id=session_id,
                status=lfpb.TaskStatus(state=lfpb.TASK_STATE_WORKING),
            )
        )

        accumulated_text = ""

        # ── Compute agent input BEFORE the try block so it's always ──
        # ── available for the MCP retry fallback in the except block ──
        agent_input_for_retry: Any
        if len(content_blocks) > 1 or any("image" in b for b in content_blocks):
            workdir_block = {"text": f"[Working directory: {work_dir}]\n"}
            agent_input_for_retry = [workdir_block] + content_blocks
        else:
            agent_input_for_retry = f"[Working directory: {work_dir}]\n{text}"

        try:
            from agentx.mcp_loader import get_mcp_tools
            mcp_tools = await get_mcp_tools(self._mcp_config)

            loop = asyncio.get_running_loop()

            # ── Download document files into work_dir ──────────────────
            # This must happen BEFORE agent creation so the agent sees
            # files at the correct work_dir path (not a temp dir).
            pre_loaded_docs: list[dict] | None = None
            if pg_config is not None and pg_config.document_ids:
                try:
                    from agentx.tools.doc_tool import prepare_documents_in_workdir
                    pre_loaded_docs = await loop.run_in_executor(
                        None,
                        prepare_documents_in_workdir,
                        pg_config.document_ids,
                        work_dir,
                        self._backend_addr,
                    )
                    import sys as _sys
                    print(
                        f"[doc-mount] downloaded {len(pre_loaded_docs or [])} docs "
                        f"to {work_dir}/documents/",
                        file=_sys.stderr, flush=True,
                    )
                except Exception as e:
                    _std_log.warning("playground.doc_mount.error: %s", str(e))

            if pg_config is not None:
                # ── Playground mode: per-config agent ─────────────────────
                backend_addr = self._backend_addr
                agent = await loop.run_in_executor(
                    None,
                    _get_or_create_playground_agent,
                    pg_config,
                    self._model_id,
                    mcp_tools,
                    backend_addr,
                    pre_loaded_docs,
                    work_dir,
                )
            else:
                # ── Normal mode: global singleton agent ───────────────────
                agent = await loop.run_in_executor(
                    None, _get_or_create_agent, self._model_id, self._skills_dir, mcp_tools
                )

            # Restore in-memory conversation history for this session
            if session_id in self._agent_messages:
                agent.messages = list(self._agent_messages[session_id])

            # Prepare agent input: multi-modal content blocks or plain text
            # Prepend workdir context so the agent knows where to operate
            agent_input: Any
            if len(content_blocks) > 1 or any("image" in b for b in content_blocks):
                # Multi-modal: include workdir instruction + all content blocks
                workdir_block = {"text": f"[Working directory: {work_dir}]\n"}
                agent_input = [workdir_block] + content_blocks
            else:
                # Plain text: prepend workdir context
                agent_input = f"[Working directory: {work_dir}]\n{text}"

            # ── AG-UI enriched streaming ──────────────────────────────
            # Use the AG-UI adapter to emit fine-grained events (tool calls,
            # status updates, run lifecycle) alongside legacy text chunks.
            from agentx.agui_adapter import stream_with_agui_events
            async for response in stream_with_agui_events(
                agent=agent,
                agent_input=agent_input,
                session_id=session_id,
                thread_id=session_id,
            ):
                yield response
                # Extract accumulated text from legacy text parts
                if response.HasField("artifact_update"):
                    for part in response.artifact_update.artifact.parts:
                        if part.HasField("text") and part.text:
                            accumulated_text += part.text

            # Persist in-memory message state (current pod lifetime only)
            self._agent_messages[session_id] = list(agent.messages or [])

        except Exception as e:
            error_msg = str(e)
            # Check if this is an MCP tool initialization failure
            # If so, retry without MCP tools rather than failing the entire request
            is_mcp_error = "MCP" in error_msg or "ToolProviderException" in type(e).__name__ or "MCPClient" in error_msg
            if is_mcp_error and pg_config is not None:
                log.warning("lf.a2a.stream.mcp_retry", error=error_msg, session_id=session_id)
                try:
                    # Retry: create agent without MCP tools
                    pg_config_no_mcp = PlaygroundConfig(
                        skill_ids=pg_config.skill_ids,
                        knowledge_base_ids=pg_config.knowledge_base_ids,
                        document_ids=pg_config.document_ids,
                        system_prompt=pg_config.system_prompt,
                        model_id=pg_config.model_id,
                        mcp_server_ids=[],  # disable MCP
                    )
                    # Evict broken cached agents (original + no-MCP variant)
                    for key in [pg_config.cache_key, pg_config_no_mcp.cache_key]:
                        _playground_agents.pop(key, None)
                    agent_retry = await loop.run_in_executor(
                        None,
                        _get_or_create_playground_agent,
                        pg_config_no_mcp,
                        self._model_id,
                        None,  # no MCP tools
                        self._backend_addr,
                        pre_loaded_docs,
                        work_dir,
                    )
                    # Don't restore conversation history — start fresh for retry
                    agent_retry.messages = []  # ensure clean state
                    
                    from agentx.agui_adapter import stream_with_agui_events as _stream_retry
                    async for response in _stream_retry(
                        agent_retry,
                        agent_input_for_retry,
                        session_id=session_id,
                        thread_id=session_id,
                    ):
                        yield response
                        if response.HasField("artifact_update"):
                            for part in response.artifact_update.artifact.parts:
                                if part.HasField("text") and part.text:
                                    accumulated_text += part.text
                    self._agent_messages[session_id] = list(agent_retry.messages or [])
                except Exception as retry_err:
                    log.error("lf.a2a.stream.retry_error", error=str(retry_err), session_id=session_id)
                    yield lfpb.StreamResponse(
                        status_update=lfpb.TaskStatusUpdateEvent(
                            task_id=session_id,
                            context_id=session_id,
                            status=lfpb.TaskStatus(state=lfpb.TASK_STATE_FAILED),
                        )
                    )
                    return
            else:
                log.error("lf.a2a.stream.error", error=error_msg, session_id=session_id)
                yield lfpb.StreamResponse(
                    status_update=lfpb.TaskStatusUpdateEvent(
                        task_id=session_id,
                        context_id=session_id,
                        status=lfpb.TaskStatus(state=lfpb.TASK_STATE_FAILED),
                    )
                )
                return

        if self._redis_hook and session_id and accumulated_text:
            asyncio.create_task(
                self._redis_hook.publish_complete(session_id, accumulated_text, 0, 0)
            )

        yield lfpb.StreamResponse(
            status_update=lfpb.TaskStatusUpdateEvent(
                task_id=session_id,
                context_id=session_id,
                status=lfpb.TaskStatus(state=lfpb.TASK_STATE_COMPLETED),
            )
        )

    # ── lf.a2a.v1 stubs (UNIMPLEMENTED) ──────────────────────────────────────

    async def GetExtendedAgentCard(self, request: Any, context: Any) -> Any:
        return await self.GetAgentCard(request, context)

    async def SubscribeToTask(self, request: Any, context: Any) -> Any:
        from connectrpc.code import Code
        from connectrpc.errors import ConnectError
        raise ConnectError(Code.UNIMPLEMENTED, "SubscribeToTask not implemented")

    async def CreateTaskPushNotificationConfig(self, request: Any, context: Any) -> Any:
        from connectrpc.code import Code
        from connectrpc.errors import ConnectError
        raise ConnectError(Code.UNIMPLEMENTED, "CreateTaskPushNotificationConfig not implemented")

    async def GetTaskPushNotificationConfig(self, request: Any, context: Any) -> Any:
        from connectrpc.code import Code
        from connectrpc.errors import ConnectError
        raise ConnectError(Code.UNIMPLEMENTED, "GetTaskPushNotificationConfig not implemented")

    async def ListTaskPushNotificationConfigs(self, request: Any, context: Any) -> Any:
        from connectrpc.code import Code
        from connectrpc.errors import ConnectError
        raise ConnectError(Code.UNIMPLEMENTED, "ListTaskPushNotificationConfigs not implemented")

    async def DeleteTaskPushNotificationConfig(self, request: Any, context: Any) -> Any:
        from connectrpc.code import Code
        from connectrpc.errors import ConnectError
        raise ConnectError(Code.UNIMPLEMENTED, "DeleteTaskPushNotificationConfig not implemented")

    # ── snake_case aliases for Connect-Python ─────────────────

    send_message = SendMessage
    # lf.a2a.v1 send_streaming_message must yield lf.a2a.v1.StreamResponse
    send_streaming_message = LfSendStreamingMessage
    get_task = GetTask
    list_tasks = ListTasks
    cancel_task = CancelTask
    get_agent_card = GetAgentCard
    get_extended_agent_card = GetExtendedAgentCard
    subscribe_to_task = SubscribeToTask
    create_task_push_notification_config = CreateTaskPushNotificationConfig
    get_task_push_notification_config = GetTaskPushNotificationConfig
    list_task_push_notification_configs = ListTaskPushNotificationConfigs
    delete_task_push_notification_config = DeleteTaskPushNotificationConfig
    send_action = SendAction
    list_sessions = ListSessions
    create_session = CreateSession
    delete_session = DeleteSession
    get_session_history = GetSessionHistory
    add_memory_message = AddMemoryMessage
    get_memory_messages = GetMemoryMessages
    get_memory_context = GetMemoryContext
    search_memory = SearchMemory
    delete_session_memory = DeleteSessionMemory
    compact_session = CompactSession
    create_terminal = CreateTerminal
    list_terminals = ListTerminals
    resize_terminal = ResizeTerminal
    close_terminal = CloseTerminal
