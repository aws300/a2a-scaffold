"""
AG-UI event adapter — converts Strands agent streaming events into AG-UI
protocol events, packed inside the existing lf.a2a.v1.StreamResponse proto.

Architecture
------------
The existing ConnectRPC streaming endpoint (lf.a2a.v1.SendStreamingMessage)
remains unchanged as the transport layer.  This adapter enriches the stream
by emitting AG-UI events through ``Part.data`` (protobuf Value) with
``media_type = "application/json+ag-ui"``, while keeping legacy text chunks
in ``Part.text`` for backward compatibility.

Each StreamResponse can carry:
  1. A **legacy text chunk** (``artifact_update.artifact.parts[0].text``)
     — unchanged, consumed by older frontend code.
  2. An **AG-UI event** (``artifact_update.artifact.parts[1].data``)
     — JSON-serialized AG-UI BaseEvent in a google.protobuf.Value.

The frontend adapter detects AG-UI events by checking ``media_type`` on
each Part and dispatches to the AG-UI event handler pipeline.

AG-UI Events Emitted
---------------------
- RUN_STARTED / RUN_FINISHED / RUN_ERROR  (lifecycle)
- TEXT_MESSAGE_START / TEXT_MESSAGE_CONTENT / TEXT_MESSAGE_END  (streaming text)
- TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END  (tool invocations)
- STATE_SNAPSHOT  (status updates: working, thinking, tool use)
"""
from __future__ import annotations

import json
import logging
import uuid
import time
from typing import Any, AsyncIterator

log = logging.getLogger(__name__)

# AG-UI event type constants (mirrors ag_ui.core.EventType)
# We define them locally to avoid hard dependency on ag_ui at import time.
AGUI_MEDIA_TYPE = "application/json+ag-ui"


class AGUIEventType:
    """AG-UI event type string constants."""
    RUN_STARTED = "RUN_STARTED"
    RUN_FINISHED = "RUN_FINISHED"
    RUN_ERROR = "RUN_ERROR"
    TEXT_MESSAGE_START = "TEXT_MESSAGE_START"
    TEXT_MESSAGE_CONTENT = "TEXT_MESSAGE_CONTENT"
    TEXT_MESSAGE_END = "TEXT_MESSAGE_END"
    TOOL_CALL_START = "TOOL_CALL_START"
    TOOL_CALL_ARGS = "TOOL_CALL_ARGS"
    TOOL_CALL_END = "TOOL_CALL_END"
    TOOL_CALL_RESULT = "TOOL_CALL_RESULT"
    STATE_SNAPSHOT = "STATE_SNAPSHOT"
    STATE_DELTA = "STATE_DELTA"
    STEP_STARTED = "STEP_STARTED"
    STEP_FINISHED = "STEP_FINISHED"
    CUSTOM = "CUSTOM"


def _make_event(event_type: str, **fields: Any) -> dict:
    """Create an AG-UI event dict."""
    ev: dict[str, Any] = {"type": event_type, "timestamp": int(time.time() * 1000)}
    ev.update(fields)
    return ev


def _agui_part(event: dict) -> Any:
    """Wrap an AG-UI event dict into a lf.a2a.v1.Part with media_type marker."""
    from google.protobuf import struct_pb2
    from agentx.generated.lf.a2a.v1 import a2a_pb2 as lfpb

    value = struct_pb2.Value()
    # Pack the AG-UI event as a JSON struct inside protobuf Value
    json_str = json.dumps(event)
    value.string_value = json_str

    return lfpb.Part(
        data=value,
        media_type=AGUI_MEDIA_TYPE,
    )


def _yield_agui_artifact(
    lfpb: Any,
    session_id: str,
    event: dict,
    text_chunk: str | None = None,
) -> Any:
    """Build a StreamResponse with AG-UI event (and optional legacy text)."""
    parts = []
    # Legacy text part (backward compat for old frontend)
    if text_chunk:
        parts.append(lfpb.Part(text=text_chunk))
    # AG-UI event part
    parts.append(_agui_part(event))

    return lfpb.StreamResponse(
        artifact_update=lfpb.TaskArtifactUpdateEvent(
            task_id=session_id,
            context_id=session_id,
            artifact=lfpb.Artifact(
                artifact_id="response",
                parts=parts,
            ),
            append=True,
        )
    )


