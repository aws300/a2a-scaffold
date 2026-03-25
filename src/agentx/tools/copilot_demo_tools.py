"""Copilot demo tools — backend tool definitions for CopilotKit demo scenarios.

These tools are defined on the backend (so the LLM knows about them) but are
designed to be **intercepted and executed on the frontend** by the Copilot
framework. The backend definitions provide the tool schema; the frontend
`useCopilotAction()` hooks provide the actual handlers.

If the frontend doesn't intercept (e.g., no CopilotProvider active), the
backend implementations here serve as reasonable fallbacks.

Demo Scenarios Covered:
1. Frontend Tool Execution — set_ui_theme
2. Shared State — update_recipe (bidirectional data flow)
3. Human-in-the-Loop — confirm_dangerous_action
4. Generative UI — run_progress_task (long-running with status updates)
5. Seamless Integration — all tools auto-discovered by frontend
"""

from strands import tool


@tool
def set_ui_theme(theme: str) -> dict:
    """Change the frontend UI color theme.

    This is a frontend-executed tool — the actual theme change happens in the
    browser via the Copilot framework. Call this when the user asks to change
    the visual theme or appearance of the application.

    Available themes: light, dark, system.

    Args:
        theme: The theme to apply. One of: "light", "dark", "system".
    """
    return {
        "status": "success",
        "content": [{"text": f"UI theme changed to '{theme}'. The frontend has applied the new theme."}],
    }


@tool
def update_recipe(title: str, ingredients: list[str], instructions: list[str]) -> dict:
    """Create or update a recipe that is displayed in the frontend UI.

    This demonstrates shared state: the agent creates recipe data, and the
    frontend UI updates in real-time to display it. Call this when the user
    asks you to create, suggest, or modify a recipe.

    Args:
        title: The recipe title (e.g., "Classic Margherita Pizza").
        ingredients: List of ingredient strings (e.g., ["2 cups flour", "1 cup water"]).
        instructions: List of step-by-step instructions.
    """
    summary = f"Recipe: {title}\nIngredients: {len(ingredients)} items\nSteps: {len(instructions)}"
    return {
        "status": "success",
        "content": [{"text": f"Recipe '{title}' has been created and displayed in the UI.\n{summary}"}],
    }


@tool
def confirm_dangerous_action(action: str, target: str, reason: str) -> dict:
    """Request user confirmation before performing a potentially dangerous action.

    This tool requires human approval — the frontend will show an approval
    dialog and wait for the user to confirm or reject before proceeding.
    Use this for irreversible operations like deleting files, modifying
    databases, or deploying to production.

    Args:
        action: The action to perform (e.g., "delete", "deploy", "reset").
        target: The target of the action (e.g., "user_data.db", "production server").
        reason: Why this action is being performed.
    """
    return {
        "status": "success",
        "content": [{"text": f"Action '{action}' on '{target}' has been approved and executed.\nReason: {reason}"}],
    }


@tool
def run_progress_task(task_name: str, steps: list[str]) -> dict:
    """Execute a multi-step task with real-time progress tracking in the UI.

    This demonstrates agentic generative UI — the frontend renders a dynamic
    progress tracker showing each step's status as the task executes.
    Use this for complex, multi-step operations where the user benefits
    from seeing real-time progress.

    Args:
        task_name: Name of the task (e.g., "Deploy Application").
        steps: List of step descriptions to execute sequentially.
    """
    import time
    results = []
    for i, step in enumerate(steps):
        time.sleep(0.5)  # Simulate work
        results.append(f"Step {i+1}/{len(steps)}: {step} — completed")

    return {
        "status": "success",
        "content": [{"text": f"Task '{task_name}' completed. {len(steps)} steps executed:\n" + "\n".join(results)}],
    }
