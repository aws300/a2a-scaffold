"""Todo tools — in-memory task list management per agent invocation.

Equivalent to OpenCode's todowrite/todoread tools. Stores todos in
the agent's invocation state for persistence across tool calls.
"""
import json
from typing import Any

from strands import tool

# Module-level todo storage (keyed by session_id via agent state)
_todos: dict[str, list[dict]] = {}


@tool
def todowrite(todos: list[dict]) -> dict:
    """Write/update the complete todo list.

    Replaces the entire todo list with the provided items.
    Each todo should have: id, status ("pending"|"in_progress"|"completed"),
    subject, and optional description.

    Use this to track multi-step tasks and their progress.

    Args:
        todos: Complete list of todo items. Each item is a dict with keys:
               id (str), status (str), subject (str), description (str optional).
    """
    # Store in module-level dict (shared across invocations within same process)
    _todos["current"] = todos
    formatted = json.dumps(todos, indent=2, ensure_ascii=False)
    count = len([t for t in todos if t.get("status") != "completed"])
    return {
        "status": "success",
        "content": [{"text": f"Todo list updated ({count} pending):\n{formatted}"}],
    }


@tool
def todoread() -> dict:
    """Read the current todo list.

    Returns the complete todo list with all items and their statuses.
    Use this to check progress on multi-step tasks.
    """
    todos = _todos.get("current", [])
    if not todos:
        return {"status": "success", "content": [{"text": "No todos. Use todowrite to create a task list."}]}

    formatted = json.dumps(todos, indent=2, ensure_ascii=False)
    pending = len([t for t in todos if t.get("status") != "completed"])
    return {
        "status": "success",
        "content": [{"text": f"Todo list ({pending} pending):\n{formatted}"}],
    }