async def stream_with_agui_events(
    agent: Any,
    agent_input: Any,
    session_id: str,
    thread_id: str | None = None,
    run_id: str | None = None,
) -> AsyncIterator[Any]:
    """
    Stream Strands agent events, yielding lf.a2a.v1.StreamResponse messages
    enriched with AG-UI events.

    This is a drop-in replacement for the raw ``agent.stream_async()`` loop
    in ``LfSendStreamingMessage``.  It yields the same proto types but with
    additional AG-UI event data packed into Part.data fields.

    Parameters
    ----------
    agent : strands.Agent
        The Strands agent instance.
    agent_input : str | list
        The input to pass to ``agent.stream_async()``.
    session_id : str
        The A2A session/task ID.
    thread_id : str, optional
        AG-UI thread ID (defaults to session_id).
    run_id : str, optional
        AG-UI run ID (auto-generated if not provided).

    Yields
    ------
    lf.a2a.v1.StreamResponse
        Proto messages containing both legacy text and AG-UI events.
    """
    from agentx.generated.lf.a2a.v1 import a2a_pb2 as lfpb

    _thread_id = thread_id or session_id
    _run_id = run_id or str(uuid.uuid4())
    message_id = str(uuid.uuid4())
    message_started = False
    tool_calls_seen: dict[str, dict[str, Any]] = {}
    accumulated_text = ""

    # ── RUN_STARTED ──
    yield _yield_agui_artifact(lfpb, session_id, _make_event(
        AGUIEventType.RUN_STARTED,
        threadId=_thread_id,
        runId=_run_id,
    ))

    # ── STATE_SNAPSHOT: working ──
    yield _yield_agui_artifact(lfpb, session_id, _make_event(
        AGUIEventType.STATE_SNAPSHOT,
        snapshot={"status": "working", "sessionId": session_id},
    ))

    try:
        async for event in agent.stream_async(agent_input):
            # ── Text streaming ──
            if "data" in event and event["data"]:
                chunk = event["data"]
                accumulated_text += chunk

                if not message_started:
                    yield _yield_agui_artifact(lfpb, session_id, _make_event(
                        AGUIEventType.TEXT_MESSAGE_START,
                        messageId=message_id,
                        role="assistant",
                    ))
                    message_started = True

                # Yield both legacy text chunk and AG-UI TEXT_MESSAGE_CONTENT
                yield _yield_agui_artifact(
                    lfpb, session_id,
                    _make_event(
                        AGUIEventType.TEXT_MESSAGE_CONTENT,
                        messageId=message_id,
                        delta=chunk,
                    ),
                    text_chunk=chunk,
                )

            # ── Tool call tracking ──
            elif "current_tool_use" in event and event["current_tool_use"]:
                tool_use = event["current_tool_use"]
                tool_name = tool_use.get("name")
                tool_use_id = tool_use.get("toolUseId") or str(uuid.uuid4())

                if tool_name and tool_use_id not in tool_calls_seen:
                    tool_calls_seen[tool_use_id] = {
                        "name": tool_name,
                        "input": tool_use.get("input", ""),
                        "emitted": False,
                    }
                elif tool_name and tool_use_id in tool_calls_seen:
                    tool_calls_seen[tool_use_id]["input"] = tool_use.get("input", "")

            # ── Content block stop → emit tool call events ──
            elif "event" in event and isinstance(event.get("event"), dict):
                inner = event["event"]
                if "contentBlockStop" in inner:
                    for tid, tdata in tool_calls_seen.items():
                        if tdata.get("emitted"):
                            continue
                        tdata["emitted"] = True
                        tool_name = tdata["name"]
                        tool_input = tdata.get("input", "")

                        args_str = (
                            json.dumps(tool_input) if isinstance(tool_input, dict)
                            else str(tool_input)
                        )

                        # End text message before tool call if needed
                        if message_started:
                            yield _yield_agui_artifact(lfpb, session_id, _make_event(
                                AGUIEventType.TEXT_MESSAGE_END,
                                messageId=message_id,
                            ))
                            message_started = False
                            message_id = str(uuid.uuid4())  # new message after tool

                        # STEP_STARTED
                        yield _yield_agui_artifact(lfpb, session_id, _make_event(
                            AGUIEventType.STEP_STARTED,
                            stepName=f"tool:{tool_name}",
                        ))

                        # TOOL_CALL_START
                        yield _yield_agui_artifact(lfpb, session_id, _make_event(
                            AGUIEventType.TOOL_CALL_START,
                            toolCallId=tid,
                            toolCallName=tool_name,
                            parentMessageId=message_id,
                        ))

                        # TOOL_CALL_ARGS
                        yield _yield_agui_artifact(lfpb, session_id, _make_event(
                            AGUIEventType.TOOL_CALL_ARGS,
                            toolCallId=tid,
                            delta=args_str,
                        ))

                        # TOOL_CALL_END
                        yield _yield_agui_artifact(lfpb, session_id, _make_event(
                            AGUIEventType.TOOL_CALL_END,
                            toolCallId=tid,
                        ))

                        # STATE_SNAPSHOT: using tool
                        yield _yield_agui_artifact(lfpb, session_id, _make_event(
                            AGUIEventType.STATE_SNAPSHOT,
                            snapshot={
                                "status": "tool_use",
                                "currentTool": tool_name,
                                "sessionId": session_id,
                            },
                        ))

                        break  # one tool at a time

            # ── Tool result (from Strands "message" with toolResult) ──
            elif "message" in event and event["message"].get("role") == "user":
                message_content = event["message"].get("content", [])
                if isinstance(message_content, list):
                    for item in message_content:
                        if not isinstance(item, dict) or "toolResult" not in item:
                            continue
                        tr = item["toolResult"]
                        result_tool_id = tr.get("toolUseId")
                        result_content = tr.get("content", [])

                        result_text = ""
                        if isinstance(result_content, list):
                            for ci in result_content:
                                if isinstance(ci, dict) and "text" in ci:
                                    result_text += ci["text"]

                        if result_tool_id:
                            yield _yield_agui_artifact(lfpb, session_id, _make_event(
                                AGUIEventType.TOOL_CALL_RESULT,
                                toolCallId=result_tool_id,
                                content=result_text[:2000],  # truncate large results
                            ))

                            # STEP_FINISHED
                            call_info = tool_calls_seen.get(result_tool_id, {})
                            yield _yield_agui_artifact(lfpb, session_id, _make_event(
                                AGUIEventType.STEP_FINISHED,
                                stepName=f"tool:{call_info.get('name', 'unknown')}",
                            ))

                            # Back to working state
                            yield _yield_agui_artifact(lfpb, session_id, _make_event(
                                AGUIEventType.STATE_SNAPSHOT,
                                snapshot={"status": "working", "sessionId": session_id},
                            ))

    except Exception as e:
        log.error("agui.stream.error", exc_info=True)
        yield _yield_agui_artifact(lfpb, session_id, _make_event(
            AGUIEventType.RUN_ERROR,
            message=str(e),
            code="STRANDS_ERROR",
        ))
        raise  # re-raise so caller handles the TASK_STATE_FAILED

    # ── TEXT_MESSAGE_END ──
    if message_started:
        yield _yield_agui_artifact(lfpb, session_id, _make_event(
            AGUIEventType.TEXT_MESSAGE_END,
            messageId=message_id,
        ))

    # ── RUN_FINISHED ──
    yield _yield_agui_artifact(lfpb, session_id, _make_event(
        AGUIEventType.RUN_FINISHED,
        threadId=_thread_id,
        runId=_run_id,
    ))

    # Note: async generators cannot use `return <value>`.
    # The accumulated_text is available via the caller's own accumulation
    # of TEXT_MESSAGE_CONTENT events.
    return
